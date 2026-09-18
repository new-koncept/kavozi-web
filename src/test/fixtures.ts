import type { Schema } from '../api/locationClient'

export const metadata: Required<Schema['MetadataResponse']> = {
  apiVersion: 'v1', presenceTtlSeconds: 3600, locationFreshnessSeconds: 120,
  locationUpdateAfterSeconds: 5, inboxPollAfterSeconds: 30, discoveryIntervalMilliseconds: 10000,
  offerTtlSeconds: 120, maxDiscoveryAreas: 4, supportedAreaTypes: ['RADIUS', 'ADMINISTRATIVE_AREA'],
  minRadiusMeters: 100, maxRadiusMeters: 20000, maxAccuracyMeters: 100, futureToleranceSeconds: 10,
}
export function fixturePresence(number = 1): Required<Schema['PresenceResponse']> {
  return { presenceId: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
    presenceToken: `test-secret-${number}`, expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    locationUpdateAfterSeconds: 5, inboxPollAfterSeconds: 30 }
}
