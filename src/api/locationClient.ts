import createClient from 'openapi-fetch'
import type { components, paths } from './generated/schema'
import type { LocalPresence } from '../location/model/local'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080'
export type Schema = components['schemas']
type Credentials = Pick<LocalPresence, 'id' | 'token'>

export class ApiError extends Error {
  readonly status: number
  constructor(status: number) {
    super(status === 0 ? 'The service is unavailable. Please try again.'
      : status === 401 || status === 403 ? 'Your anonymous presence is no longer usable.'
      : status === 409 ? 'This update is out of date. Try again; reset your presence if this continues.'
      : status === 400 || status === 422 ? 'The service could not accept this update. Check your settings or try a fresh location.'
      : status === 404 || status === 410 ? 'This presence or opportunity is no longer available.'
      : status === 429 ? 'Please wait before trying again.'
      : status >= 500 ? 'The service is temporarily unavailable. Please try again.'
      : 'The service returned an incomplete response. Please try again.')
    this.name = 'ApiError'
    this.status = status
  }
  get invalidPresence() { return this.status === 401 || this.status === 403 }
}

export const invalidPresenceEvents = new EventTarget()
export function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : 'Could not complete this action. Please try again.'
}

export function createLocationClient(baseUrl = API_BASE_URL) {
  const client = createClient<paths>({ baseUrl, fetch: (request) => globalThis.fetch(request) })
  async function result<T>(request: Promise<{ data?: T; response: Response }>): Promise<T> {
    let response: { data?: T; response: Response }
    try { response = await request } catch { throw new ApiError(0) }
    if (!response.response.ok) throw new ApiError(response.response.status)
    if (response.data === undefined) throw new ApiError(502)
    return response.data
  }
  // The prefix comes from the supplied security scheme, not the product name.
  const auth = (presence: Credentials) => ({ Authorization: `KavoziPresence ${presence.token}` })
  async function protectedRequest<T>(presence: Credentials, request: () => Promise<T>) {
    try { return await request() } catch (error) {
      if (error instanceof ApiError && error.invalidPresence) {
        invalidPresenceEvents.dispatchEvent(new CustomEvent('invalid', { detail: presence.id }))
      }
      throw error
    }
  }
  return {
    createPresence: () => result(client.POST('/v1/presences')),
    getMetadata: () => result(client.GET('/.well-known/kavozi-location')),
    searchAdministrativeAreas: (query: string, type?: 'CITY' | 'DISTRICT', signal?: AbortSignal) =>
      result(client.GET('/v1/location/administrative-areas', { params: { query: { query, type } }, signal })),
    updateLocation: (presence: Credentials, body: Schema['FixRequest']) => protectedRequest(presence, () =>
      result(client.PUT('/v1/presences/{presenceId}/location', { headers: auth(presence), params: { path: { presenceId: presence.id } }, body }))),
    replaceDiscoveryProjections: (presence: Credentials, body: Schema['DiscoveryProjectionsRequest']) => protectedRequest(presence, () =>
      result(client.PUT('/v1/presences/{presenceId}/discovery-projections', { headers: auth(presence), params: { path: { presenceId: presence.id } }, body }))),
    getInbox: (presence: Credentials, signal?: AbortSignal) => protectedRequest(presence, () =>
      result(client.GET('/v1/presences/{presenceId}/inbox', { headers: auth(presence), params: { path: { presenceId: presence.id } }, signal }))),
    acceptOffer: (presence: Credentials, offerHandle: string) => protectedRequest(presence, () =>
      result(client.POST('/v1/presences/{presenceId}/offers/{offerHandle}/accept', { headers: auth(presence), params: { path: { presenceId: presence.id, offerHandle } } }))),
    declineOffer: (presence: Credentials, offerHandle: string) => protectedRequest(presence, () =>
      result(client.POST('/v1/presences/{presenceId}/offers/{offerHandle}/decline', { headers: auth(presence), params: { path: { presenceId: presence.id, offerHandle } } }))),
    deletePresence: (presence: Credentials) => protectedRequest(presence, async () => {
      let response: Response
      try { ({ response } = await client.DELETE('/v1/presences/{presenceId}', { headers: auth(presence), params: { path: { presenceId: presence.id } } })) }
      catch { throw new ApiError(0) }
      if (!response.ok) throw new ApiError(response.status)
    }),
  }
}

export const locationClient = createLocationClient()
