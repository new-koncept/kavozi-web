import type { Schema } from '../../api/locationClient'
import { EncounterError } from '../api/encounterClient'
import { uuid } from '../../identity/application/crypto'

export type EncounterView = Schema['EncounterResponse'] & {
  encounterId: string; state: NonNullable<Schema['EncounterResponse']['state']>; membershipVersion: number
  participants: Schema['ParticipantResponse'][]; self: { participantId: string; firstVisibleSequence: number }
}
export type EncounterEvent = Schema['EncounterEvent']
export const encounterStateLabel = { WAITING_FOR_MEMBERS: 'Waiting for members', OPEN: 'Open', CLOSED: 'Closed', EXPIRED: 'Expired' }
export function validateEncounter(room: Schema['EncounterResponse']): EncounterView {
  if (!room || !uuid(room.encounterId) || !room.state || !['WAITING_FOR_MEMBERS', 'OPEN', 'CLOSED', 'EXPIRED'].includes(room.state)
    || !Number.isSafeInteger(room.membershipVersion) || !room.membershipVersion || room.membershipVersion < 1
    || !Array.isArray(room.participants) || !uuid(room.self?.participantId) || !Number.isSafeInteger(room.self.firstVisibleSequence)
    || room.self.firstVisibleSequence! < 1 || room.participants.some((p) => !uuid(p.participantId) || !['ACTIVE', 'LEFT'].includes(p.state ?? '')))
    throw new EncounterError(502, 'INVALID_RESPONSE')
  return { ...room, encounterId: room.encounterId, state: room.state, membershipVersion: room.membershipVersion,
    participants: room.participants, self: { participantId: room.self.participantId, firstVisibleSequence: room.self.firstVisibleSequence! } }
}
export function messageKey(event: EncounterEvent): string | undefined {
  if (event.type === 'MESSAGE' && 'message' in event && event.message?.senderParticipantId && event.message.messageId)
    return `${event.message.senderParticipantId}:${event.message.messageId}`
}
export function mergeEvents(history: EncounterEvent[], incoming: EncounterEvent[]): EncounterEvent[] {
  const sequences = new Map<number, EncounterEvent>()
  for (const event of [...history, ...incoming]) {
    if (!Number.isSafeInteger(event.sequence) || event.sequence! < 1) throw new EncounterError(502, 'INVALID_RESPONSE')
    sequences.set(event.sequence!, event)
  }
  const messages = new Set<string>()
  return [...sequences.values()].sort((a, b) => a.sequence! - b.sequence!).filter((event) => {
    const key = messageKey(event)
    if (!key) return true
    if (messages.has(key)) return false
    messages.add(key); return true
  })
}
export function readEventPage(page: Schema['EncounterEventPage'], after: number) {
  if (!page || !Array.isArray(page.events) || !Number.isSafeInteger(page.nextAfterSequence) || page.nextAfterSequence! < after
    || typeof page.hasMore !== 'boolean' || (page.hasMore && page.nextAfterSequence! <= after)
    || !Number.isSafeInteger(page.pollAfterSeconds) || !page.pollAfterSeconds || page.pollAfterSeconds < 1
    || !page.state || !Number.isSafeInteger(page.membershipVersion) || !page.membershipVersion)
    throw new EncounterError(502, 'INVALID_RESPONSE')
  const events = mergeEvents([], page.events)
  if (events.some((event) => event.sequence! > page.nextAfterSequence!)) throw new EncounterError(502, 'INVALID_RESPONSE')
  return { events, next: page.nextAfterSequence!, hasMore: page.hasMore, delay: page.pollAfterSeconds * 1000, state: page.state, membershipVersion: page.membershipVersion }
}
export function participantLabel(room: EncounterView, id?: string) {
  if (id === room.self.participantId) return 'You'
  const index = room.participants.findIndex((participant) => participant.participantId === id)
  return index < 0 ? 'Participant' : `Participant ${index + 1}`
}
