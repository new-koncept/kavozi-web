import { describe, expect, it } from 'vitest'
import { deriveDiscoverability, type DiscoveryReadiness } from './discoverability'

const ready: DiscoveryReadiness = {
  now: 100_000, presence: { expiresAt: new Date(200_000).toISOString(), acceptedSequence: 1, acceptedObservedAt: 90_000 },
  freshnessSeconds: 20, futureToleranceSeconds: 2, loading: false, stopping: false, error: false,
  enabledCount: 1, location: 'active', synchronization: 'ready', inbox: 'ready',
}
describe('deriveDiscoverability', () => {
  it('claims discoverability only with all operational prerequisites', () => {
    expect(deriveDiscoverability(ready)).toMatchObject({ label: 'DISCOVERABLE', discoverable: true, canPoll: true })
  })
  it.each<Partial<DiscoveryReadiness>>([
    { enabledCount: 0 }, { presence: null }, { stopping: true }, { loading: true }, { error: true },
    { synchronization: 'pending' }, { synchronization: 'failed' }, { inbox: 'pending' }, { inbox: 'failed' }, { inbox: 'paused' },
    { now: 110_000 }, { now: 200_000 }, { freshnessSeconds: undefined },
    { presence: { ...ready.presence!, acceptedSequence: 0 } },
    { presence: { ...ready.presence!, acceptedObservedAt: undefined } },
    { presence: { ...ready.presence!, acceptedObservedAt: 103_000 } },
    { presence: { ...ready.presence!, expiresAt: 'invalid' } },
  ])('fails closed for a blocking prerequisite: %j', (override) => {
    expect(deriveDiscoverability({ ...ready, ...override })).toMatchObject({ label: 'NOT DISCOVERABLE', discoverable: false })
  })
  it.each(['idle', 'acquiring', 'stale', 'poor', 'denied', 'rejected', 'unavailable'] as const)('retains accepted freshness during %s acquisition state', (location) => {
    expect(deriveDiscoverability({ ...ready, location }).discoverable).toBe(true)
    expect(deriveDiscoverability({ ...ready, location, now: 110_000 }).discoverable).toBe(false)
  })
  it('identifies stale accepted location independently of GPS hook state', () => {
    expect(deriveDiscoverability({ ...ready, now: 110_000 })).toMatchObject({ action: 'location', explanation: expect.stringContaining('not fresh enough') })
  })
  it('allows polling to bootstrap and recover without claiming discoverability', () => {
    expect(deriveDiscoverability({ ...ready, inbox: 'failed' })).toMatchObject({ canPoll: true, discoverable: false, action: 'inbox' })
    expect(deriveDiscoverability({ ...ready, synchronization: 'failed' }).canPoll).toBe(false)
  })
  it('prioritizes deliberate stopping over pending synchronization', () => {
    expect(deriveDiscoverability({ ...ready, stopping: true, synchronization: 'pending' })).toMatchObject({ tone: 'neutral', explanation: 'Discovery is stopping on this device.' })
  })
})
