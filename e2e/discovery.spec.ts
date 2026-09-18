import { expect, test, type BrowserContext } from '@playwright/test'
import { fixturePresence, metadata } from '../src/test/fixtures'
import type { components } from '../src/api/generated/schema'

type Schema = components['schemas']

async function mockLocationApi(context: BrowserContext, clientNumber: number) {
  const presence = fixturePresence(clientNumber)
  const state = { creates: 0, fixes: [] as Schema['FixRequest'][], areas: [] as Schema['AreaRequest'][], accepts: 0, deleted: false }
  await context.route('http://localhost:8080/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS' }
    const json = (body: unknown, status = 200) => route.fulfill({ status, headers, json: body })
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
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
    if (path.endsWith('/discovery-areas')) {
      state.areas = (request.postDataJSON() as Schema['AreasRequest']).areas
      return json({ status: 'RECORDED' } satisfies Schema['RecordedResponse'])
    }
    if (path.endsWith('/inbox')) return json({ pollAfterSeconds: 30, offers: state.areas.length ? [{
      offerHandle: '00000000-0000-4000-8000-999999999999', localDiscoveryAreaIds: state.areas.map((area) => area.id),
      status: state.accepts ? 'ACCEPTED' : 'PENDING', expiresAt: new Date(Date.now() + metadata.offerTtlSeconds * 1000).toISOString(),
    }] : [] } satisfies Schema['InboxResponse'])
    if (path.endsWith('/accept')) { state.accepts++; return json({ status: 'RECORDED' } satisfies Schema['RecordedResponse']) }
    if (request.method() === 'DELETE') { state.deleted = true; return route.fulfill({ status: 204, headers }) }
    return route.fulfill({ status: 404, headers })
  })
  return state
}

test('Alice and Bob have isolated anonymous Presences, GPS updates, local areas and offers', async ({ browser }) => {
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
      await expect(page.getByText('Location active', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Add radius area' }).click()
      await page.getByRole('button', { name: 'Save discovery areas' }).click()
      await expect(page.getByText('You’re discoverable.')).toBeVisible()
      await expect(page.getByText('Something matched', { exact: true })).toBeVisible()
      await expect(page.getByText('Matched through your own areas:')).toBeVisible()
      await expect(page.locator('body')).not.toContainText(/test-secret|48\.148|17\.107|People near you/)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
    expect(aliceState.creates).toBe(1)
    expect(bobState.creates).toBe(1)
    expect(aliceState.areas[0].id).not.toBe(bobState.areas[0].id)
    // A same-origin tab must share the existing Presence rather than create another.
    const aliceTab = await alice.newPage()
    await aliceTab.goto('http://localhost:5173')
    await expect(aliceTab.getByRole('button', { name: 'Enable location' })).toBeVisible()
    expect(aliceState.creates).toBe(1)
    await aliceTab.close()
    expect(aliceState.fixes[0].latitude).toBe(48.1486)
    expect(bobState.fixes[0].latitude).toBe(48.1487)
    const ownId = aliceState.areas[0].id
    await alicePage.screenshot({ path: 'test-results/alice-discovery.png', fullPage: true })
    await bobPage.screenshot({ path: 'test-results/bob-mobile.png', fullPage: true })
    await alicePage.getByRole('button', { name: 'Continue' }).click()
    await expect(alicePage.getByText('Waiting privately for the next step.')).toBeVisible()
    expect(aliceState.accepts).toBe(1)
    expect(bobState.accepts).toBe(0)
    await alicePage.reload()
    await alicePage.getByRole('button', { name: 'Enable location' }).click()
    await expect(alicePage.getByText('Location active', { exact: true })).toBeVisible({ timeout: 10_000 })
    expect(aliceState.creates).toBe(1)
    expect(aliceState.areas[0].id).toBe(ownId)
    expect(aliceState.fixes.at(-1)!.sequence).toBeGreaterThan(aliceState.fixes[0].sequence)
    await alicePage.getByRole('button', { name: 'Stop discovery' }).click()
    await expect(alicePage.getByRole('button', { name: 'Start discovery' })).toBeVisible()
    expect(aliceState.deleted).toBe(true)
    expect(bobState.deleted).toBe(false)
  } finally { await alice.close(); await bob.close() }
})
