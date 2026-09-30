/// <reference types="node" />
import process from 'node:process'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import type { Schema } from '../src/api/locationClient'

// Real backend throughout. Only the lost-response scenario intercepts a response AFTER backend storage.
test('live Encounter: independent nodes, admission, Unicode, reliable retry, reload, non-member denial and leave', async ({ browser }) => {
  test.skip(process.env.KAVOZI_LIVE_BACKEND !== '1', 'Opt in to registering three permanent test nodes on localhost:8080')
  test.setTimeout(240000)
  const contexts: BrowserContext[] = [], presences: { context: BrowserContext; value: Schema['PresenceResponse'] }[] = []
  const latitude = 35 + Math.random(), longitude = -35 + Math.random()
  const pages: Page[] = []
  let encounterId = ''
  try {
    for (const title of ['Messaging Alice', 'Messaging Bob', 'Non-member']) {
      const context = await browser.newContext({ permissions: ['geolocation'], geolocation: { latitude, longitude, accuracy: 12 } })
      contexts.push(context)
      const page = await context.newPage(); pages.push(page)
      page.on('response', async (response) => {
        if (response.url() === 'http://localhost:8080/v1/presences' && response.status() === 201)
          presences.push({ context, value: await response.json() as Schema['PresenceResponse'] })
        if (response.url().endsWith('/encounter') && [200, 201].includes(response.status())) {
          const room = await response.json() as Schema['EncounterResponse']
          if (encounterId) expect(room.encounterId).toBe(encounterId)
          encounterId = room.encounterId!
        }
      })
      await page.goto('/')
      await expect(page.locator('summary').filter({ hasText: 'Node identity · Ready' })).toBeVisible({ timeout: 20000 })
      if (title === 'Non-member') continue
      const fix = page.waitForResponse((response) => response.url().endsWith('/location') && response.status() === 200)
      await page.getByRole('button', { name: 'Enable location', exact: true }).click(); await fix
      await page.getByRole('button', { name: 'Your intents', exact: true }).click()
      await page.getByRole('button', { name: 'Create intent' }).click()
      await page.getByRole('button', { name: 'Coffee and conversation Meet for an easygoing conversation.' }).click()
      await page.getByRole('textbox', { name: 'Intent title' }).fill(title)
      await page.getByRole('combobox', { name: 'Where', exact: true }).click()
      await page.getByRole('option', { name: 'Around me' }).click()
      await page.getByRole('spinbutton', { name: 'Radius (meters)' }).fill('5000')
      await page.getByRole('combobox', { name: 'Conversation languages', exact: true }).fill('English')
      await page.getByRole('option', { name: 'English', exact: true }).click()
      await page.getByRole('textbox', { name: "Fine-tune what you're looking for" }).fill('Local context only')
      await page.getByRole('button', { name: 'Save intent' }).click()
      await page.getByRole('button', { name: 'Discovery', exact: true }).click()
      await page.getByRole('switch', { name: `Turn ${title} on` }).click()
      await expect(page.getByRole('heading', { name: 'DISCOVERABLE', exact: true })).toBeVisible()
    }
    const [alice, bob, outsider] = pages
    for (const page of [alice, bob]) await page.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: 60000 })
    for (const page of [alice, bob]) {
      await page.getByRole('button', { name: 'Open conversation', exact: true }).click({ timeout: 60000 })
      await expect(page.getByText('Open · 2 participants', { exact: true })).toBeVisible({ timeout: 20000 })
    }
    await alice.getByRole('textbox', { name: 'Message', exact: true }).fill('Ahoj, príliš žluťoučký kôň 🌿')
    await alice.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(bob.getByText('Ahoj, príliš žluťoučký kôň 🌿', { exact: true })).toHaveCount(1, { timeout: 10000 })
    await bob.getByRole('textbox', { name: 'Message', exact: true }).fill('Čau Alice! Dobrý deň 👋')
    await bob.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(alice.getByText('Čau Alice! Dobrý deň 👋', { exact: true })).toHaveCount(1, { timeout: 10000 })

    // Hold event reconciliation long enough to explicitly exercise same-ID POST retry.
    let holdEvents = true, sends = 0, firstBytes: string | null = null, firstSignature: string | undefined
    await alice.route('**/v1/encounters/*/events?*', async (route) => holdEvents ? route.fulfill({ status: 503, json: {} }) : route.continue())
    await alice.route('**/v1/encounters/*/messages', async (route) => {
      const request = route.request()
      sends++
      if (sends === 1) {
        firstBytes = request.postData(); firstSignature = request.headers()['signature-input']
        const response = await route.fetch()
        expect(response.status()).toBe(201)
        await route.abort('failed') // The server stored it, but the browser never received the response.
      } else {
        expect(request.postData() === firstBytes).toBe(true)
        expect(request.headers()['signature-input'] === firstSignature).toBe(false)
        const response = await route.fetch(); expect(response.status()).toBe(200)
        await route.fulfill({ response })
      }
    })
    await alice.getByRole('textbox', { name: 'Message', exact: true }).fill('Retry without duplication 🔁')
    await alice.getByRole('button', { name: 'Send message', exact: true }).click()
    await alice.getByRole('button', { name: 'Retry same message', exact: true }).click()
    await expect.poll(() => sends).toBe(2)
    holdEvents = false
    await expect(bob.getByText('Retry without duplication 🔁', { exact: true })).toHaveCount(1, { timeout: 12000 })
    await expect(alice.getByText('Retry without duplication 🔁', { exact: true })).toHaveCount(1)
    await expect(alice.getByRole('button', { name: 'Retry same message', exact: true })).toHaveCount(0)
    await alice.unroute('**/v1/encounters/*/messages')
    await alice.unroute('**/v1/encounters/*/events?*')

    await alice.getByRole('button', { name: 'Discovery', exact: true }).click()
    await alice.getByRole('button', { name: 'Stop discovery', exact: true }).click()
    await expect(alice.getByRole('button', { name: 'Start discovery' })).toBeVisible()
    await alice.reload()
    await alice.getByRole('button', { name: 'Conversations', exact: true }).click()
    await alice.getByRole('button', { name: /Conversation 1/ }).click()
    await expect(alice.getByText('Čau Alice! Dobrý deň 👋', { exact: true })).toHaveCount(1)
    await alice.getByRole('textbox', { name: 'Message', exact: true }).fill('Still here without Presence')
    await alice.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(bob.getByText('Still here without Presence', { exact: true })).toHaveCount(1, { timeout: 10000 })

    const denied = await outsider.evaluate(async (id) => {
      const identityPath = '/src/identity/application/NodeIdentityManager.ts', apiPath = '/src/encounter/api/encounterClient.ts', protocolPath = '/src/encounter/application/textProtocol.ts'
      const { nodeIdentityManager } = await import(identityPath) as typeof import('../src/identity/application/NodeIdentityManager')
      const { createEncounterClient, EncounterError } = await import(apiPath) as typeof import('../src/encounter/api/encounterClient')
      const { encodeMessage } = await import(protocolPath) as typeof import('../src/encounter/application/textProtocol')
      const state = nodeIdentityManager.getSnapshot(); if (state.status !== 'READY') throw new Error('Identity unavailable')
      const api = createEncounterClient(state.fingerprint)
      try {
        const status = async (action: () => Promise<unknown>) => { try { await action(); return 200 } catch (error) { return error instanceof EncounterError ? error.status : 0 } }
        const request = encodeMessage('Not a member', 2, await api.metadata())
        return [await status(() => api.get(id)), await status(() => api.events(id, 0)), await status(() => api.send(id, request.body, request.serialized))]
      } finally { api.dispose() }
    }, encounterId)
    expect(denied).toEqual([404, 404, 404])
    await bob.getByRole('button', { name: 'Leave conversation', exact: true }).click()
    await bob.getByRole('button', { name: 'Confirm leave', exact: true }).click()
    await expect(alice.getByText('Closed · 1 participants', { exact: true })).toBeVisible({ timeout: 10000 })
    await expect(alice.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled()
    const afterLeave = await bob.evaluate(async (id) => {
      const identityPath = '/src/identity/application/NodeIdentityManager.ts', apiPath = '/src/encounter/api/encounterClient.ts'
      const { nodeIdentityManager } = await import(identityPath) as typeof import('../src/identity/application/NodeIdentityManager')
      const { createEncounterClient, EncounterError } = await import(apiPath) as typeof import('../src/encounter/api/encounterClient')
      const state = nodeIdentityManager.getSnapshot(); if (state.status !== 'READY') throw new Error('Identity unavailable')
      const api = createEncounterClient(state.fingerprint)
      try { await api.get(id); return 200 } catch (error) { return error instanceof EncounterError ? error.status : 0 } finally { api.dispose() }
    }, encounterId)
    expect(afterLeave).toBe(404)
  } finally {
    for (const { context, value } of presences) if (value.presenceId && value.presenceToken)
      await context.request.delete(`http://localhost:8080/v1/presences/${value.presenceId}`, { headers: { Authorization: `KavoziPresence ${value.presenceToken}` } }).catch(() => undefined)
    for (const context of contexts) await context.close()
  }
})
