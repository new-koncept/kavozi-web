import createClient from 'openapi-fetch'
import type { paths } from '../../api/generated/schema'
import { API_BASE_URL, presenceAuthorization, type Schema } from '../../api/locationClient'
import type { LocalPresence } from '../../location/model/local'
import { nodeIdentityManager, type NodeIdentityManager } from '../../identity/application/NodeIdentityManager'
import { signRequest, SIGNATURE_PROFILE } from './httpSignature'

export class EncounterError extends Error {
  readonly status: number
  readonly code: string
  readonly retryAfter: number
  constructor(status: number, code = '', retryAfter = 0) {
    super(code === 'MEMBERSHIP_CHANGED' ? 'The participant group changed. Review it before sending again.'
      : code === 'MATCH_NOT_READY' ? 'Waiting for the encounter to become available.'
      : status === 401 ? 'Node authentication failed. Check the device clock and identity status, then retry.'
      : status === 403 || status === 404 ? 'This conversation is no longer accessible to this identity.'
      : status === 410 ? 'This conversation has ended.'
      : status === 409 ? 'The conversation changed. Refresh it before trying again.'
      : status === 413 ? 'This message exceeds the server’s size limit.'
      : status === 400 || status === 415 ? 'The server could not accept this message.'
      : code === 'INVALID_RESPONSE' ? 'The messaging server returned an incomplete response.'
      : 'Messaging is temporarily unavailable. Your unsent message is kept on this device.')
    this.name = 'EncounterError'; this.status = status; this.code = code; this.retryAfter = retryAfter
  }
  get transient() { return this.status === 0 || this.status === 429 || this.status >= 500 }
}
export const encounterErrorMessage = (error: unknown) => error instanceof EncounterError ? error.message : 'Messaging could not complete this action. Please retry.'
export function retryDelay(error: unknown, failures: number, minimum = 3000) {
  return Math.max(minimum, error instanceof EncounterError ? error.retryAfter : 0, Math.min(60000, minimum * 2 ** Math.min(failures, 5)))
}
export function retryAfterMilliseconds(value: string | null, now = Date.now()) {
  if (!value) return 0
  const seconds = Number(value)
  return Math.max(0, Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now) || 0
}
async function result<T>(promise: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  let value: { data?: T; error?: unknown; response: Response }
  try { value = await promise } catch (error) {
    if (error instanceof EncounterError || (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError')) throw error
    throw new EncounterError(0)
  }
  if (!value.response.ok) {
    // Error DTO is absent from generated OpenAPI; only inspect the verifier's known code field.
    let code = ''
    try {
      const body: unknown = value.error
      if (body && typeof body === 'object' && 'code' in body && typeof body.code === 'string'
        && ['MATCH_NOT_READY', 'MEMBERSHIP_CHANGED', 'CLOCK_SKEW', 'SIGNATURE_EXPIRED', 'SIGNATURE_REPLAY', 'MESSAGE_ID_REUSED', 'INVALID_CURSOR'].includes(body.code)) code = body.code
    } catch { /* Never expose an untrusted backend message/body. */ }
    throw new EncounterError(value.response.status, code, retryAfterMilliseconds(value.response.headers.get('Retry-After')))
  }
  if (value.data === undefined && value.response.status !== 204) throw new EncounterError(502, 'INVALID_RESPONSE')
  // openapi-fetch represents a successful 204 with undefined data.
  return value.data as T
}
export type EncounterMetadata = Schema['EncounterMetadataResponse'] & {
  signatureMaxAgeSeconds: number; maxMessagePayloadBytes: number; maxRequestBytes: number; pollAfterSeconds: number
}
export function validateMetadata(value: Schema['EncounterMetadataResponse']): EncounterMetadata {
  if (value.signatureProfile !== SIGNATURE_PROFILE || value.signatureAlgorithm !== 'ed25519'
    || !Number.isSafeInteger(value.signatureMaxAgeSeconds) || !value.signatureMaxAgeSeconds || value.signatureMaxAgeSeconds < 1
    || !Number.isSafeInteger(value.maxMessagePayloadBytes) || !value.maxMessagePayloadBytes || value.maxMessagePayloadBytes < 1
    || !Number.isSafeInteger(value.maxRequestBytes) || !value.maxRequestBytes || value.maxRequestBytes < 1
    || !Number.isSafeInteger(value.pollAfterSeconds) || !value.pollAfterSeconds || value.pollAfterSeconds < 1)
    throw new EncounterError(502, 'INVALID_RESPONSE')
  return { ...value, signatureMaxAgeSeconds: value.signatureMaxAgeSeconds, maxMessagePayloadBytes: value.maxMessagePayloadBytes,
    maxRequestBytes: value.maxRequestBytes, pollAfterSeconds: value.pollAfterSeconds }
}

/** Generated transport scoped to one node, with cancellation on identity replacement. */
export function createEncounterClient(fingerprint: string, manager: NodeIdentityManager = nodeIdentityManager, baseUrl = API_BASE_URL) {
  const lifetime = new AbortController()
  const assertIdentity = () => {
    const state = manager.getSnapshot()
    if (lifetime.signal.aborted || state.status !== 'READY' || state.fingerprint !== fingerprint) throw new DOMException('Identity changed', 'AbortError')
  }
  const unsubscribe = manager.subscribe(() => {
    const state = manager.getSnapshot()
    if (state.status !== 'READY' || state.fingerprint !== fingerprint) lifetime.abort()
  })
  const publicClient = createClient<paths>({ baseUrl, fetch: (request) => globalThis.fetch(request) })
  let metadataPromise: Promise<EncounterMetadata> | undefined
  const metadata = () => metadataPromise ??= result(publicClient.GET('/.well-known/kavozi-encounter', {
    signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(15000)]),
  })).then(validateMetadata).catch((error: unknown) => { metadataPromise = undefined; throw error })
  const client = createClient<paths>({ baseUrl, fetch: async (request) => {
    assertIdentity()
    const limits = await metadata()
    const signal = AbortSignal.any([request.signal, lifetime.signal, AbortSignal.timeout(15000)])
    const signed = await signRequest(new Request(request, { signal }), fingerprint, limits.signatureMaxAgeSeconds,
      (data) => manager.sign(data, fingerprint))
    assertIdentity(); signal.throwIfAborted()
    const response = await globalThis.fetch(signed)
    assertIdentity(); signal.throwIfAborted()
    return response
  } })
  return {
    dispose: () => { lifetime.abort(); unsubscribe() }, metadata,
    claim: (presence: Pick<LocalPresence, 'id' | 'token'>, offerHandle: string, signal?: AbortSignal) => result(client.POST('/v1/presences/{presenceId}/offers/{offerHandle}/encounter', {
      params: { path: { presenceId: presence.id, offerHandle } }, headers: { Authorization: presenceAuthorization(presence) }, signal,
    })),
    list: (cursor?: string, signal?: AbortSignal) => result(client.GET('/v1/encounters', { params: { query: { limit: 50, ...(cursor ? { cursor } : {}) } }, signal })),
    get: (encounterId: string, signal?: AbortSignal) => result(client.GET('/v1/encounters/{encounterId}', { params: { path: { encounterId } }, signal })),
    events: (encounterId: string, afterSequence: number, signal?: AbortSignal) => result(client.GET('/v1/encounters/{encounterId}/events', { params: { path: { encounterId }, query: { afterSequence, limit: 50 } }, signal })),
    send: (encounterId: string, body: Schema['SendEncounterMessageRequest'], serialized: string, signal?: AbortSignal) => {
      if (JSON.stringify(body) !== serialized) throw new EncounterError(400)
      return result(client.POST('/v1/encounters/{encounterId}/messages', {
        params: { path: { encounterId }, header: { 'Content-Digest': '' } }, body, bodySerializer: () => serialized, signal,
      }))
    },
    leave: async (encounterId: string, signal?: AbortSignal) => {
      await result(client.DELETE('/v1/encounters/{encounterId}/participants/me', { params: { path: { encounterId } }, signal }))
    },
  }
}
export type EncounterClient = ReturnType<typeof createEncounterClient>
