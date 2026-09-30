import { base64url } from '../../identity/application/crypto'

// Backend source: EncounterRequestAuthenticator + EncounterSignatureTests.
export const SIGNATURE_PROFILE = 'kavozi-node-http-v1'
export type SignatureProfile = 'BODY' | 'BODYLESS' | 'ADMISSION'
const covered = {
  BODY: ['@method', '@target-uri', 'content-type', 'content-digest'],
  BODYLESS: ['@method', '@target-uri'],
  ADMISSION: ['@method', '@target-uri', 'authorization'],
} as const
export const standardBase64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))

export function signatureParameters(profile: SignatureProfile, fingerprint: string, created: number, expires: number, nonce: string) {
  return `(${covered[profile].map((part) => `"${part}"`).join(' ')});created=${created};keyid="${fingerprint}";alg="ed25519";expires=${expires};nonce="${nonce}";tag="${SIGNATURE_PROFILE}"`
}
export function signatureBase(profile: SignatureProfile, components: Record<string, string>, parameters: string) {
  // Unlike registration, HTTP signature bases have no trailing newline.
  return new TextEncoder().encode([...covered[profile].map((part) => `"${part}": ${components[part]}`), `"@signature-params": ${parameters}`].join('\n'))
}
export async function signRequest(request: Request, fingerprint: string, maxAgeSeconds: number,
  sign: (data: Uint8Array) => Promise<Uint8Array>): Promise<Request> {
  const headers = new Headers(request.headers)
  const profile: SignatureProfile = headers.has('Authorization') ? 'ADMISSION' : request.body ? 'BODY' : 'BODYLESS'
  const components: Record<string, string> = { '@method': request.method.toUpperCase(), '@target-uri': request.url }
  if (profile === 'BODY') {
    const bytes = await request.clone().arrayBuffer()
    headers.set('Content-Type', 'application/json')
    headers.set('Content-Digest', `sha-256=:${standardBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))}:`)
    components['content-type'] = headers.get('Content-Type')!
    components['content-digest'] = headers.get('Content-Digest')!
  } else {
    headers.delete('Content-Type')
    if (profile === 'ADMISSION') components.authorization = headers.get('Authorization')!
  }
  const created = Math.floor(Date.now() / 1000)
  const parameters = signatureParameters(profile, fingerprint, created, created + Math.min(60, maxAgeSeconds), base64url(crypto.getRandomValues(new Uint8Array(32))))
  headers.set('Signature-Input', `kavozi=${parameters}`)
  headers.set('Signature', `kavozi=:${standardBase64(await sign(signatureBase(profile, components, parameters)))}:`)
  return new Request(request, { headers, redirect: 'error' })
}
