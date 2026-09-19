import { ApiError, locationClient, type Schema } from '../../api/locationClient'
import type { LocalDiscoveryArea } from '../model/local'
import { discoveryAreaRepository, presenceRepository } from '../persistence/db'
import { withPresenceLock } from './browserLock'
import type { LocationMetadata } from './metadata'

export function toTransportAreas(areas: LocalDiscoveryArea[]): Schema['AreaRequest'][] {
  return areas.map((area) => area.kind === 'radius'
    ? { id: area.id, type: 'RADIUS', radiusMeters: area.meters }
    : { id: area.id, type: 'ADMINISTRATIVE_AREA', administrativeAreaId: area.administrativeId })
}

export function validateAreas(areas: LocalDiscoveryArea[], metadata: LocationMetadata) {
  return areas.length <= metadata.maxDiscoveryAreas && new Set(areas.map((a) => a.id)).size === areas.length
    && areas.every((area) => area.kind === 'radius'
      ? metadata.supportedAreaTypes.includes('RADIUS') && Number.isFinite(area.meters)
        && area.meters >= metadata.minRadiusMeters && area.meters <= metadata.maxRadiusMeters
      : metadata.supportedAreaTypes.includes('ADMINISTRATIVE_AREA') && Boolean(area.administrativeId))
}

export function replaceDiscoveryAreas(id: string, areas: LocalDiscoveryArea[], metadata: LocationMetadata) {
  return withPresenceLock(async () => {
    if (!validateAreas(areas, metadata)) throw new ApiError(400)
    const presence = await presenceRepository.get()
    if (!presence || presence.id !== id) throw new ApiError(401)
    await discoveryAreaRepository.save(areas)
    const revision = await presenceRepository.reserve(id, 'revision')
    const response = await locationClient.replaceDiscoveryAreas(presence, { areas: toTransportAreas(areas) })
    if (response.status !== 'RECORDED') throw new ApiError(502)
    await presenceRepository.update(id, { syncedRevision: revision })
  })
}
