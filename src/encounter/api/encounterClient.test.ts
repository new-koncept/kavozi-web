/// <reference types="node" />
import { webcrypto } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { LocationDatabase } from '../../location/persistence/db'
import { NodeIdentityManager } from '../../identity/application/NodeIdentityManager'
import { base64url, decodeBase64url, fingerprintSpki } from '../../identity/application/crypto'
import { createEncounterClient, EncounterError, type EncounterClient } from './encounterClient'
import { encounterMetadata, fixtureRoom, roomId } from '../testFixtures'
import { encodeMessage } from '../application/textProtocol'
import { signatureBase } from './httpSignature'
import type { Schema } from '../../api/locationClient'

const base = 'http://localhost:8080', server = setupServer()
let database: LocationDatabase, manager: NodeIdentityManager, api: EncounterClient, fingerprint: string
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto)
  database = new LocationDatabase(`encounter-client-${crypto.randomUUID()}`)
  manager = new NodeIdentityManager(database, {
    issueNodeRegistrationChallenge: async ({ publicKey }) => ({ challengeId: crypto.randomUUID(), challenge: base64url(crypto.getRandomValues(new Uint8Array(32))), fingerprint: await fingerprintSpki(decodeBase64url(publicKey)), expiresAt: new Date(Date.now() + 120000).toISOString() }),
    registerNode: async ({ publicKey }) => ({ nodeId: crypto.randomUUID(), fingerprint: await fingerprintSpki(decodeBase64url(publicKey)), keyAlgorithm: 'Ed25519', status: 'ACTIVE', createdAt: new Date().toISOString() }),
  })
  const ready = await manager.initialize(); if (ready.status !== 'READY') throw new Error('Fixture identity failed')
  fingerprint = ready.fingerprint
  api = createEncounterClient(fingerprint, manager)
  server.use(http.get(`${base}/.well-known/kavozi-encounter`, () => HttpResponse.json(encounterMetadata)))
})
afterEach(async () => { api.dispose(); await database.delete(); server.resetHandlers(); vi.unstubAllGlobals() })
it('uses generated body serialization once and verifies an authentic signed request at the transport boundary', async () => {
  const request = encodeMessage('Ľúbim češtinu 🌿', 2, encounterMetadata)
  server.use(http.post(`${base}/v1/encounters/${roomId}/messages`, async ({ request: received }) => {
    expect(received.headers.has('Authorization')).toBe(false)
    expect(await received.text() === request.serialized).toBe(true)
    const key = (await database.nodeIdentities.get('active'))!.publicKey
    const parameters = received.headers.get('Signature-Input')!.slice(7)
    const bytes = signatureBase('BODY', { '@method': 'POST', '@target-uri': received.url, 'content-type': received.headers.get('Content-Type')!, 'content-digest': received.headers.get('Content-Digest')! }, parameters)
    const signature = Uint8Array.from(atob(received.headers.get('Signature')!.slice(8, -1)), (c) => c.charCodeAt(0))
    expect(await crypto.subtle.verify('Ed25519', key, signature, bytes)).toBe(true)
    return HttpResponse.json({ type: 'MESSAGE', sequence: 7, message: { ...request.body, senderParticipantId: fixtureRoom.self.participantId } }, { status: 201 })
  }))
  expect((await api.send(roomId, request.body, request.serialized)).sequence).toBe(7)
})
it('recognizes backend waiting and membership errors without exposing raw errors or retry material', async () => {
  server.use(http.post(`${base}/v1/presences/:presenceId/offers/:offerHandle/encounter`, ({ request }) => {
    expect(request.headers.get('Authorization') === 'KavoziPresence test-only').toBe(true)
    expect(request.headers.get('Signature-Input')).toContain('"authorization"')
    expect(request.headers.has('Content-Type')).toBe(false)
    return HttpResponse.json({ code: 'MATCH_NOT_READY', message: 'NEVER EXPOSE secrets' }, { status: 409, headers: { 'Retry-After': '12' } })
  }))
  await expect(api.claim({ id: roomId, token: 'test-only' }, roomId)).rejects.toMatchObject({ code: 'MATCH_NOT_READY', retryAfter: 12000 })
  server.use(http.post(`${base}/v1/encounters/${roomId}/messages`, () => HttpResponse.json({ code: 'MEMBERSHIP_CHANGED', message: 'NEVER EXPOSE bodies' }, { status: 409 })))
  const request = encodeMessage('test', 2, encounterMetadata)
  await expect(api.send(roomId, request.body, request.serialized)).rejects.toThrow('The participant group changed.')
})
it('cancels in-flight reads on identity replacement and cannot send an old pending message with the new key', async () => {
  let release!: () => void
  const wait = new Promise<void>((resolve) => { release = resolve })
  let entered = false
  server.use(http.get(`${base}/v1/encounters/${roomId}`, async () => { entered = true; await wait; return HttpResponse.json(fixtureRoom) }))
  const reading = api.get(roomId).catch((error: unknown) => error)
  await vi.waitFor(() => expect(entered).toBe(true))
  await manager.regenerate()
  release()
  const error = await reading
  expect(error).toMatchObject({ name: 'AbortError' })
  const request = encodeMessage('old draft', 2, encounterMetadata)
  await expect(api.send(roomId, request.body, request.serialized)).rejects.toMatchObject({ name: 'AbortError' })
  await expect(manager.sign(new Uint8Array([1]), fingerprint)).rejects.toThrow('Node identity changed')
})
it('does not add Presence credentials to reads and supports 204 leave', async () => {
  server.use(http.get(`${base}/v1/encounters`, ({ request }) => {
    expect(request.headers.has('Authorization')).toBe(false)
    expect(new URL(request.url).searchParams.get('cursor')).toBe('a+b/c')
    return HttpResponse.json({ encounters: [fixtureRoom] } satisfies Schema['EncounterListResponse'])
  }), http.delete(`${base}/v1/encounters/${roomId}/participants/me`, () => new HttpResponse(null, { status: 204 })))
  expect((await api.list('a+b/c')).encounters).toHaveLength(1)
  await expect(api.leave(roomId)).resolves.toBeUndefined()
  expect(new EncounterError(401).message).not.toContain(fingerprint)
})
