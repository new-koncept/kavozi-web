/** No private-key serialization, logging, or alternate algorithms. */
export class IdentityFailure extends Error {
  readonly code: 'UNSUPPORTED' | 'CORRUPT' | 'PROTOCOL' | 'RECOVERY' | 'TRANSIENT'
  constructor(code: IdentityFailure['code'], message: string) { super(message); this.name = 'IdentityFailure'; this.code = code }
}
export function base64url(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export function decodeBase64url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new IdentityFailure('PROTOCOL', 'Registration returned an invalid encoding.')
  const bytes = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (character) => character.charCodeAt(0))
  if (base64url(bytes) !== value) throw new IdentityFailure('PROTOCOL', 'Registration returned a noncanonical encoding.')
  return bytes
}
export function registrationStatement(challengeId: string, challenge: string, fingerprint: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`KAVOZI-NODE-REGISTRATION-V1\nchallenge-id:${challengeId.toLowerCase()}\nchallenge:${challenge}\npublic-key-fingerprint:${fingerprint}\naudience:kavozi-api\n`)
}
export function requireCrypto() {
  if (!globalThis.crypto?.subtle) throw new IdentityFailure('UNSUPPORTED', 'This browser needs Web Crypto in a secure context to establish a node identity.')
  return globalThis.crypto.subtle
}
export const unsupportedCrypto = (error: unknown) => typeof error === 'object' && error !== null && 'name' in error && error.name === 'NotSupportedError'
export async function generateNodeKeys(): Promise<CryptoKeyPair> {
  try {
    // Ed25519 generateKey(false) makes the private key non-exportable; the public key remains exportable.
    return await requireCrypto().generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
  } catch (error) {
    if (error instanceof IdentityFailure) throw error
    if (unsupportedCrypto(error)) throw new IdentityFailure('UNSUPPORTED', 'This browser does not support Ed25519. Use a browser with native Ed25519 support.')
    throw new IdentityFailure('TRANSIENT', 'Could not generate a node key. Retry without clearing browser storage.')
  }
}
export async function fingerprintSpki(spki: Uint8Array<ArrayBuffer>) {
  return `sha256:${base64url(new Uint8Array(await requireCrypto().digest('SHA-256', spki)))}`
}
export async function exportPublicKey(key: CryptoKey) {
  const bytes = new Uint8Array(await requireCrypto().exportKey('spki', key))
  return { publicKeySpki: base64url(bytes), localFingerprint: await fingerprintSpki(bytes) }
}
export const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
export const timestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))
