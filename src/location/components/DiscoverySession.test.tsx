import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material'
import { afterEach, expect, it, vi } from 'vitest'
import { DiscoverySession } from './DiscoverySession'
import { createQueryClient } from '../../app/queryClient'
import { theme } from '../../app/theme'
import { locationClient } from '../../api/locationClient'
import { intentTemplateClient } from '../../intent/api/intentTemplateClient'
import { diveTemplate, fixtureIntent } from '../../test/intentFixtures'
import { metadata as defaults } from '../../test/fixtures'
import { position } from '../../test/server'
import { db, presenceRepository } from '../persistence/db'
import type { LocalPresence } from '../model/local'

const client = createQueryClient()
afterEach(async () => {
  cleanup(); client.clear(); vi.useRealTimers(); vi.restoreAllMocks()
  await db.presences.clear()
})
it('keeps accepted freshness through timeout and manual retry, expires on schedule, then submits a fresh provider observation', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  const started = Date.now()
  const metadata = { ...defaults, locationFreshnessSeconds: 90 }
  let presence: LocalPresence = { key: 'current', id: crypto.randomUUID(), token: 'test-only',
    expiresAt: new Date(started + 300_000).toISOString(), locationInterval: 30, inboxInterval: 15, sequence: 0, acceptedSequence: 0 }
  await presenceRepository.save(presence)
  let observation!: PositionCallback
  let failure!: PositionErrorCallback
  const watch = vi.fn((success: PositionCallback) => { observation = success; return watch.mock.calls.length })
  const get = vi.fn((_success: PositionCallback, error: PositionErrorCallback) => { failure = error })
  const clear = vi.fn()
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition: watch, getCurrentPosition: get, clearWatch: clear } })
  const put = vi.spyOn(locationClient, 'updateLocation').mockImplementation(async (_credentials, request) => ({ status: 'ACCEPTED', sequence: request.sequence, expiresAt: new Date(Date.now() + 300_000).toISOString() }))
  vi.spyOn(locationClient, 'getInbox').mockResolvedValue({ offers: [], pollAfterSeconds: 15 })
  vi.spyOn(intentTemplateClient, 'get').mockResolvedValue(diveTemplate)
  const intent = fixtureIntent({ active: true })
  const ui = () => <QueryClientProvider client={client}><ThemeProvider theme={theme}>
    <DiscoverySession presence={presence} metadata={metadata} intents={[intent]} synchronized syncing={false}
      onRetry={async () => true} stopping={false} onStop={() => {}} onManage={() => {}} onChanged={() => {}}
      loading={false} error={false} onStart={() => {}} onRecover={() => {}} />
  </ThemeProvider></QueryClientProvider>
  const view = render(ui())
  const settle = async () => {
    // Let IndexedDB/Query finish; advancing Date does not fabricate a provider observation.
    for (let i = 0; i < 10; i++) await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
      presence = (await presenceRepository.get())!
      view.rerender(ui())
    })
  }
  fireEvent.click(screen.getByRole('button', { name: 'Update location' }))
  expect(watch).toHaveBeenCalledTimes(1)
  await act(async () => { observation(position({}, started)) })
  await settle()
  expect(screen.getByRole('heading', { name: 'DISCOVERABLE' })).toBeVisible()
  expect(put).toHaveBeenCalledTimes(1)
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
  expect(get).toHaveBeenCalledTimes(1)
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); failure({ code: 3, message: 'Timeout', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }) })
  expect(screen.getByText(/Location refresh failed or timed out/)).toBeVisible()
  expect(screen.getByRole('heading', { name: 'DISCOVERABLE' })).toBeVisible()
  expect(screen.queryByText(/Location is not fresh enough/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Update location' }))
  expect(clear).toHaveBeenCalledTimes(1)
  expect(watch).toHaveBeenCalledTimes(2)
  expect(screen.getByText('Acquiring a fresh location…')).toBeVisible()
  expect(screen.getByRole('heading', { name: 'DISCOVERABLE' })).toBeVisible()
  await act(async () => { await vi.advanceTimersByTimeAsync(started + 90_000 - Date.now() - 1) })
  expect(screen.getByRole('heading', { name: 'DISCOVERABLE' })).toBeVisible()
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(screen.getByRole('heading', { name: 'NOT DISCOVERABLE' })).toBeVisible()
  expect(screen.getByText(/Location is not fresh enough/)).toBeVisible()
  expect(put).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Update location' }))
  expect(watch).toHaveBeenCalledTimes(3)
  const providerTimestamp = Date.now() - 1000
  await act(async () => { observation(position({}, providerTimestamp)) })
  await settle()
  expect(put).toHaveBeenCalledTimes(2)
  expect(put.mock.calls[1][1]).toMatchObject({ sequence: 2, observedAt: new Date(providerTimestamp).toISOString() })
  expect(presence.acceptedObservedAt).toBe(providerTimestamp)
  expect(screen.getByRole('heading', { name: 'DISCOVERABLE' })).toBeVisible()
})
