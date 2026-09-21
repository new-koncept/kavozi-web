import { act, renderHook } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { locationClient } from '../../api/locationClient'
import { createQueryClient } from '../../app/queryClient'
import type { LocalPresence } from '../model/local'
import { useInbox } from './useInbox'

afterEach(() => vi.useRealTimers())
it('honors the inbox response interval and does not refetch aggressively when re-enabled', async () => {
  vi.useFakeTimers()
  const request = vi.spyOn(locationClient, 'getInbox').mockResolvedValue({ pollAfterSeconds: 60, offers: [] })
  const presence: LocalPresence = { key: 'current', id: 'own', token: 'private', expiresAt: '2099-01-01T00:00:00Z',
    locationInterval: 5, inboxInterval: 30, sequence: 0, acceptedSequence: 0 }
  const client = createQueryClient()
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const hook = renderHook(({ enabled }) => useInbox(presence, enabled), { wrapper, initialProps: { enabled: true } })
  await act(() => vi.advanceTimersByTimeAsync(1))
  expect(request).toHaveBeenCalledTimes(1)
  hook.rerender({ enabled: false }); hook.rerender({ enabled: true })
  await act(() => vi.advanceTimersByTimeAsync(59_000))
  expect(request).toHaveBeenCalledTimes(1)
  await act(() => vi.advanceTimersByTimeAsync(1_100))
  expect(request).toHaveBeenCalledTimes(2)
  hook.unmount(); client.clear()
})
