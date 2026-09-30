/// <reference types="node" />
import { webcrypto } from 'node:crypto'
import Dexie from 'dexie'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@mui/material'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { LocationDatabase } from '../location/persistence/db'
import { locationClient, type Schema } from '../api/locationClient'
import { theme } from '../app/theme'
import { NodeIdentityPanel } from './components/NodeIdentityPanel'
import { NodeIdentityManager } from './application/NodeIdentityManager'
import { base64url, decodeBase64url, fingerprintSpki, registrationStatement } from './application/crypto'
import { identityRepository } from './persistence/identityRepository'

const base = 'http://localhost:8080'
const server = setupServer()
let database: LocationDatabase
let requests: string[]
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  database = new LocationDatabase(`identity-integration-${crypto.randomUUID()}`)
  requests = []
  const challenges = new Map<string, Schema['ChallengeResponse']>()
  server.use(
    http.post(`${base}/v1/node-registration-challenges`, async ({ request }) => {
      expect(request.headers.has('Authorization')).toBe(false)
      const body = await request.json() as Schema['ChallengeRequest']
      expect(Object.keys(body)).toEqual(['publicKey'])
      const stored = await database.nodeIdentities.toArray()
      expect(stored.some((identity) => identity.publicKeySpki === body.publicKey)).toBe(true)
      requests.push('challenge')
      const result = { challengeId: crypto.randomUUID(), challenge: base64url(crypto.getRandomValues(new Uint8Array(32))),
        fingerprint: await fingerprintSpki(decodeBase64url(body.publicKey)), expiresAt: new Date(Date.now() + 120000).toISOString() }
      challenges.set(result.challengeId, result)
      return HttpResponse.json(result, { status: 201 })
    }),
    http.post(`${base}/v1/nodes`, async ({ request }) => {
      expect(request.headers.has('Authorization')).toBe(false)
      const body = await request.json() as Schema['RegistrationRequest']
      expect(Object.keys(body).sort()).toEqual(['challenge', 'challengeId', 'publicKey', 'signature'])
      const challenge = challenges.get(body.challengeId)!
      const key = await crypto.subtle.importKey('spki', decodeBase64url(body.publicKey), 'Ed25519', true, ['verify'])
      expect(await crypto.subtle.verify('Ed25519', key, decodeBase64url(body.signature), registrationStatement(body.challengeId, body.challenge, challenge.fingerprint!))).toBe(true)
      challenges.delete(body.challengeId)
      requests.push('register')
      return HttpResponse.json({ nodeId: crypto.randomUUID(), fingerprint: challenge.fingerprint, keyAlgorithm: 'Ed25519', status: 'ACTIVE', createdAt: new Date().toISOString() } satisfies Schema['NodeResponse'], { status: 201 })
    }),
  )
})
afterEach(async () => { cleanup(); await database.delete(); server.resetHandlers(); vi.unstubAllGlobals() })
it('uses generated public requests and requires deliberate UI confirmation for replacement', async () => {
  const manager = new NodeIdentityManager(database, locationClient)
  render(<ThemeProvider theme={theme}><NodeIdentityPanel manager={manager} /></ThemeProvider>)
  await waitFor(() => expect(manager.getSnapshot().status).toBe('READY'))
  expect(requests).toEqual(['challenge', 'register'])
  const original = (await database.nodeIdentities.get('active'))!
  fireEvent.click(screen.getByText(/Node identity · Ready/))
  fireEvent.click(screen.getByRole('button', { name: 'Regenerate node identity…' }))
  expect(screen.getByRole('button', { name: 'Create new identity' })).toBeDisabled()
  expect((await database.nodeIdentities.get('active'))?.localFingerprint).toBe(original.localFingerprint)
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Create new identity' }))
  await waitFor(async () => expect((await database.nodeIdentities.get('active'))?.localFingerprint).not.toBe(original.localFingerprint))
  expect(requests).toEqual(['challenge', 'register', 'challenge', 'register'])
  expect(await database.nodeIdentities.count()).toBe(1)
  expect(document.body.textContent).not.toMatch(/privateKey|CryptoKey|signature:/)
})
it('publishes cross-manager identity changes through IndexedDB without exposing key objects', async () => {
  const one = new NodeIdentityManager(database, locationClient), two = new NodeIdentityManager(database, locationClient)
  const stop = two.subscribe(() => {})
  try {
    await one.initialize(); await two.initialize()
    const notified = vi.fn(); two.onIdentityChanged(notified)
    await one.regenerate()
    await waitFor(() => expect(two.getSnapshot()).toEqual(one.getSnapshot()))
    expect(notified).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(two.getSnapshot())).not.toMatch(/privateKey|publicKeySpki/)
  } finally { stop() }
})
it('displays unsupported state instead of trying another algorithm', async () => {
  vi.stubGlobal('crypto', { subtle: undefined })
  const manager = new NodeIdentityManager(database, locationClient)
  render(<NodeIdentityPanel manager={manager} />)
  await screen.findByText(/Node identity · Unsupported/)
  expect(requests).toEqual([])
  expect(await database.nodeIdentities.count()).toBe(0)
})
it('retains one singleton key even for racing atomic inserts without Web Locks', async () => {
  const manager = new NodeIdentityManager(database, locationClient)
  await manager.initialize()
  const seed = (await database.nodeIdentities.get('active'))!
  await database.nodeIdentities.clear()
  const alternate = { ...seed, localIdentityId: crypto.randomUUID() }
  const otherConnection = new LocationDatabase(database.name)
  try {
    const [first, second] = await Promise.all([identityRepository(database).installIfAbsent(seed), identityRepository(otherConnection).installIfAbsent(alternate)])
    expect(first.localIdentityId).toBe(second.localIdentityId)
    expect(await database.nodeIdentities.count()).toBe(1)
  } finally { otherConnection.close() }
})
it('upgrades v3 without changing existing Presence or Intent state', async () => {
  const name = `identity-upgrade-${crypto.randomUUID()}`
  const old = new Dexie(name)
  old.version(3).stores({ presences: 'key', preferences: 'key', intents: 'id, templateKey, updatedAt' })
  await old.table('presences').put({ key: 'current', token: 'existing-test-token', id: 'existing', sequence: 9 })
  await old.table('intents').put({ id: 'local-intent', title: 'Preserve me', active: true })
  old.close()
  const upgraded = new LocationDatabase(name)
  try {
    await upgraded.open()
    expect(upgraded.verno).toBe(5)
    expect(await upgraded.nodeIdentities.count()).toBe(0)
    expect((await upgraded.presences.get('current'))?.sequence).toBe(9)
    expect((await upgraded.intents.get('local-intent'))?.title).toBe('Preserve me')
  } finally { await upgraded.delete() }
})
it('shows actionable recovery-required errors while keeping the same key', async () => {
  server.use(http.post(`${base}/v1/nodes`, () => HttpResponse.json({ message: 'Do not display challenge or signature' }, { status: 409 })))
  const manager = new NodeIdentityManager(database, locationClient)
  render(<NodeIdentityPanel manager={manager} />)
  await screen.findByText(/Node identity · Registration recovery required/)
  const id = (await database.nodeIdentities.get('active'))!.localIdentityId
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry node registration' })) })
  await waitFor(() => expect(requests).toHaveLength(2))
  await waitFor(() => expect(manager.getSnapshot().status).toBe('REGISTRATION_RECOVERY_REQUIRED'))
  expect((await database.nodeIdentities.get('active'))?.localIdentityId).toBe(id)
  expect(document.body.textContent).not.toContain('Do not display challenge or signature')
})
