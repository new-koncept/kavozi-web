import type { components } from '../../api/generated/schema'
import type { Intent } from '../model/Intent'

/** The single boundary from local Intent geography to Location transport. */
export function buildLocationDiscoveryAreas(activeIntents: Intent[]): components['schemas']['AreaRequest'][] {
  return activeIntents.filter((intent) => intent.active).map((intent) => {
    const geography = intent.geography
    if (!geography) throw new Error('Intent geography must be validated before projection.')
    return geography.type === 'RADIUS'
      ? { id: intent.discoveryAreaId, type: 'RADIUS', radiusMeters: geography.radiusMeters }
      : { id: intent.discoveryAreaId, type: 'ADMINISTRATIVE_AREA', administrativeAreaId: geography.administrativeAreaId }
  })
}
