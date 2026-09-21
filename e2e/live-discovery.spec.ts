/// <reference types="node" />
import process from 'node:process'
import { expect, test, type BrowserContext } from '@playwright/test'
import type { components } from '../src/api/generated/schema'

type Schema = components['schemas']
// Opt-in only: creates temporary real Presences, removed in finally even if UI assertions fail.
test('live backend: template-driven claims, projection replacement, private offers and cleanup', async ({ browser }) => {
  test.skip(process.env.KAVOZI_LIVE_BACKEND !== '1', 'Requires an explicitly selected live backend on localhost:8080')
  test.setTimeout(120_000)
  const contexts: BrowserContext[] = []
  const presences: { context: BrowserContext; value: Schema['PresenceResponse'] }[] = []
  try {
    for (const title of ['Migration Alice', 'Migration Bob']) {
      const context = await browser.newContext({ permissions: ['geolocation'], geolocation: { latitude: 48.1486, longitude: 17.1077, accuracy: 18 } })
      contexts.push(context)
      const page = await context.newPage()
      page.on('response', async (response) => {
        if (response.url() === 'http://localhost:8080/v1/presences' && response.request().method() === 'POST' && response.status() === 201)
          presences.push({ context, value: await response.json() as Schema['PresenceResponse'] })
      })
      const projections: Schema['DiscoveryProjectionsRequest'][] = []
      page.on('request', (request) => {
        if (request.method() === 'PUT' && request.url().endsWith('/discovery-projections')) projections.push(request.postDataJSON() as Schema['DiscoveryProjectionsRequest'])
      })
      await page.goto('/')
      const fix = page.waitForResponse((response) => response.url().endsWith('/location') && response.request().method() === 'PUT' && response.status() === 200)
      await page.getByRole('button', { name: 'Enable location' }).click()
      await fix
      await page.getByRole('button', { name: 'Your intents', exact: true }).click()
      await page.getByRole('button', { name: 'Create intent' }).click()
      await page.getByRole('button', { name: 'Coffee and conversation Meet for an easygoing conversation.' }).click()
      await page.getByRole('textbox', { name: 'Intent title' }).fill(title)
      await page.getByRole('combobox', { name: 'Where', exact: true }).click()
      await page.getByRole('option', { name: 'Around me' }).click()
      await page.getByRole('spinbutton', { name: 'Radius (meters)' }).fill('5000')
      await page.getByRole('combobox', { name: 'Conversation languages', exact: true }).fill('English')
      await page.getByRole('option', { name: 'English', exact: true }).click()
      await page.getByRole('textbox', { name: "Fine-tune what you're looking for" }).fill('Private local test context')
      await page.getByRole('button', { name: 'Save intent' }).click()
      await expect(page.getByRole('button', { name: 'Create intent' })).toBeVisible()
      await page.getByRole('button', { name: 'Discovery', exact: true }).click()
      await page.getByRole('switch', { name: `Turn ${title} on` }).click()
      await expect(page.getByRole('switch', { name: `Turn ${title} off` })).toBeChecked()
      await expect(page.getByRole('heading', { name: 'DISCOVERABLE', exact: true })).toBeVisible()
      expect(projections.at(-1)?.projections[0].claims).toEqual({ languages: { type: 'SET', valueType: 'CODE', values: [{ type: 'CODE', value: 'en' }] } })
      expect(Object.keys(projections.at(-1)!.projections[0]).sort()).toEqual(['claims', 'geography', 'id', 'requirements'])
      expect(JSON.stringify(projections)).not.toContain(title)
      expect(JSON.stringify(projections)).not.toContain('Private local test context')
    }
    for (const context of contexts) {
      const page = context.pages()[0]
      await expect(page.getByText('Location and your requirements align.').first()).toBeVisible({ timeout: 40_000 })
      await expect(page.getByText('Through your local intents:').first()).toBeVisible()
      const otherTitle = context === contexts[0] ? 'Migration Bob' : 'Migration Alice'
      await expect(page.locator('body')).not.toContainText(otherTitle)
    }
    for (const context of contexts) {
      const page = context.pages()[0]
      const ownTitle = context === contexts[0] ? 'Migration Alice' : 'Migration Bob'
      await page.getByRole('switch', { name: `Turn ${ownTitle} off` }).click()
      await expect(page.getByRole('switch', { name: `Turn ${ownTitle} on` })).not.toBeChecked()
      await page.getByRole('button', { name: 'Stop discovery', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Start discovery' })).toBeVisible()
    }
  } finally {
    for (const { context, value } of presences) {
      if (value.presenceId && value.presenceToken) {
        const response = await context.request.delete(`http://localhost:8080/v1/presences/${value.presenceId}`, { headers: { Authorization: `KavoziPresence ${value.presenceToken}` } })
        // Already-deleted or expired Presences may return a terminal status.
        expect([204, 401, 403, 404, 410].includes(response.status())).toBe(true)
      }
    }
    for (const context of contexts) await context.close()
  }
})
