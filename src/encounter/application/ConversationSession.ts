import type { Schema } from '../../api/locationClient'
import { EncounterError, encounterErrorMessage, retryDelay, type EncounterClient, type EncounterMetadata } from '../api/encounterClient'
import { outboxRepository, type PendingMessage } from '../persistence/outbox'
import { mergeEvents, messageKey, readEventPage, validateEncounter, type EncounterEvent, type EncounterView } from './events'
import { encodeMessage } from './textProtocol'

export type ConversationState = {
  room?: EncounterView; metadata?: EncounterMetadata; events: EncounterEvent[]; pending?: PendingMessage
  loading: boolean; sending: boolean; leaving: boolean; left: boolean; error?: string; sendError?: string; unavailable: boolean
}
/** One mounted conversation. History and cursor share a lifetime; reload replays from zero. */
export class ConversationSession {
  private state: ConversationState = { events: [], loading: true, sending: false, leaving: false, left: false, unavailable: false }
  private stopped = false
  private abort = new AbortController()
  private timer?: ReturnType<typeof setTimeout>
  private polling?: Promise<void>
  private cursor = 0
  private failures = 0
  private delay = 3000
  private retryNotBefore = 0
  private sendNotBefore = 0
  private readonly fingerprint: string
  private readonly id: string
  private readonly api: EncounterClient
  private readonly notify: (state: ConversationState) => void
  private readonly outbox: ReturnType<typeof outboxRepository>
  constructor(fingerprint: string, id: string, api: EncounterClient,
    notify: (state: ConversationState) => void, outbox = outboxRepository()) {
    this.fingerprint = fingerprint; this.id = id; this.api = api; this.notify = notify; this.outbox = outbox
  }
  getSnapshot = () => this.state
  private publish(patch: Partial<ConversationState>) {
    if (!this.stopped) { this.state = { ...this.state, ...patch }; this.notify(this.state) }
  }
  async start() {
    try {
      const pending = await this.outbox.get(this.fingerprint, this.id)
      this.publish({ pending })
      if (!this.stopped) await this.refresh()
    } catch { this.publish({ loading: false, error: 'Could not read pending messages from browser storage. Retry after checking storage.' }) }
  }
  stop() { this.stopped = true; clearTimeout(this.timer); this.abort.abort(); this.api.dispose() }
  refresh = (): Promise<void> => {
    if (this.stopped || this.state.left || this.state.leaving) return Promise.resolve()
    if (this.polling) return this.polling
    clearTimeout(this.timer)
    if (Date.now() < this.retryNotBefore) {
      this.timer = setTimeout(() => void this.refresh(), Math.min(2147483647, this.retryNotBefore - Date.now()))
      return Promise.resolve()
    }
    this.polling = this.poll().finally(() => { this.polling = undefined })
    return this.polling
  }
  private async poll() {
    let retry = true
    try {
      const metadata = this.state.metadata ?? await this.api.metadata()
      let room = validateEncounter(await this.api.get(this.id, this.abort.signal))
      if (this.stopped) return
      this.publish({ room, metadata })
      let more = true
      while (more && !this.stopped && !this.state.leaving) {
        const page = readEventPage(await this.api.events(this.id, this.cursor, this.abort.signal), this.cursor)
        if (this.stopped || this.state.leaving) return
        if (room.membershipVersion !== page.membershipVersion) room = validateEncounter(await this.api.get(this.id, this.abort.signal))
        if (this.stopped || this.state.leaving) return
        const events = mergeEvents(this.state.events, page.events)
        // A newer roster response can already include changes after this event page.
        if (room.membershipVersion === page.membershipVersion) room = { ...room, state: page.state }
        // Commit cursor only alongside its in-memory history; POST acknowledgments never advance it.
        this.cursor = page.next; this.delay = page.delay; more = page.hasMore
        this.publish({ events, room, loading: false, error: undefined, unavailable: false })
        await this.reconcilePending(events)
      }
      this.failures = 0
      this.retryNotBefore = 0
      retry = room.state === 'OPEN' || room.state === 'WAITING_FOR_MEMBERS'
    } catch (error) {
      if (this.stopped || this.state.leaving) return
      const unavailable = error instanceof EncounterError && [403, 404].includes(error.status)
      this.publish({ loading: false, error: encounterErrorMessage(error), unavailable })
      retry = error instanceof EncounterError && error.transient
      this.retryNotBefore = Date.now() + (error instanceof EncounterError ? error.retryAfter : 0)
      this.delay = retryDelay(error, this.failures++, this.state.metadata ? this.state.metadata.pollAfterSeconds * 1000 : 3000)
    } finally {
      if (!this.stopped && !this.state.left && !this.state.leaving && retry) this.timer = setTimeout(() => void this.refresh(), Math.min(2147483647, this.delay))
    }
  }
  private async reconcilePending(events: EncounterEvent[]) {
    const pending = this.state.pending
    if (pending && events.some((event) => messageKey(event) === `${pending.senderParticipantId}:${pending.body.messageId}`)) {
      await this.outbox.remove(this.fingerprint, this.id, pending.body.messageId)
      this.publish({ pending: undefined, sendError: undefined })
    }
  }
  async send(text: string, membershipVersion: number) {
    if (this.stopped || this.state.sending || this.state.pending || this.state.leaving) return false
    const { room, metadata } = this.state
    if (!room || !metadata || room.state !== 'OPEN' || room.membershipVersion !== membershipVersion || this.state.unavailable) return false
    this.publish({ sending: true, sendError: undefined })
    try {
      const request = encodeMessage(text, membershipVersion, metadata)
      const pending: PendingMessage = { fingerprint: this.fingerprint, encounterId: this.id, senderParticipantId: room.self.participantId, ...request, status: 'pending' }
      await this.outbox.add(pending)
      this.publish({ pending })
      await this.transmit(pending)
      return true // Draft is durably retained in the outbox even if delivery is uncertain.
    } catch { this.publish({ sendError: 'Could not save this message. Check its size and browser storage; your draft is unchanged.' }); return false }
    finally { this.publish({ sending: false }) }
  }
  async retrySend() {
    if (this.stopped || this.state.sending || this.state.leaving || this.state.pending?.status !== 'pending') return
    if (Date.now() < this.sendNotBefore) { this.publish({ sendError: 'The server asked us to wait before retrying. Your message is kept on this device.' }); return }
    this.publish({ sending: true, sendError: undefined })
    try { await this.transmit(this.state.pending) } finally { this.publish({ sending: false }) }
  }
  private async transmit(pending: PendingMessage) {
    if (this.stopped) return
    try {
      const event: Schema['MessageEvent'] = await this.api.send(this.id, pending.body, pending.serialized, this.abort.signal)
      if (this.stopped) return
      if (event.type !== 'MESSAGE' || messageKey(event) !== `${pending.senderParticipantId}:${pending.body.messageId}`) throw new EncounterError(502, 'INVALID_RESPONSE')
      const events = mergeEvents(this.state.events, [event])
      this.publish({ events }); await this.reconcilePending(events)
    } catch (error) {
      if (this.stopped) return
      // Event polling may have confirmed storage before an ambiguous POST failure arrived.
      if (this.state.events.some((event) => messageKey(event) === `${pending.senderParticipantId}:${pending.body.messageId}`)) return
      this.sendNotBefore = Date.now() + (error instanceof EncounterError ? error.retryAfter : 0)
      if (error instanceof EncounterError && error.code === 'MEMBERSHIP_CHANGED') {
        const review: PendingMessage = { ...pending, status: 'review' }
        await this.outbox.put(review); this.publish({ pending: review })
        await this.refresh()
      }
      if (error instanceof EncounterError && error.status === 410) await this.refresh()
      this.publish({ sendError: encounterErrorMessage(error) })
    }
  }
  async takeForReview() {
    if (this.state.sending || this.state.pending?.status !== 'review') return undefined
    const message = this.state.pending.body
    await this.outbox.remove(this.fingerprint, this.id, message.messageId)
    this.publish({ pending: undefined, sendError: undefined })
    return message
  }
  async leave() {
    if (this.stopped || this.state.leaving || this.state.sending) return false
    this.publish({ leaving: true }); clearTimeout(this.timer)
    try {
      await this.api.leave(this.id, this.abort.signal)
      this.publish({ left: true, leaving: false, pending: undefined })
      await this.outbox.remove(this.fingerprint, this.id)
      this.stop(); return true
    } catch (error) {
      this.publish({ leaving: false, error: encounterErrorMessage(error) })
      void this.refresh(); return false
    }
  }
}
