import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import App from '../../app/App'
import { theme } from '../../app/theme'
import { createQueryClient } from '../../app/queryClient'
import { apiState, position, resetApiState, server } from '../../test/server'
import { fixtureIntent } from '../../test/intentFixtures'
import { db } from '../../location/persistence/db'
import { withPresenceLock } from '../../location/application/browserLock'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
const clients: ReturnType<typeof createQueryClient>[] = []
beforeEach(() => {
  resetApiState()
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
    watchPosition: vi.fn((success: PositionCallback) => { queueMicrotask(() => success(position())); return 1 }),
    getCurrentPosition: vi.fn((success: PositionCallback) => success(position())), clearWatch: vi.fn(),
  } })
})
afterEach(async () => {
  cleanup()
  for (const client of clients) { await client.cancelQueries(); client.clear() }
  clients.length = 0
  await withPresenceLock(async () => undefined)
  await db.intents.clear(); await db.presences.clear(); await db.preferences.clear(); await db.configurations.clear()
  server.resetHandlers()
})
function mount() {
  const client = createQueryClient(); clients.push(client)
  const view = render(<QueryClientProvider client={client}><ThemeProvider theme={theme}><App /></ThemeProvider></QueryClientProvider>)
  return { ...view, client }
}
const user = () => userEvent.setup()
async function paste(u: ReturnType<typeof user>, input: HTMLElement, value: string) {
  await u.click(input)
  await u.paste(value)
}
async function openCreate() {
  const u = user()
  await u.click(await screen.findByRole('button', { name: 'Your intents' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create intent' })).toBeEnabled())
  await u.click(screen.getByRole('button', { name: 'Create intent' }))
  await u.click(await screen.findByRole('button', { name: /Dive Buddy Find a possibility/ }))
  await screen.findByRole('textbox', { name: 'Intent title' })
  return u
}

it('fetches the dynamic catalogue and definition, creates, saves, reloads and edits an Intent locally', async () => {
  const first = mount()
  const u = await openCreate()
  expect(apiState.templateRequests).toContain('catalogue')
  expect(apiState.templateRequests).toContain('dive')
  await paste(u, screen.getByRole('textbox', { name: 'Intent title' }), 'My weekend dives')
  await u.click(screen.getByRole('combobox', { name: 'Where' }))
  await u.click(screen.getByRole('option', { name: 'Around me' }))
  await u.type(screen.getByRole('spinbutton', { name: 'Radius (meters)' }), '5000')
  await u.type(screen.getByRole('spinbutton', { name: 'Completed dives' }), '120')
  await u.click(screen.getByRole('combobox', { name: 'Certification' }))
  await u.click(screen.getByRole('option', { name: 'Advanced Open Water' }))
  await u.type(screen.getByRole('combobox', { name: 'Languages' }), 'English')
  await u.click(screen.getByRole('option', { name: 'English' }))
  await u.click(screen.getByRole('combobox', { name: 'Insured' }))
  await u.click(screen.getByRole('option', { name: 'Yes' }))
  await paste(u, screen.getByRole('textbox', { name: 'A little about me' }), 'A careful diver')
  await u.type(screen.getByRole('spinbutton', { name: 'Depth — from' }), '10')
  await u.type(screen.getByRole('spinbutton', { name: 'Depth — to' }), '20')
  await u.click(screen.getByRole('button', { name: 'Add Certification requirement' }))
  await u.click(screen.getByRole('combobox', { name: 'Certification target' }))
  await u.click(screen.getByRole('option', { name: 'Advanced Open Water' }))
  await paste(u, screen.getByRole('textbox', { name: 'Your agent instruction' }), 'Patient buddies, please.')
  await u.click(screen.getByRole('button', { name: 'Save intent' }))
  await screen.findByRole('button', { name: 'Create intent' })
  const saved = (await db.intents.toArray())[0]
  expect(saved.title).toBe('My weekend dives')
  expect(saved.claims.experience).toEqual({ type: 'NUMBER', value: 120 })
  expect(saved.claims.certification).toEqual({ type: 'CODE', value: 'AOW' })
  expect(saved.encounterOptions.depth).toEqual({ type: 'RANGE', lower: 10, upper: 20 })
  expect(saved.requirements[0].value).toEqual({ type: 'CODE', value: 'AOW' })
  first.unmount(); mount()
  await u.click(await screen.findByRole('button', { name: 'Your intents' }))
  await u.click(await screen.findByRole('button', { name: 'Edit' }))
  const title = await screen.findByRole('textbox', { name: 'Intent title' })
  expect(title).toHaveValue('My weekend dives')
  await u.clear(title); await paste(u, title, 'Renamed dives')
  await u.click(screen.getByRole('button', { name: 'Save intent' }))
  await screen.findByRole('button', { name: 'Create intent' })
  expect(await db.intents.get(saved.id)).toMatchObject({ title: 'Renamed dives', discoveryAreaId: saved.discoveryAreaId })
}, 15000)

it('activates two Intents, sends geography only, maps an anonymous offer to local titles, and deactivates', async () => {
  const dive = fixtureIntent(), coffee = fixtureIntent({ title: 'Coffee plans', templateKey: 'coffee', agentInstruction: undefined })
  await db.intents.bulkPut([dive, coffee]); apiState.offer = true
  mount(); const u = user()
  await u.click(await screen.findByRole('button', { name: 'Enable location' }))
  await screen.findByText('Location active')
  for (const title of ['Weekend diving', 'Coffee plans']) {
    const toggle = await screen.findByRole('switch', { name: `Activate ${title}` })
    await waitFor(() => expect(toggle).toBeEnabled()); await u.click(toggle)
    await waitFor(() => expect(toggle).toBeChecked())
  }
  await waitFor(() => expect(apiState.configurations.at(-1)?.areas).toHaveLength(2))
  const payload = apiState.configurations.at(-1)!
  expect(Object.keys(payload)).toEqual(['areas'])
  expect(payload.areas.every((area) => Object.keys(area).sort().join() === 'id,radiusMeters,type')).toBe(true)
  // Refetch after the normal inbox cadence is tested separately; here refresh the mocked response explicitly.
  await act(async () => { await clients.at(-1)!.invalidateQueries({ queryKey: ['inbox'] }) })
  await screen.findByText('Through your local intents:')
  expect(screen.getAllByText('Weekend diving').length).toBeGreaterThan(1)
  await waitFor(() => expect(screen.getAllByText('Coffee plans').length).toBeGreaterThan(1))
  expect(document.body.textContent).not.toMatch(/48\.1486|test-secret/)
  await u.click(screen.getByRole('switch', { name: 'Activate Weekend diving' }))
  await waitFor(() => expect(apiState.configurations.at(-1)?.areas.map((area) => area.id)).toEqual([coffee.discoveryAreaId]))
})

it('reuses debounced administrative search for Intent geography and persists the selected ID', async () => {
  mount(); const u = await openCreate()
  await paste(u, screen.getByRole('textbox', { name: 'Intent title' }), 'City diving')
  await u.click(screen.getByRole('combobox', { name: 'Where' }))
  await u.click(screen.getByRole('option', { name: 'City or district' }))
  await u.type(screen.getByRole('combobox', { name: 'Search a city or district' }), 'Bratislava')
  await u.click(await screen.findByRole('option', { name: /Bratislava City/ }))
  await paste(u, screen.getByRole('textbox', { name: 'Your agent instruction' }), 'Talk about diving.')
  await u.click(screen.getByRole('button', { name: 'Save intent' }))
  await screen.findByRole('button', { name: 'Create intent' })
  expect((await db.intents.toArray())[0].geography).toEqual({ type: 'ADMINISTRATIVE_AREA', administrativeAreaId: '00000000-0000-4000-8000-888888888888', displayName: 'Bratislava', administrativeAreaType: 'CITY' })
  expect(apiState.searches).toEqual(['Bratislava'])
}, 15000)

it('preserves a changed-template Intent, marks Needs review, and withdraws its active geography', async () => {
  const intent = fixtureIntent({ active: true, claims: { certification: { type: 'CODE', value: 'AOW' } } })
  await db.intents.put(intent)
  const { client } = mount()
  await waitFor(() => expect(apiState.configurations.at(-1)?.areas).toHaveLength(1))
  apiState.templates[0].fields = []
  await act(async () => { await client.invalidateQueries({ queryKey: ['intentTemplate'] }) })
  await screen.findByText('Needs review')
  await waitFor(() => expect(screen.getByRole('switch', { name: 'Activate Weekend diving' })).not.toBeChecked())
  expect(screen.getByRole('switch', { name: 'Activate Weekend diving' })).toBeDisabled()
  expect((await db.intents.get(intent.id))?.claims).toEqual(intent.claims)
  await waitFor(() => expect(apiState.configurations.at(-1)).toEqual({ areas: [] }))
})

it('confirms deletion of an active Intent before synchronization and local removal', async () => {
  const intent = fixtureIntent({ active: true }); await db.intents.put(intent)
  mount(); const u = user()
  await u.click(await screen.findByRole('button', { name: 'Your intents' }))
  await u.click(await screen.findByRole('button', { name: 'Delete' }))
  await screen.findByRole('dialog')
  expect(await db.intents.get(intent.id)).toBeDefined()
  await u.click(screen.getByRole('button', { name: 'Deactivate and delete' }))
  await waitFor(async () => expect(await db.intents.get(intent.id)).toBeUndefined())
  expect(apiState.configurations.at(-1)).toEqual({ areas: [] })
})
