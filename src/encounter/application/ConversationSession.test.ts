import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Schema } from '../../api/locationClient'
import { LocationDatabase } from '../../location/persistence/db'
import { EncounterError, retryAfterMilliseconds, retryDelay } from '../api/encounterClient'
import { fixtureRoom, fixturePage, encounterMetadata, roomId, selfId, otherId } from '../testFixtures'
import { outboxRepository } from '../persistence/outbox'
import { ConversationSession } from './ConversationSession'
import { decodeMessage, encodeMessage } from './textProtocol'
import { mergeEvents, participantLabel } from './events'

let database: LocationDatabase
const sessions: ConversationSession[] = []
beforeEach(() => { database = new LocationDatabase(`messaging-test-${crypto.randomUUID()}`) })
afterEach(async () => { sessions.splice(0).forEach((s) => s.stop()); await database.delete(); vi.useRealTimers() })
const messageEvent = (message: Schema['SendEncounterMessageRequest'], sequence = 7): Schema['MessageEvent'] => ({ type: 'MESSAGE', sequence, membershipVersion: message.membershipVersion,
  message: { ...message, senderParticipantId: selfId } })
function setup() {
  const api = { dispose: vi.fn(), metadata: vi.fn(async () => encounterMetadata), get: vi.fn(async () => fixtureRoom),
    events: vi.fn(async (_id: string, after: number): Promise<Schema['EncounterEventPage']> => ({ ...fixturePage, nextAfterSequence: after })),
    send: vi.fn(async (_id: string, body: Schema['SendEncounterMessageRequest'], serialized: string) => { void serialized; return messageEvent(body) }),
    leave: vi.fn(async () => {}), claim: vi.fn(async () => fixtureRoom), list: vi.fn(async () => ({ encounters: [fixtureRoom] })) }
  const notify = vi.fn(), outbox = outboxRepository(database)
  const session = new ConversationSession('node-one', roomId, api, notify, outbox)
  sessions.push(session)
  return { api, notify, session, outbox }
}
it('preserves Unicode, checks decoded byte limits, and contains malformed/unknown messages', () => {
  const text = 'Ahoj, příliš žluťoučký kôň 🌿👋'
  const { body } = encodeMessage(text, 2, encounterMetadata)
  expect(decodeMessage(body, 16384)).toBe(text)
  expect(() => encodeMessage('🌿', 2, { ...encounterMetadata, maxMessagePayloadBytes: 3 })).toThrow()
  expect(() => encodeMessage(' ', 2, encounterMetadata)).toThrow()
  expect(decodeMessage({ ...body, protocol: 'unknown' }, 16384)).toBeNull()
  expect(decodeMessage({ ...body, contentType: 'text/html' }, 16384)).toBeNull()
  for (const payload of ['AA==', '_w', 'abc*']) expect(decodeMessage({ ...body, payload }, 16384)).toBeNull()
})
it('retries a lost response using the same ID and exact body, then deduplicates its event', async () => {
  const { api, session, outbox } = setup(); await session.start()
  api.send.mockRejectedValueOnce(new EncounterError(0))
  await session.send('Čau 🌿', 2)
  const pending = (await outbox.get('node-one', roomId))!
  expect(pending.serialized).toBe(api.send.mock.calls[0][2])
  await session.retrySend()
  expect(api.send.mock.calls[1]).toEqual(api.send.mock.calls[0])
  const stored = messageEvent(pending.body)
  api.events.mockResolvedValueOnce({ ...fixturePage, events: [stored], nextAfterSequence: 7 })
  await session.refresh()
  expect(session.getSnapshot().events).toHaveLength(1)
  expect(await outbox.get('node-one', roomId)).toBeUndefined()
})
it('paginates immediately with returned non-contiguous cursors and replays from zero after reload', async () => {
  const { api, session, outbox } = setup()
  const message = encodeMessage('hello', 2, encounterMetadata).body
  api.events.mockResolvedValueOnce({ ...fixturePage, events: [messageEvent(message, 5)], nextAfterSequence: 5, hasMore: true })
  api.events.mockResolvedValueOnce({ ...fixturePage, events: [{ type: 'ENCOUNTER_OPENED', sequence: 12 }], nextAfterSequence: 12 })
  await session.start()
  expect(api.events.mock.calls.map((call) => call[1])).toEqual([0, 5])
  expect(session.getSnapshot().events.map((event) => event.sequence)).toEqual([5, 12])
  session.stop()
  const reloaded = new ConversationSession('node-one', roomId, api, vi.fn(), outbox); sessions.push(reloaded)
  await reloaded.start()
  expect(api.events.mock.calls.at(-1)?.[1]).toBe(0)
})
it('does not advance the cursor when roster refresh fails mid-page', async () => {
  const { api, session } = setup()
  api.events.mockResolvedValueOnce({ ...fixturePage, membershipVersion: 3, events: [{ type: 'PARTICIPANT_LEFT', sequence: 8, participantId: otherId }], nextAfterSequence: 8 })
  api.get.mockResolvedValueOnce(fixtureRoom).mockRejectedValueOnce(new EncounterError(503))
  await session.start(); await session.refresh()
  expect(api.events.mock.calls.map((call) => call[1])).toEqual([0, 0])
})
it('requires a new sending decision after membership conflict and supports more than two participants', async () => {
  const { api, session } = setup(); await session.start()
  const third = { participantId: '20000000-0000-4000-8000-000000000003', state: 'ACTIVE' as const }
  api.get.mockResolvedValue({ ...fixtureRoom, membershipVersion: 3, participants: [...fixtureRoom.participants, third] })
  api.events.mockResolvedValue({ ...fixturePage, membershipVersion: 3 })
  api.send.mockRejectedValueOnce(new EncounterError(409, 'MEMBERSHIP_CHANGED'))
  await session.send('For this group', 2)
  expect(session.getSnapshot().pending?.status).toBe('review')
  expect(session.getSnapshot().room?.participants).toHaveLength(3)
  await session.retrySend(); expect(api.send).toHaveBeenCalledTimes(1)
  const original = await session.takeForReview()
  expect(await session.send('For this group', 2)).toBe(false)
  await session.send('For the new group', 3)
  expect(api.send.mock.calls[1][1].messageId).not.toBe(original!.messageId)
  expect(api.send.mock.calls[1][1].membershipVersion).toBe(3)
})
it('retains pending sends through reload, isolates them by node, and never auto-resends', async () => {
  const { api, session, outbox } = setup(); await session.start()
  api.send.mockRejectedValueOnce(new EncounterError(0))
  await session.send('Draft retained', 2); session.stop()
  const same = new ConversationSession('node-one', roomId, api, vi.fn(), outbox); sessions.push(same); await same.start()
  expect(same.getSnapshot().pending?.body.messageId).toBe(api.send.mock.calls[0][1].messageId)
  const other = new ConversationSession('node-two', roomId, api, vi.fn(), outbox); sessions.push(other); await other.start()
  expect(other.getSnapshot().pending).toBeUndefined()
  expect(api.send).toHaveBeenCalledTimes(1)
})
it('cancels late responses on disposal and prevents duplicate clicks', async () => {
  const { api, session, notify } = setup(); await session.start()
  let resolve!: (event: Schema['MessageEvent']) => void
  api.send.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
  const sending = session.send('Only once', 2)
  await vi.waitFor(() => expect(api.send).toHaveBeenCalledTimes(1))
  expect(await session.send('Second click', 2)).toBe(false)
  session.stop(); const calls = notify.mock.calls.length
  resolve(messageEvent(api.send.mock.calls[0][1])); await sending
  expect(notify).toHaveBeenCalledTimes(calls)
  expect(api.dispose).toHaveBeenCalledTimes(1)
})
it.each(['WAITING_FOR_MEMBERS', 'CLOSED', 'EXPIRED'] as const)('does not send while %s', async (state) => {
  const { api, session } = setup()
  api.get.mockResolvedValue({ ...fixtureRoom, state }); api.events.mockResolvedValue({ ...fixturePage, state })
  await session.start(); expect(await session.send('blocked', 2)).toBe(false); expect(api.send).not.toHaveBeenCalled()
})
it('leaves, cancels polling, and rejects further sends', async () => {
  const { api, session } = setup(); await session.start()
  expect(await session.leave()).toBe(true)
  expect(session.getSnapshot().left).toBe(true)
  expect(await session.send('blocked', 2)).toBe(false)
  expect(api.dispose).toHaveBeenCalledTimes(1)
})
it('uses sender-scoped IDs, generic participant labels and Retry-After guidance', () => {
  const body = encodeMessage('hi', 2, encounterMetadata).body, a = messageEvent(body)
  const b = { ...a, sequence: 9, message: { ...a.message, senderParticipantId: otherId } }
  expect(mergeEvents([], [a, b])).toHaveLength(2)
  expect(participantLabel(fixtureRoom, selfId)).toBe('You')
  expect(participantLabel(fixtureRoom, otherId)).toBe('Participant 2')
  expect(retryAfterMilliseconds('12')).toBe(12000)
  expect(retryAfterMilliseconds('Wed, 01 Jan 2031 00:00:10 GMT', Date.parse('2031-01-01T00:00:00Z'))).toBe(10000)
  expect(retryDelay(new EncounterError(429, '', 120000), 2)).toBe(120000)
})
it('keeps Retry-After in force across manual refresh and reconnect attempts', async () => {
  const { api, session } = setup()
  api.events.mockRejectedValueOnce(new EncounterError(429, '', 10000))
  await session.start()
  await session.refresh(); await session.refresh()
  expect(api.events).toHaveBeenCalledTimes(1)
})
it('does not let an old cross-tab acknowledgment delete a newer outbox entry', async () => {
  const { session, api, outbox } = setup(); await session.start()
  api.send.mockRejectedValueOnce(new EncounterError(0))
  await session.send('first', 2)
  const first = (await outbox.get('node-one', roomId))!
  await outbox.remove('node-one', roomId, first.body.messageId)
  const next = { ...first, ...encodeMessage('next', 2, encounterMetadata) }
  await outbox.add(next)
  await outbox.remove('node-one', roomId, first.body.messageId)
  expect((await outbox.get('node-one', roomId))?.body.messageId).toBe(next.body.messageId)
})
it('does not report failure after polling has already confirmed an in-flight message', async () => {
  const { session, api } = setup(); await session.start()
  let reject!: (error: EncounterError) => void
  api.send.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
  const sending = session.send('already stored', 2)
  await vi.waitFor(() => expect(api.send).toHaveBeenCalledTimes(1))
  api.events.mockResolvedValueOnce({ ...fixturePage, events: [messageEvent(api.send.mock.calls[0][1])], nextAfterSequence: 7 })
  await session.refresh()
  reject(new EncounterError(0)); await sending
  expect(session.getSnapshot().sendError).toBeUndefined()
  expect(session.getSnapshot().pending).toBeUndefined()
  expect(session.getSnapshot().events).toHaveLength(1)
})
