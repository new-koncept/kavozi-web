import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { fixturePresence, metadata } from '../src/test/fixtures'
import type { components } from '../src/api/generated/schema'

type Schema = components['schemas']

test('two tabs share browser keys, reload them, and observe confirmed replacement without changing Presence', async ({ context }) => {
  let registrations = 0, presenceCreates = 0
  const challenges = new Map<string, Schema['ChallengeResponse']>()
  await context.route('http://localhost:8080/**', async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS' }
    const json = (body: unknown, status = 200) => route.fulfill({ status, headers, json: body })
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path === '/v1/node-registration-challenges') {
      expect(request.headers().authorization).toBeUndefined()
      const body = request.postDataJSON() as Schema['ChallengeRequest']
      expect(Object.keys(body)).toEqual(['publicKey'])
      const fingerprint = `sha256:${createHash('sha256').update(Buffer.from(body.publicKey, 'base64url')).digest('base64url')}`
      const challenge = { challengeId: randomUUID(), challenge: randomBytes(32).toString('base64url'), fingerprint, expiresAt: new Date(Date.now() + 120000).toISOString() }
      challenges.set(challenge.challengeId, challenge)
      return json(challenge, 201)
    }
    if (path === '/v1/nodes') {
      expect(request.headers().authorization).toBeUndefined()
      const body = request.postDataJSON() as Schema['RegistrationRequest']
      expect(Object.keys(body).sort()).toEqual(['challenge', 'challengeId', 'publicKey', 'signature'])
      const challenge = challenges.get(body.challengeId)!
      const key = createPublicKey({ key: Buffer.from(body.publicKey, 'base64url'), type: 'spki', format: 'der' })
      const statement = `KAVOZI-NODE-REGISTRATION-V1\nchallenge-id:${body.challengeId}\nchallenge:${body.challenge}\npublic-key-fingerprint:${challenge.fingerprint}\naudience:kavozi-api\n`
      expect(verify(null, Buffer.from(statement), key, Buffer.from(body.signature, 'base64url'))).toBe(true)
      challenges.delete(body.challengeId); registrations++
      return json({ nodeId: randomUUID(), fingerprint: challenge.fingerprint, keyAlgorithm: 'Ed25519', status: 'ACTIVE', createdAt: new Date().toISOString() }, 201)
    }
    if (path === '/.well-known/kavozi-location') return json(metadata)
    if (path === '/v1/intent-templates') return json([])
    if (path === '/v1/presences') {
      expect(request.headers().authorization).toBeUndefined()
      expect(request.postData()).toBeNull()
      presenceCreates++
      return json(fixturePresence(1), 201)
    }
    if (path.startsWith('/v1/presences/')) {
      expect(request.headers().authorization === `KavoziPresence ${fixturePresence(1).presenceToken}`).toBe(true)
      if (path.endsWith('/inbox')) return json({ offers: [], pollAfterSeconds: 30 })
      return json({ status: 'RECORDED' })
    }
    return json({}, 404)
  })
  const one = await context.newPage(), two = await context.newPage()
  await Promise.all([one.goto('/'), two.goto('/')])
  for (const page of [one, two]) await expect(page.locator('summary').filter({ hasText: 'Node identity · Ready' })).toBeVisible()
  const snapshot = () => one.evaluate(async () => {
    // Browser module URLs are resolved by Vite; annotate with the same source module's type.
    const path = '/src/identity/application/NodeIdentityManager.ts'
    const { nodeIdentityManager } = await import(path) as typeof import('../src/identity/application/NodeIdentityManager')
    return nodeIdentityManager.getSnapshot()
  })
  const original = await snapshot()
  expect(registrations).toBe(1)
  expect(presenceCreates).toBe(1)
  // Real Chromium IndexedDB structured-clones the non-exportable CryptoKeys across reload.
  await one.reload()
  await expect(one.locator('summary').filter({ hasText: 'Node identity · Ready' })).toBeVisible()
  expect(await snapshot()).toEqual(original)
  await one.locator('summary').filter({ hasText: 'Node identity' }).click()
  await one.getByRole('button', { name: 'Regenerate node identity…' }).click()
  await expect(one.getByRole('button', { name: 'Create new identity' })).toBeDisabled()
  await one.getByRole('checkbox').check()
  await one.getByRole('button', { name: 'Create new identity' }).click()
  await expect.poll(snapshot).not.toEqual(original)
  await expect.poll(() => registrations).toBe(2)
  await expect.poll(async () => {
    const a = await one.locator('summary').filter({ hasText: 'Node identity' }).textContent()
    const b = await two.locator('summary').filter({ hasText: 'Node identity' }).textContent()
    return a === b && a?.includes('Ready')
  }).toBe(true)
  expect(presenceCreates).toBe(1)
  expect(await one.evaluate(async () => {
    const path = '/src/location/persistence/db.ts'
    const { db } = await import(path) as typeof import('../src/location/persistence/db')
    const records = await db.nodeIdentities.toArray()
    return records.map((record) => ({ slot: record.slot, status: record.status, extractable: record.privateKey.extractable }))
  })).toEqual([{ slot: 'active', status: 'REGISTERED', extractable: false }])
})

test('registers a browser-generated identity against the live backend', async ({ page }) => {
  test.skip(process.env.KAVOZI_LIVE_BACKEND !== '1', 'Opt in: creates one permanent test node; the API has no node deletion endpoint.')
  await page.goto('/')
  await expect(page.locator('summary').filter({ hasText: 'Node identity · Ready' })).toBeVisible({ timeout: 20000 })
  const before = await page.locator('summary').filter({ hasText: 'Node identity' }).textContent()
  await page.reload()
  await expect(page.locator('summary').filter({ hasText: 'Node identity · Ready' })).toHaveText(before!)
  // Keep the registered node (no deletion contract), but clean up the temporary Presence.
  await page.getByRole('button', { name: 'Stop discovery' }).click()
})
