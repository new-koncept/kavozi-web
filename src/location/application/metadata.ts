import { ApiError, locationClient, type Schema } from '../../api/locationClient'

export type LocationMetadata = Required<Schema['MetadataResponse']>

export async function loadMetadata(): Promise<LocationMetadata> {
  const value = await locationClient.getMetadata()
  const positive = ['presenceTtlSeconds', 'locationFreshnessSeconds', 'locationUpdateAfterSeconds',
    'inboxPollAfterSeconds', 'discoveryIntervalMilliseconds', 'offerTtlSeconds', 'maxDiscoveryAreas',
    'minRadiusMeters', 'maxRadiusMeters', 'maxAccuracyMeters'] as const
  if (positive.some((key) => typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key]! <= 0)
    || typeof value.futureToleranceSeconds !== 'number' || !Number.isFinite(value.futureToleranceSeconds) || value.futureToleranceSeconds < 0
    || !Array.isArray(value.supportedAreaTypes) || typeof value.apiVersion !== 'string'
    || value.minRadiusMeters! > value.maxRadiusMeters!) throw new ApiError(502)
  // Checked here because the generated schema makes every response property optional.
  return value as LocationMetadata
}
