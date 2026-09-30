import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@mui/material'
import { theme } from '../../app/theme'
import { db } from '../../location/persistence/db'
import type { Schema } from '../../api/locationClient'
import type { EncounterClient } from '../api/encounterClient'
import { fixtureRoom, fixturePage, encounterMetadata, roomId, selfId, otherId } from '../testFixtures'
import { encodeMessage } from '../application/textProtocol'
import { Conversation } from './Conversation'

const holder = vi.hoisted(() => ({ api: null as EncounterClient | null }))
vi.mock('../api/encounterClient', async (original) => ({ ...await original<typeof import('../api/encounterClient')>(), createEncounterClient: () => holder.api! }))
function client() {
  return {
    dispose: vi.fn(), metadata: vi.fn(async () => encounterMetadata), get: vi.fn(async () => fixtureRoom),
    events: vi.fn(async (): Promise<Schema['EncounterEventPage']> => fixturePage),
    send: vi.fn(async (_id: string, body: Schema['SendEncounterMessageRequest']): Promise<Schema['MessageEvent']> => ({ type: 'MESSAGE', sequence: 10, message: { ...body, senderParticipantId: selfId } })),
    leave: vi.fn(async () => {}), claim: vi.fn(async () => fixtureRoom), list: vi.fn(async () => ({ encounters: [fixtureRoom] })),
  }
}
let api: ReturnType<typeof client>
beforeEach(async () => { await db.encounterOutbox.clear(); api = client(); holder.api = api })
afterEach(async () => { cleanup(); await db.encounterOutbox.clear() })
const mount = (onBack = vi.fn()) => render(<ThemeProvider theme={theme}><Conversation fingerprint="test-node" id={roomId} intents={[]} onBack={onBack} /></ThemeProvider>)
it('renders own/incoming text safely, contains unsupported payloads, and handles a generic roster', async () => {
  api.get.mockResolvedValue({ ...fixtureRoom, participants: [...fixtureRoom.participants, { participantId: '20000000-0000-4000-8000-000000000003', state: 'ACTIVE' }] })
  const own = encodeMessage('<img src=x onerror=alert(1)> čau 🌿', 2, encounterMetadata).body
  api.events.mockResolvedValue({ ...fixturePage, nextAfterSequence: 4, events: [
    { type: 'MESSAGE', sequence: 2, message: { ...own, senderParticipantId: selfId } },
    { type: 'MESSAGE', sequence: 3, message: { ...encodeMessage('Ahoj 👋', 2, encounterMetadata).body, senderParticipantId: otherId } },
    { type: 'MESSAGE', sequence: 4, message: { messageId: crypto.randomUUID(), senderParticipantId: otherId, protocol: 'unknown', payload: '**' } },
  ] })
  mount()
  await screen.findByText('Open · 3 participants')
  await screen.findByText('<img src=x onerror=alert(1)> čau 🌿')
  expect(document.querySelector('img')).toBeNull()
  expect(screen.getByText('Ahoj 👋')).toBeVisible()
  expect(screen.getByText('Unsupported message')).toBeVisible()
  expect(screen.getByText('You · Stored')).toBeVisible()
  expect(screen.getByRole('textbox', { name: /^Message$/ })).toBeEnabled()
})
it('blocks a draft after membership changes until a deliberate new sending decision', async () => {
  mount(); await screen.findByText('Open · 2 participants')
  fireEvent.change(screen.getByRole('textbox', { name: /^Message$/ }), { target: { value: 'For this group' } })
  api.get.mockResolvedValue({ ...fixtureRoom, membershipVersion: 3, participants: [...fixtureRoom.participants, { participantId: '20000000-0000-4000-8000-000000000003', state: 'ACTIVE' }] })
  api.events.mockResolvedValue({ ...fixturePage, membershipVersion: 3, nextAfterSequence: 4, events: [{ type: 'PARTICIPANT_JOINED', sequence: 4, participant: { participantId: '20000000-0000-4000-8000-000000000003', state: 'ACTIVE' } }] })
  fireEvent(window, new Event('online'))
  await screen.findByText(/The participant group changed/)
  expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
  expect(api.send).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Use current group' }))
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
  await waitFor(() => expect(api.send).toHaveBeenCalledTimes(1))
  expect(api.send.mock.calls[0][1].membershipVersion).toBe(3)
  await screen.findByText('You · Stored')
})
it('requires confirmation to leave and disables the composer while waiting', async () => {
  api.get.mockResolvedValue({ ...fixtureRoom, state: 'WAITING_FOR_MEMBERS' })
  api.events.mockResolvedValue({ ...fixturePage, state: 'WAITING_FOR_MEMBERS' })
  const back = vi.fn(); mount(back)
  await screen.findByText('Waiting for members · 2 participants')
  expect(screen.getByRole('textbox', { name: /^Message$/ })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Leave conversation' }))
  expect(api.leave).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm leave' }))
  await waitFor(() => expect(back).toHaveBeenCalledTimes(1))
  expect(api.leave).toHaveBeenCalledTimes(1)
})
