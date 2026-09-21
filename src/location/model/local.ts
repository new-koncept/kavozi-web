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
  lastLocationSentAt?: number
  acceptedObservedAt?: number
}

export function formatRadius(meters: number) {
  return meters < 1000 ? `${meters} m` : `${Number((meters / 1000).toFixed(2))} km`
}
