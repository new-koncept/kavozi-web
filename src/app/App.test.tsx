import { StrictMode } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import App from './App'
import { fixtureIntent } from '../test/intentFixtures'
import { theme } from './theme'
import { createQueryClient } from './queryClient'
import { apiState, base, position, resetApiState, server } from '../test/server'
import { db, presenceRepository } from '../location/persistence/db'
import { withPresenceLock } from '../location/application/browserLock'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
const clients: ReturnType<typeof createQueryClient>[] = []
let emitPosition: PositionCallback
beforeEach(async () => {
  resetApiState()
  await db.intents.put(fixtureIntent())
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
    watchPosition: vi.fn((success: PositionCallback) => { emitPosition = success; queueMicrotask(() => success(position())); return 1 }),
    getCurrentPosition: vi.fn((success: PositionCallback) => success(position())), clearWatch: vi.fn(),
  } })
})
afterEach(async () => {
  cleanup()
  for (const client of clients) { await client.cancelQueries(); client.clear() }
  clients.length = 0
  await withPresenceLock(async () => undefined)
  await db.presences.clear(); await db.configurations.clear(); await db.preferences.clear(); await db.intents.clear()
  server.resetHandlers()
})
function mount() {
  const client = createQueryClient()
  clients.push(client)
  return render(<StrictMode><QueryClientProvider client={client}><ThemeProvider theme={theme}><App /></ThemeProvider></QueryClientProvider></StrictMode>)
}
async function discover() {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Enable location' }))
  await screen.findByText('Location active')
  const toggle = await screen.findByRole('switch', { name: 'Activate Weekend diving' })
  await waitFor(() => expect(toggle).toBeEnabled())
  await user.click(toggle)
  await screen.findByText('You’re discoverable.')
  await waitFor(() => expect(apiState.inboxCalls).toBeGreaterThan(0))
  return user
}

describe('anonymous Location application', () => {
  it('creates once under StrictMode, persists credentials, and reuses Presence after reload', async () => {
    const first = mount()
    await screen.findByRole('button', { name: 'Enable location' })
    expect(apiState.creates).toBe(1)
    expect(apiState.createAuth).toEqual([null])
    const stored = await presenceRepository.get()
    expect(stored?.token).toBe('test-secret-1')
    expect(document.body.textContent).not.toContain(stored?.token)
    first.unmount()
    mount()
    await screen.findByRole('button', { name: 'Enable location' })
    expect(apiState.creates).toBe(1)
    expect((await presenceRepository.get())?.id).toBe(stored?.id)
  })
  it('submits location and complete area sets, then polls an empty inbox without invented results', async () => {
    mount()
    const user = await discover()
    expect(apiState.fixes[0]).toMatchObject({ latitude: 48.1486, longitude: 17.1077, accuracyMeters: 18, sequence: 1 })
    expect(Date.parse(apiState.fixes[0].observedAt)).toBeGreaterThan(0)
    expect(apiState.configurations.at(-1)).toMatchObject({ areas: [{ type: 'RADIUS', radiusMeters: 5000 }] })
    expect(apiState.configurations.every((body) => Object.keys(body).join() === 'areas')).toBe(true)
    expect(apiState.auth.every((value) => value === 'KavozilPresence test-secret-1')).toBe(true)
    expect(screen.queryByText('Something matched')).not.toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: 'Activate Weekend diving' }))
    await waitFor(() => expect(apiState.configurations.at(-1)).toEqual({ areas: [] }))
  })
  it('coalesces noisy fixes and does not send poor accuracy', async () => {
    mount(); await discover()
    act(() => { emitPosition(position({ accuracy: 20 })); emitPosition(position({ accuracy: 30 })) })
    expect(apiState.fixes).toHaveLength(1)
    act(() => emitPosition(position({ accuracy: 1000 })))
    await screen.findByText(/Accuracy is too poor/)
    expect(apiState.fixes).toHaveLength(1)
  })
  it('shows an anonymous offer labeled only with own areas and records Continue', async () => {
    apiState.offer = true
    mount(); const user = await discover()
    await screen.findByText('Something matched')
    expect(screen.getByText('Through your local intents:')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/48\.1486|17\.1077|test-secret/)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('Interest recorded.')
    expect(apiState.accepted).toEqual(['00000000-0000-4000-8000-999999999999'])
    expect(screen.getByText('Waiting privately for the next step.')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/They accepted|other user|peer/i)
  })
  it('records Pass and hides the offer locally', async () => {
    apiState.offer = true
    mount(); const user = await discover()
    await user.click(await screen.findByRole('button', { name: 'Pass' }))
    await waitFor(() => expect(screen.queryByText('Something matched')).not.toBeInTheDocument())
    expect(apiState.declined).toHaveLength(1)
  })
  it('replaces invalid credentials once and then stops instead of looping', async () => {
    server.use(http.put(`${base}/v1/presences/:presenceId/location`, () => new HttpResponse(null, { status: 401 })))
    mount()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Enable location' }))
    await waitFor(() => expect(apiState.creates).toBe(2))
    await user.click(await screen.findByRole('button', { name: 'Enable location' }))
    await screen.findByRole('button', { name: 'Start discovery' })
    expect(apiState.creates).toBe(2)
    expect(await presenceRepository.get()).toBeUndefined()
  })
  it('deletes Presence, clears the token, and remains stopped after reload', async () => {
    const view = mount(); const user = await discover()
    await user.click(screen.getByRole('button', { name: 'Stop discovery' }))
    await screen.findByRole('button', { name: 'Start discovery' })
    expect(apiState.deletes).toBe(1)
    expect(await presenceRepository.get()).toBeUndefined()
    expect(navigator.geolocation.clearWatch).toHaveBeenCalled()
    view.unmount(); mount()
    await screen.findByRole('button', { name: 'Start discovery' })
    expect(apiState.creates).toBe(1)
  })
})
