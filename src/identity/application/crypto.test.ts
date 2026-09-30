/// <reference types="node" />
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { base64url, decodeBase64url, exportPublicKey, fingerprintSpki, generateNodeKeys, registrationStatement } from './crypto'

beforeEach(() => vi.stubGlobal('crypto', webcrypto))
afterEach(() => vi.unstubAllGlobals())
it('generates non-exportable Ed25519 private keys and exportable canonical SPKI public keys', async () => {
  const pair = await generateNodeKeys()
  expect(pair.privateKey.algorithm.name).toBe('Ed25519')
  expect(pair.privateKey.extractable).toBe(false)
  expect(pair.privateKey.usages).toEqual(['sign'])
  expect(pair.publicKey.extractable).toBe(true)
  expect(pair.publicKey.usages).toEqual(['verify'])
  await expect(crypto.subtle.exportKey('pkcs8', pair.privateKey)).rejects.toThrow()
  const first = await exportPublicKey(pair.publicKey), second = await exportPublicKey(pair.publicKey)
  expect(first).toEqual(second)
  expect(decodeBase64url(first.publicKeySpki)).toHaveLength(44)
  expect(first.localFingerprint).toMatch(/^sha256:[A-Za-z0-9_-]{43}$/)
})
it('uses unpadded Base64url and rejects noncanonical encodings', () => {
  expect(base64url(new Uint8Array([251, 255]))).toBe('-_8')
  expect(Array.from(decodeBase64url('-_8'))).toEqual([251, 255])
  expect(() => decodeBase64url('-_8=')).toThrow()
  expect(() => decodeBase64url('-_9')).toThrow()
})
it('matches backend NodeCryptographyTests SPKI/fingerprint and statement golden vectors', async () => {
  expect(await fingerprintSpki(decodeBase64url('MCowBQYDK2VwAyEA11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo')))
    .toBe('sha256:BuP9j9opu2CrWVV95h7bCuzbIxE0vjDnW0Vfjht5L6k')
  expect(new TextDecoder().decode(registrationStatement('550E8400-E29B-41D4-A716-446655440000', 'abc123', 'sha256:def456')))
    .toBe('KAVOZI-NODE-REGISTRATION-V1\nchallenge-id:550e8400-e29b-41d4-a716-446655440000\nchallenge:abc123\npublic-key-fingerprint:sha256:def456\naudience:kavozi-api\n')
})
it('signs exact statement bytes, verifies with exported public key, and rejects a changed statement', async () => {
  const pair = await generateNodeKeys(), exported = await exportPublicKey(pair.publicKey)
  const statement = registrationStatement(crypto.randomUUID(), base64url(crypto.getRandomValues(new Uint8Array(32))), exported.localFingerprint)
  const signature = await crypto.subtle.sign('Ed25519', pair.privateKey, statement)
  const imported = await crypto.subtle.importKey('spki', decodeBase64url(exported.publicKeySpki), 'Ed25519', true, ['verify'])
  expect(await crypto.subtle.verify('Ed25519', imported, signature, statement)).toBe(true)
  statement[0] ^= 1
  expect(await crypto.subtle.verify('Ed25519', imported, signature, statement)).toBe(false)
})
it('does not fall back when Ed25519 is unavailable', async () => {
  const generate = vi.spyOn(crypto.subtle, 'generateKey').mockRejectedValue(new DOMException('unsupported', 'NotSupportedError'))
  await expect(generateNodeKeys()).rejects.toMatchObject({ code: 'UNSUPPORTED' })
  expect(generate).toHaveBeenCalledTimes(1)
})
