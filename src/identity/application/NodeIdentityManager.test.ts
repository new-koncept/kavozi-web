/// <reference types="node" />
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LocationDatabase } from '../../location/persistence/db'
import { ApiError, type Schema } from '../../api/locationClient'
import { NodeIdentityManager } from './NodeIdentityManager'
import { base64url, decodeBase64url, fingerprintSpki, registrationStatement } from './crypto'

let database: LocationDatabase
let api: ReturnType<typeof backend>
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); database = new LocationDatabase(`identity-test-${crypto.randomUUID()}`); api = backend() })
afterEach(async () => { await database.delete(); vi.unstubAllGlobals() })
function backend() {
  return {
    issueNodeRegistrationChallenge: vi.fn(async (body: Schema['ChallengeRequest']): Promise<Schema['ChallengeResponse']> => ({
      challengeId: crypto.randomUUID(), challenge: base64url(crypto.getRandomValues(new Uint8Array(32))),
      fingerprint: await fingerprintSpki(decodeBase64url(body.publicKey)), expiresAt: new Date(Date.now() + 120000).toISOString(),
    })),
    registerNode: vi.fn(async (body: Schema['RegistrationRequest']): Promise<Schema['NodeResponse']> => {
      const fingerprint = await fingerprintSpki(decodeBase64url(body.publicKey))
      const key = await crypto.subtle.importKey('spki', decodeBase64url(body.publicKey), 'Ed25519', true, ['verify'])
      expect(await crypto.subtle.verify('Ed25519', key, decodeBase64url(body.signature), registrationStatement(body.challengeId, body.challenge, fingerprint))).toBe(true)
      return { nodeId: crypto.randomUUID(), fingerprint, keyAlgorithm: 'Ed25519', status: 'ACTIVE', createdAt: new Date().toISOString() }
    }),
  }
}
const manager = () => new NodeIdentityManager(database, api)
it('persists before networking, registers, and reuses structured-cloned keys and metadata after reload', async () => {
  api.issueNodeRegistrationChallenge.mockImplementationOnce(async ({ publicKey }) => {
    const stored = await database.nodeIdentities.get('active')
    expect(stored?.publicKeySpki).toBe(publicKey)
    expect(stored?.privateKey.extractable).toBe(false)
    return backend().issueNodeRegistrationChallenge({ publicKey })
  })
  const first = manager(), ready = await first.initialize()
  expect(ready.status).toBe('READY')
  const fingerprint = (await database.nodeIdentities.get('active'))!.localFingerprint
  database.close(); await database.open()
  const second = manager()
  expect(await second.initialize()).toEqual(ready)
  expect(api.registerNode).toHaveBeenCalledTimes(1)
  expect((await database.nodeIdentities.get('active'))?.localFingerprint).toBe(fingerprint)
  expect(JSON.stringify(ready)).not.toMatch(/privateKey|publicKeySpki|signature|challenge/)
  const stored = (await database.nodeIdentities.get('active'))!
  expect(await crypto.subtle.verify('Ed25519', stored.publicKey, await second.sign(new Uint8Array([1, 2])), new Uint8Array([1, 2]))).toBe(true)
})
it('resumes interrupted registration and transient failures with the same key, without leaking raw errors', async () => {
  api.registerNode.mockRejectedValueOnce(new Error('DO NOT EXPOSE privateKey signature challenge'))
  const result = await manager().initialize()
  expect(result.status).toBe('ERROR')
  expect(JSON.stringify(result)).not.toContain('DO NOT EXPOSE')
  const stored = (await database.nodeIdentities.get('active'))!
  expect(stored.status).toBe('REGISTERING')
  const ready = await manager().initialize()
  expect(ready).toMatchObject({ status: 'READY', fingerprint: stored.localFingerprint })
  expect(api.issueNodeRegistrationChallenge.mock.calls.every(([body]) => body.publicKey === stored.publicKeySpki)).toBe(true)
})
it('replaces an expired challenge once with the same persisted key', async () => {
  api.issueNodeRegistrationChallenge.mockImplementationOnce(async (body) => ({ ...await backend().issueNodeRegistrationChallenge(body), expiresAt: '2000-01-01T00:00:00Z' }))
  expect((await manager().initialize()).status).toBe('READY')
  expect(api.issueNodeRegistrationChallenge).toHaveBeenCalledTimes(2)
  expect(api.issueNodeRegistrationChallenge.mock.calls[0][0].publicKey).toBe(api.issueNodeRegistrationChallenge.mock.calls[1][0].publicKey)
  expect(api.registerNode).toHaveBeenCalledTimes(1)
})
it.each(['challenge', 'registration'] as const)('rejects a %s fingerprint mismatch without registering local metadata', async (stage) => {
  if (stage === 'challenge') api.issueNodeRegistrationChallenge.mockImplementationOnce(async (body) => ({ ...await backend().issueNodeRegistrationChallenge(body), fingerprint: 'wrong' }))
  else api.registerNode.mockImplementationOnce(async (body) => ({ ...await backend().registerNode(body), fingerprint: 'wrong' }))
  expect((await manager().initialize()).status).toBe('ERROR')
  expect((await database.nodeIdentities.get('active'))?.status).not.toBe('REGISTERED')
  expect((await database.nodeIdentities.get('active'))?.nodeId).toBeUndefined()
  if (stage === 'challenge') expect(api.registerNode).not.toHaveBeenCalled()
})
it('treats duplicate-key conflict as recovery-required without replacing the key', async () => {
  api.registerNode.mockRejectedValue(new ApiError(409))
  expect((await manager().initialize()).status).toBe('REGISTRATION_RECOVERY_REQUIRED')
  const fingerprint = (await database.nodeIdentities.get('active'))!.localFingerprint
  expect((await manager().initialize()).status).toBe('REGISTRATION_RECOVERY_REQUIRED')
  expect((await database.nodeIdentities.get('active'))!.localFingerprint).toBe(fingerprint)
})
it.each(['fingerprint', 'keyPair', 'schemaVersion', 'nodeId'] as const)('preserves corrupt %s state and reports an explicit error', async (field) => {
  await manager().initialize()
  const stored = (await database.nodeIdentities.get('active'))!
  if (field === 'fingerprint') await database.nodeIdentities.update('active', { localFingerprint: 'corrupt' })
  if (field === 'keyPair') {
    const other = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify'])
    await database.nodeIdentities.update('active', { publicKey: other.publicKey })
  }
  if (field === 'schemaVersion') await database.nodeIdentities.toCollection().modify((record) => { Object.assign(record, { schemaVersion: 99 }) })
  if (field === 'nodeId') await database.nodeIdentities.update('active', { nodeId: undefined })
  expect((await manager().initialize()).status).toBe('ERROR')
  expect(await database.nodeIdentities.count()).toBe(1)
  expect((await database.nodeIdentities.get('active'))?.localIdentityId).toBe(stored.localIdentityId)
  expect(api.registerNode).toHaveBeenCalledTimes(1)
})
it('coalesces StrictMode/concurrent managers into a single active pair and registration', async () => {
  const first = manager(), second = manager()
  const results = await Promise.all([first.initialize(), first.initialize(), second.initialize()])
  expect(results[0]).toEqual(results[1]); expect(results[1]).toEqual(results[2])
  expect(api.registerNode).toHaveBeenCalledTimes(1)
  expect(await database.nodeIdentities.count()).toBe(1)
})
it('queues deliberate regeneration behind initialization instead of losing the command', async () => {
  const service = manager()
  const initial = service.initialize()
  const replacement = service.regenerate(true)
  const first = await initial, second = await replacement
  expect(first.status).toBe('READY'); expect(second.status).toBe('READY')
  if (first.status === 'READY' && second.status === 'READY') expect(second.fingerprint).not.toBe(first.fingerprint)
  expect(api.registerNode).toHaveBeenCalledTimes(2)
  expect(await database.nodeIdentities.count()).toBe(1)
})
it('promotes a registered replacement atomically, removes the old key, and notifies listeners', async () => {
  const service = manager(); await service.initialize()
  const old = (await database.nodeIdentities.get('active'))!
  const changed = vi.fn(); service.onIdentityChanged(changed)
  api.registerNode.mockImplementationOnce(async (body) => {
    expect((await database.nodeIdentities.get('active'))?.localIdentityId).toBe(old.localIdentityId)
    expect((await database.nodeIdentities.get('candidate'))?.status).toBe('REGISTERING')
    return backend().registerNode(body)
  })
  const result = await service.regenerate()
  expect(result.status).toBe('READY')
  const current = (await database.nodeIdentities.get('active'))!
  expect(current.localFingerprint).not.toBe(old.localFingerprint)
  expect(changed).toHaveBeenCalledWith(current.localFingerprint)
  expect(await database.nodeIdentities.count()).toBe(1)
  expect(await database.nodeIdentities.get('candidate')).toBeUndefined()
  const data = new Uint8Array([3, 4]), signature = await service.sign(data)
  expect(await crypto.subtle.verify('Ed25519', current.publicKey, signature, data)).toBe(true)
  expect(await crypto.subtle.verify('Ed25519', old.publicKey, signature, data)).toBe(false)
})
it('retains original signing capability after failed regeneration and retries the same candidate after reload', async () => {
  const service = manager(); await service.initialize()
  const original = (await database.nodeIdentities.get('active'))!
  api.registerNode.mockRejectedValueOnce(new ApiError(0))
  expect(await service.regenerate()).toMatchObject({ status: 'READY', fingerprint: original.localFingerprint, replacement: { status: 'ERROR' } })
  const candidate = (await database.nodeIdentities.get('candidate'))!
  expect((await database.nodeIdentities.get('active'))?.localIdentityId).toBe(original.localIdentityId)
  const reloaded = manager()
  expect(await reloaded.initialize()).toMatchObject({ status: 'READY', replacement: { status: 'ERROR' } })
  const data = new Uint8Array([9])
  expect(await crypto.subtle.verify('Ed25519', original.publicKey, await reloaded.sign(data), data)).toBe(true)
  expect(await reloaded.regenerate()).toMatchObject({ status: 'READY', fingerprint: candidate.localFingerprint })
  expect(await database.nodeIdentities.count()).toBe(1)
})
it('recovers a crash after candidate registration but before promotion', async () => {
  const service = manager(); await service.initialize()
  const original = (await database.nodeIdentities.get('active'))!
  await service.regenerate()
  const replacement = (await database.nodeIdentities.get('active'))!
  await database.nodeIdentities.put(original)
  await database.nodeIdentities.put({ ...replacement, slot: 'candidate', replacesIdentityId: original.localIdentityId })
  const count = api.registerNode.mock.calls.length
  expect(await manager().initialize()).toMatchObject({ status: 'READY', fingerprint: replacement.localFingerprint })
  expect(api.registerNode).toHaveBeenCalledTimes(count)
  expect(await database.nodeIdentities.count()).toBe(1)
})
