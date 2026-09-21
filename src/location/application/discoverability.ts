import type { LocalPresence } from '../model/local'
import type { LocationState } from '../hooks/useGeolocation'

export type DiscoveryReadiness = {
  now: number
  presence?: Pick<LocalPresence, 'expiresAt' | 'acceptedSequence' | 'acceptedObservedAt'> | null
  loading: boolean
  stopping: boolean
  error: boolean
  enabledCount: number
  freshnessSeconds?: number
  futureToleranceSeconds?: number
  location: LocationState['status']
  synchronizationMessage?: string
  synchronization: 'pending' | 'failed' | 'ready'
  inbox: 'pending' | 'failed' | 'paused' | 'ready'
}
export type DiscoveryAction = 'start' | 'location' | 'sync' | 'retry' | 'inbox' | 'manage'
export type Discoverability = {
  label: 'DISCOVERABLE' | 'NOT DISCOVERABLE'
  discoverable: boolean
  canPoll: boolean
  tone: 'success' | 'warning' | 'neutral' | 'error'
  explanation: string
  action?: DiscoveryAction
}

/** Fail closed: saved intent preferences alone never establish operational discovery. */
export function deriveDiscoverability(input: DiscoveryReadiness): Discoverability {
  const blocked = (explanation: string, tone: Discoverability['tone'] = 'warning', action?: DiscoveryAction, canPoll = false): Discoverability =>
    ({ label: 'NOT DISCOVERABLE', discoverable: false, canPoll, tone, explanation, action })
  if (input.stopping) return blocked('Discovery is stopping on this device.', 'neutral')
  if (input.error) return blocked('Kavozi could not update your discovery status.', 'error', 'retry')
  if (input.loading) return blocked('Preparing discovery on this device…')
  if (!input.presence) return blocked('Discovery is stopped on this device.', 'neutral', 'start')
  if (!(Date.parse(input.presence.expiresAt) > input.now)) return blocked('Your anonymous presence has expired. Restart discovery.', 'warning', 'start')
  if (input.synchronization === 'failed') return blocked(input.synchronizationMessage ?? 'Kavozi could not synchronize your intent changes. Your previous saved choices are unchanged.', 'error', 'sync')
  if (input.synchronization === 'pending') return blocked('Your intent changes are still being synchronized.')
  if (!input.enabledCount) return blocked('Turn on at least one intent to become discoverable.', 'neutral', 'manage')
  const observed = input.presence.acceptedObservedAt
  const fresh = input.presence.acceptedSequence > 0 && observed !== undefined &&
    observed <= input.now + (input.futureToleranceSeconds ?? 0) * 1000 &&
    input.now < observed + (input.freshnessSeconds ?? 0) * 1000
  if (!fresh) {
    const expired = observed !== undefined && Number.isFinite(observed) && input.freshnessSeconds !== undefined &&
      input.now >= observed + input.freshnessSeconds * 1000
    return blocked(expired ? 'Location is not fresh enough. Update your location to become discoverable.'
      : 'A fresh location must be accepted before discovery can begin.', 'warning', 'location')
  }
  // Polling must bootstrap and recover independently of its own success state.
  if (input.inbox === 'failed') return blocked('Discovery inbox is temporarily unavailable.', 'error', 'inbox', true)
  if (input.inbox === 'paused') return blocked('Discovery is waiting for a connection.', 'warning', 'inbox', true)
  if (input.inbox !== 'ready') return blocked('Checking discovery availability…', 'warning', undefined, true)
  return { label: 'DISCOVERABLE', discoverable: true, canPoll: true, tone: 'success',
    explanation: 'Your enabled intents are discoverable through location and hard requirements. Preferences and agent instructions stay on this device.' }
}
