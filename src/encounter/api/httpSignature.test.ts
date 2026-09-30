/// <reference types="node" />
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { decodeBase64url, exportPublicKey, generateNodeKeys } from '../../identity/application/crypto'
import { signatureBase, signatureParameters, signRequest, standardBase64 } from './httpSignature'

beforeEach(() => vi.stubGlobal('crypto', webcrypto))
afterEach(() => vi.unstubAllGlobals())
it('matches the backend EncounterSignatureTests signature base and verifies its golden signature', async () => {
  const parameters = signatureParameters('BODY', 'sha256:EnGnOfTTcNevFilMT4TYhIMhnhBPgFt1X9D1v8e5CjE', 1790192105, 1790192405, '-iBmbJvbQG1A9PsDf-S_NtTHMShzh2RRPIKbt_Ub3Nc')
  const target = 'https://api.kavozi.example/v1/encounters/6546238b-b31a-4e3e-b361-39d79b100a21/messages'
  const digest = 'sha-256=:2rlLBVkMhUIW6PV1REauezs+M0dtkFQ5fAOg1KXiuIk=:'
  const base = signatureBase('BODY', { '@method': 'POST', '@target-uri': target, 'content-type': 'application/json', 'content-digest': digest }, parameters)
  expect(new TextDecoder().decode(base)).toBe(`"@method": POST\n"@target-uri": ${target}\n"content-type": application/json\n"content-digest": ${digest}\n"@signature-params": ${parameters}`)
  const key = await crypto.subtle.importKey('spki', decodeBase64url('MCowBQYDK2VwAyEAlnyRx3DcODK5sLervTgm9enP5_f8ArBdk2PPu3xUn0Y'), 'Ed25519', true, ['verify'])
  const signature = Uint8Array.from(atob('+OBk4TFretI+daTNq5iqBf0nujVx/AHNdMm6MtwNps27KGeRZdg0XxVwFnx/Gf0nT5bE1AulXkFwA2QN7hSMBA=='), (c) => c.charCodeAt(0))
  expect(await crypto.subtle.verify('Ed25519', key, signature, base)).toBe(true)
})
it('signs and sends identical UTF-8 bytes with standard Base64 digest/signature and fresh metadata on each attempt', async () => {
  const keys = await generateNodeKeys(), { localFingerprint } = await exportPublicKey(keys.publicKey)
  const sign = async (bytes: Uint8Array) => new Uint8Array(await crypto.subtle.sign('Ed25519', keys.privateKey, new Uint8Array(bytes)))
  const body = '{"text":"Čau 🌿", "spacing": true}\n'
  const make = () => signRequest(new Request('https://api.example/v1/encounters/a/messages?cursor=a%2Bb&limit=50', { method: 'POST', body }), localFingerprint, 300, sign)
  const first = await make(), second = await make()
  expect(await first.clone().text()).toBe(body); expect(await second.clone().text()).toBe(body)
  expect(first.headers.get('Signature-Input')).not.toBe(second.headers.get('Signature-Input'))
  expect(first.headers.get('Content-Digest')).toBe(`sha-256=:${standardBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))))}:`)
  const parameters = first.headers.get('Signature-Input')!.slice('kavozi='.length)
  const base = signatureBase('BODY', { '@method': 'POST', '@target-uri': first.url, 'content-type': 'application/json', 'content-digest': first.headers.get('Content-Digest')! }, parameters)
  const signature = Uint8Array.from(atob(first.headers.get('Signature')!.slice(8, -1)), (c) => c.charCodeAt(0))
  expect(await crypto.subtle.verify('Ed25519', keys.publicKey, signature, base)).toBe(true)
  const wrong = signatureBase('BODY', { '@method': 'POST', '@target-uri': 'http://internal:8080/rewritten', 'content-type': 'application/json', 'content-digest': first.headers.get('Content-Digest')! }, parameters)
  expect(await crypto.subtle.verify('Ed25519', keys.publicKey, signature, wrong)).toBe(false)
  expect(first.redirect).toBe('error')
})
it('covers Presence authorization only for bodyless admission, never on normal Encounter operations', async () => {
  const sign = vi.fn(async (data: Uint8Array) => { void data; return new Uint8Array(64) })
  const admission = await signRequest(new Request('http://localhost:8080/v1/presences/p/offers/o/encounter', { method: 'POST', headers: { Authorization: 'KavoziPresence test-only' } }), 'sha256:test', 300, sign)
  expect(admission.headers.has('Content-Type')).toBe(false)
  expect(new TextDecoder().decode(sign.mock.calls[0][0])).toContain('"authorization": KavoziPresence test-only')
  const read = await signRequest(new Request('http://localhost:8080/v1/encounters?limit=50'), 'sha256:test', 300, sign)
  expect(read.headers.has('Authorization')).toBe(false)
  expect(read.headers.get('Signature-Input')).toContain('("@method" "@target-uri")')
})
