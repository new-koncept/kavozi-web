import type { Schema } from '../../api/locationClient'
import { base64url, decodeBase64url } from '../../identity/application/crypto'
import type { EncounterMetadata } from '../api/encounterClient'

export const TEXT_PROTOCOL = 'kavozi.text.v1'
export const TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8'
export const utf8Length = (text: string) => new TextEncoder().encode(text).byteLength
export function encodeMessage(text: string, membershipVersion: number, limits: EncounterMetadata) {
  const bytes = new TextEncoder().encode(text)
  if (!text.trim() || bytes.length > limits.maxMessagePayloadBytes) throw new Error('Enter a message within the advertised byte limit.')
  const body: Schema['SendEncounterMessageRequest'] = { messageId: crypto.randomUUID(), membershipVersion,
    protocol: TEXT_PROTOCOL, contentType: TEXT_CONTENT_TYPE, payload: base64url(bytes) }
  // The OpenAPI also constrains the encoded payload, independently of runtime metadata.
  if (body.payload.length > 21846) throw new Error('This message exceeds the transport limit.')
  const serialized = JSON.stringify(body)
  if (utf8Length(serialized) > limits.maxRequestBytes) throw new Error('This message exceeds the request size limit.')
  return { body, serialized }
}
export function decodeMessage(message: Schema['MessageResponse'] | undefined, maxBytes: number): string | null {
  if (!message || message.protocol !== TEXT_PROTOCOL || message.contentType !== TEXT_CONTENT_TYPE || !message.payload
    || message.payload.length > Math.ceil(maxBytes * 4 / 3)) return null
  try {
    const bytes = decodeBase64url(message.payload)
    if (!bytes.length || bytes.length > maxBytes) return null
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch { return null }
}
