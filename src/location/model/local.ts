/** Browser state; deliberately separate from generated transport models. */
export interface LocalPresence {
  key: 'current'
  id: string
  token: string
  expiresAt: string
  locationInterval: number
  inboxInterval: number
  sequence: number
  acceptedSequence: number
  revision: number
  syncedRevision: number
  lastLocationSentAt?: number
  acceptedObservedAt?: number
}

export type LocalDiscoveryArea =
  | { id: string; kind: 'radius'; meters: number }
  | { id: string; kind: 'administrative'; administrativeId: string; name: string; category: string }

export function formatRadius(meters: number) {
  return meters < 1000 ? `${meters} m` : `${Number((meters / 1000).toFixed(2))} km`
}

export function areaLabel(area: LocalDiscoveryArea) {
  return area.kind === 'radius' ? `${formatRadius(area.meters)} around me` : area.name
}

/** Only our own saved IDs can label an offer. Unknown IDs convey nothing. */
export function matchedLocalAreas(ids: readonly string[], localAreas: LocalDiscoveryArea[]) {
  return localAreas.filter((area) => ids.includes(area.id))
}
