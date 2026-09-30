import { expect, test, type BrowserContext } from '@playwright/test'
import { diveTemplate, coffeeTemplate } from '../src/test/intentFixtures'
import { fixturePresence, metadata } from '../src/test/fixtures'
import type { components } from '../src/api/generated/schema'

type Schema = components['schemas']

async function mockLocationApi(context: BrowserContext, clientNumber: number) {
  const presence = fixturePresence(clientNumber)
  const state = { creates: 0, fixes: [] as Schema['FixRequest'][], projections: [] as Schema['DiscoveryProjectionRequest'][], accepts: 0, deleted: false }
  await context.route('http://localhost:8080/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS' }
    const json = (body: unknown, status = 200) => route.fulfill({ status, headers, json: body })
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    // Node identity is independent: discovery continues even if registration is unavailable.
    if (path === '/v1/node-registration-challenges' || path === '/v1/nodes') return json({}, 503)
    if (path === '/v1/intent-templates') return json([diveTemplate, coffeeTemplate].map(({ key, name, description }) => ({ key, name, description })))
    if (path.startsWith('/v1/intent-templates/')) return json(path.endsWith('/dive') ? diveTemplate : coffeeTemplate)
    if (path === '/.well-known/kavozi-location') return json(metadata)
    if (path === '/v1/presences') {
      expect(request.headers().authorization).toBeUndefined()
      state.creates++
      return json(presence, 201)
    }
    expect(request.headers().authorization === `KavoziPresence ${presence.presenceToken}`).toBe(true)
    expect(path.startsWith(`/v1/presences/${presence.presenceId}`)).toBe(true)
    if (path.endsWith('/location')) {
      const fix = request.postDataJSON() as Schema['FixRequest']
      state.fixes.push(fix)
      return json({ status: 'ACCEPTED', sequence: fix.sequence, expiresAt: presence.expiresAt } satisfies Schema['FixResponse'])
    }
    if (path.endsWith('/discovery-projections')) {
      state.projections = (request.postDataJSON() as Schema['DiscoveryProjectionsRequest']).projections
      return json({ status: 'RECORDED' } satisfies Schema['RecordedResponse'])
    }
    if (path.endsWith('/inbox')) return json({ pollAfterSeconds: 1, offers: state.projections.length ? [{
      offerHandle: '00000000-0000-4000-8000-999999999999', localDiscoveryProjectionIds: state.projections.map((area) => area.id),
      status: state.accepts ? 'ACCEPTED' : 'PENDING', expiresAt: new Date(Date.now() + metadata.offerTtlSeconds * 1000).toISOString(),
    }] : [] } satisfies Schema['InboxResponse'])
    if (path.endsWith('/accept')) { state.accepts++; return json({ status: 'RECORDED' } satisfies Schema['RecordedResponse']) }
    if (request.method() === 'DELETE') { state.deleted = true; return route.fulfill({ status: 204, headers }) }
    return route.fulfill({ status: 404, headers })
  })
  return state
}

test('local Intent creation, dual activation, private offers and independent browser Presences', async ({ browser }) => {
  const alice = await browser.newContext({ permissions: ['geolocation'], geolocation: { latitude: 48.1486, longitude: 17.1077, accuracy: 18 } })
  const bob = await browser.newContext({ permissions: ['geolocation'], geolocation: { latitude: 48.1487, longitude: 17.1078, accuracy: 20 }, viewport: { width: 390, height: 844 } })
  try {
    const aliceState = await mockLocationApi(alice, 1)
    const bobState = await mockLocationApi(bob, 2)
    const alicePage = await alice.newPage()
    const bobPage = await bob.newPage()
    for (const page of [alicePage, bobPage]) {
      await page.goto('http://localhost:5173')
      await page.getByRole('button', { name: 'Enable location' }).click()
      await expect.poll(() => page === alicePage ? aliceState.fixes.length : bobState.fixes.length).toBeGreaterThan(0)
      await page.getByRole('button', { name: 'Your intents' }).click()
      for (const name of ['Dive Buddy', 'Coffee & Conversation']) {
        await page.getByRole('button', { name: 'Create intent' }).click()
        await page.getByRole('button', { name: new RegExp(name) }).click()
        await page.getByRole('textbox', { name: 'Intent title' }).fill(name)
        await page.getByRole('combobox', { name: 'Where', exact: true }).click()
        await page.getByRole('option', { name: 'Around me' }).click()
        await page.getByRole('spinbutton', { name: 'Radius (meters)' }).fill('5000')
        if (name === 'Dive Buddy') await page.getByRole('textbox', { name: 'Your agent instruction' }).fill('Careful buddies, please.')
        if (name === 'Dive Buddy') {
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
          await page.screenshot({ path: page === alicePage ? 'test-results/intent-editor.png' : 'test-results/intent-editor-mobile.png', fullPage: true })
        }
        await page.getByRole('button', { name: 'Save intent' }).click()
        await expect(page.getByRole('button', { name: 'Create intent' })).toBeVisible()
      }
      await page.getByRole('button', { name: 'Discovery', exact: true }).click()
      for (const name of ['Dive Buddy', 'Coffee & Conversation']) {
        await page.getByRole('switch', { name: `Turn ${name} on` }).click()
        await expect(page.getByRole('switch', { name: `Turn ${name} off` })).toBeChecked()
      }
      await expect(page.getByRole('heading', { name: 'DISCOVERABLE', exact: true })).toBeVisible()
      await expect(page.getByText('Through your local intents:')).toBeVisible()
      await expect(page.getByRole('listitem').filter({ hasText: 'Dive Buddy' }).last()).toBeVisible()
      await expect(page.getByRole('listitem').filter({ hasText: 'Coffee & Conversation' }).last()).toBeVisible()
      await expect(page.locator('body')).not.toContainText(/test-secret|48\.148|17\.107|People near you/)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
    expect(aliceState.creates).toBe(1)
    expect(bobState.creates).toBe(1)
    expect(aliceState.projections).toHaveLength(2)
    expect(aliceState.projections[0].id).not.toBe(bobState.projections[0].id)
    expect(Object.keys(aliceState.projections[0]).sort()).toEqual(['claims', 'geography', 'id', 'requirements'])
    const ownIds = aliceState.projections.map((area) => area.id).sort()
    await alicePage.screenshot({ path: 'test-results/alice-intents.png', fullPage: true })
    await bobPage.screenshot({ path: 'test-results/bob-mobile-intents.png', fullPage: true })
    await alicePage.getByRole('button', { name: 'Continue' }).click()
    await expect(alicePage.getByText('Waiting privately for the next step.')).toBeVisible()
    expect(aliceState.accepts).toBe(1)
    expect(bobState.accepts).toBe(0)
    await alicePage.reload()
    // Reload can retain a fresh accepted fix while acquisition still needs enabling.
    await alicePage.getByRole('button', { name: /^(Enable|Update) location$/ }).click()
    await expect(alicePage.getByRole('heading', { name: 'DISCOVERABLE', exact: true })).toBeVisible({ timeout: 10_000 })
    expect(aliceState.creates).toBe(1)
    expect(aliceState.projections.map((area) => area.id).sort()).toEqual(ownIds)
    await expect.poll(() => aliceState.fixes.at(-1)!.sequence, { timeout: 10_000 }).toBeGreaterThan(aliceState.fixes[0].sequence)
    await alicePage.getByRole('button', { name: 'Stop discovery' }).click()
    await expect(alicePage.getByRole('button', { name: 'Start discovery' })).toBeVisible()
    expect(aliceState.deleted).toBe(true)
    expect(bobState.deleted).toBe(false)
  } finally { await alice.close(); await bob.close() }
})
