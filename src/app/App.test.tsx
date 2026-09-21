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
  await db.presences.clear(); await db.preferences.clear(); await db.intents.clear()
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
  await waitFor(() => expect(apiState.fixes.length).toBeGreaterThan(0))
  const toggle = await screen.findByRole('switch', { name: 'Turn Weekend diving on' })
  await waitFor(() => expect(toggle).toBeEnabled())
  await user.click(toggle)
  await screen.findByText('DISCOVERABLE')
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
    expect(apiState.configurations.at(-1)).toMatchObject({ projections: [{ geography: { type: 'RADIUS', radiusMeters: 5000 } }] })
    expect(apiState.configurations.every((body) => Object.keys(body).join() === 'projections')).toBe(true)
    expect(apiState.auth.every((value) => value === 'KavoziPresence test-secret-1')).toBe(true)
    expect(screen.queryByText('Something matched')).not.toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: 'Turn Weekend diving off' }))
    await waitFor(() => expect(apiState.configurations.at(-1)).toEqual({ projections: [] }))
  })
  it('coalesces noisy fixes and does not send poor accuracy', async () => {
    mount(); await discover()
    act(() => { emitPosition(position({ accuracy: 20 })); emitPosition(position({ accuracy: 30 })) })
    expect(apiState.fixes).toHaveLength(1)
    act(() => emitPosition(position({ accuracy: 1000 })))
    await screen.findByText(/Accuracy is too poor/)
    expect(apiState.fixes).toHaveLength(1)
  })
  it('keeps an enabled switch ON with a missing or stale accepted location', async () => {
    const intent = (await db.intents.toArray())[0]
    await db.intents.update(intent.id, { active: true })
    mount()
    await screen.findByText(/A fresh location must be accepted/)
    expect(screen.getByRole('heading', { name: 'NOT DISCOVERABLE' })).toBeVisible()
    expect(screen.getByRole('switch', { name: 'Turn Weekend diving off' })).toBeChecked()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Update location' }))
    await screen.findByRole('heading', { name: 'DISCOVERABLE' })
    const presence = (await presenceRepository.get())!
    await act(async () => { await presenceRepository.update(presence.id, { acceptedObservedAt: Date.now() - 130_000 }) })
    await screen.findByText(/Location is not fresh enough/)
    expect(screen.queryByRole('heading', { name: 'DISCOVERABLE' })).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Turn Weekend diving off' })).toBeChecked()
    expect(screen.queryByText('Active', { exact: true })).not.toBeInTheDocument()
  })
  it('shows no-enabled-intents state and supports keyboard toggling without changing another intent', async () => {
    const other = fixtureIntent({ title: 'Another possibility' })
    await db.intents.put(other)
    mount()
    await screen.findByText('Turn on at least one intent to become discoverable.')
    const toggle = screen.getByRole('switch', { name: 'Turn Weekend diving on' })
    await waitFor(() => expect(toggle).toBeEnabled())
    toggle.focus()
    await userEvent.setup().keyboard(' ')
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Turn Weekend diving off' })).toBeChecked())
    expect(screen.getByRole('switch', { name: 'Turn Another possibility on' })).not.toBeChecked()
    expect((await db.intents.get(other.id))?.active).toBe(false)
    expect(screen.getByRole('heading', { name: 'NOT DISCOVERABLE' })).toBeVisible()
  })
  it('blocks discovery during a toggle, prevents duplicate changes, and retains saved choices on sync failure until retry', async () => {
    const other = fixtureIntent({ title: 'Another possibility' })
    await db.intents.put(other)
    mount(); const user = await discover()
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    server.use(http.put(`${base}/v1/presences/:presenceId/discovery-projections`, async () => {
      await pending
      return new HttpResponse(null, { status: 503 })
    }))
    try {
      await user.click(screen.getByRole('switch', { name: 'Turn Another possibility on' }))
      await screen.findByRole('progressbar', { name: 'Saving Another possibility' })
      expect(screen.getByRole('heading', { name: 'NOT DISCOVERABLE' })).toBeVisible()
      expect(screen.getByRole('switch', { name: 'Turn Weekend diving off' })).toBeDisabled()
      expect(screen.queryByRole('heading', { name: 'DISCOVERABLE' })).not.toBeInTheDocument()
    } finally { release() }
    await screen.findByRole('button', { name: 'Retry synchronization' })
    expect(screen.getByRole('switch', { name: 'Turn Another possibility on' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Turn Weekend diving off' })).toBeChecked()
    expect(screen.getByRole('heading', { name: 'NOT DISCOVERABLE' })).toBeVisible()
    server.resetHandlers()
    await user.click(screen.getByRole('button', { name: 'Retry synchronization' }))
    await screen.findByRole('heading', { name: 'DISCOVERABLE' })
    expect(apiState.configurations.at(-1)?.projections).toHaveLength(2)
    expect(screen.queryByText(/could not synchronize/)).not.toBeInTheDocument()
  })
  it('never claims discoverability when the inbox fails and recovers through the panel action', async () => {
    server.use(http.get(`${base}/v1/presences/:presenceId/inbox`, () => new HttpResponse(null, { status: 503 })))
    mount(); const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Enable location' }))
    const toggle = screen.getByRole('switch', { name: 'Turn Weekend diving on' })
    await waitFor(() => expect(toggle).toBeEnabled()); await user.click(toggle)
    await screen.findByText('Discovery inbox is temporarily unavailable.')
    expect(screen.queryByRole('heading', { name: 'DISCOVERABLE' })).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Turn Weekend diving off' })).toBeChecked()
    server.resetHandlers()
    await user.click(screen.getByRole('button', { name: 'Retry discovery' }))
    await screen.findByRole('heading', { name: 'DISCOVERABLE' })
    expect(screen.queryByText('Discovery inbox is temporarily unavailable.')).not.toBeInTheDocument()
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
    expect(screen.getByRole('heading', { name: 'NOT DISCOVERABLE' })).toBeVisible()
    expect(screen.getByRole('switch', { name: 'Turn Weekend diving off' })).toBeChecked()
    expect(screen.getByText('Discovery is stopped on this device.')).toBeVisible()
    expect(apiState.deletes).toBe(1)
    expect(await presenceRepository.get()).toBeUndefined()
    expect(navigator.geolocation.clearWatch).toHaveBeenCalled()
    view.unmount(); mount()
    await screen.findByRole('button', { name: 'Start discovery' })
    expect(apiState.creates).toBe(1)
  })
})
