import { ApiError, locationClient } from '../../api/locationClient'
import { presenceRepository } from '../persistence/db'
import { withPresenceLock } from './browserLock'
import type { LocationMetadata } from './metadata'

export function fixProblem(position: GeolocationPosition, metadata: LocationMetadata) {
  const { latitude, longitude, accuracy } = position.coords
  if (![latitude, longitude, accuracy, position.timestamp].every(Number.isFinite)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || accuracy < 0) return 'unavailable'
  if (accuracy > metadata.maxAccuracyMeters) return 'poor'
  if (position.timestamp > Date.now() + metadata.futureToleranceSeconds * 1000
    || position.timestamp < Date.now() - metadata.locationFreshnessSeconds * 1000) return 'stale'
  return null
}

export function submitLocation(id: string, position: GeolocationPosition, metadata: LocationMetadata) {
  return withPresenceLock(async () => {
    if (fixProblem(position, metadata)) throw new ApiError(422)
    const current = await presenceRepository.get()
    if (!current || current.id !== id) throw new ApiError(401)
    const delay = (current.lastLocationSentAt ?? 0) + current.locationInterval * 1000 - Date.now()
    if (delay > 0) return { wait: delay } as const
    const sequence = await presenceRepository.reserve(id, 'sequence')
    await presenceRepository.update(id, { lastLocationSentAt: Date.now() })
    const response = await locationClient.updateLocation(current, {
      latitude: position.coords.latitude, longitude: position.coords.longitude,
      accuracyMeters: position.coords.accuracy, observedAt: new Date(position.timestamp).toISOString(), sequence,
    })
    if (response.status !== 'ACCEPTED' || response.sequence !== sequence) throw new ApiError(502)
    await presenceRepository.update(id, {
      acceptedSequence: sequence, acceptedObservedAt: position.timestamp,
      ...(response.expiresAt && Number.isFinite(Date.parse(response.expiresAt)) ? { expiresAt: response.expiresAt } : {}),
    })
    return { accepted: true } as const
  })
}
