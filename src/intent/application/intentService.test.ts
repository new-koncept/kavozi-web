import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { db } from '../../location/persistence/db'
import { presenceService } from '../../location/application/presenceService'
import { apiState, base, metadata, resetApiState, server } from '../../test/server'
import { fixtureIntent } from '../../test/intentFixtures'
import { intentService } from './intentService'
import { intentRepository } from '../persistence/intentRepository'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(async () => { resetApiState(); await presenceService.ensure() })
afterEach(async () => { server.resetHandlers(); await db.intents.clear(); await db.presences.clear(); await db.preferences.clear() })

it('persists and edits Intent locally without adding version fields or changing stable identifiers', async () => {
  const intent = fixtureIntent()
  await intentService.save(intent, metadata)
  await intentService.save({ ...intent, title: 'New title', discoveryAreaId: crypto.randomUUID() }, metadata)
  const saved = await intentRepository.get(intent.id)
  expect(saved?.title).toBe('New title')
  expect(saved?.discoveryAreaId).toBe(intent.discoveryAreaId)
  expect(saved).not.toHaveProperty('version')
  expect(saved).not.toHaveProperty('revision')
  expect(saved).not.toHaveProperty('templateVersion')
})
it('activates/deactivates by replacing the complete geography set', async () => {
  const one = fixtureIntent(), two = fixtureIntent({ title: 'Second' })
  await intentService.save(one, metadata); await intentService.save(two, metadata)
  await intentService.setActive(one.id, true, metadata)
  await intentService.setActive(two.id, true, metadata)
  expect(apiState.configurations.at(-1)?.areas.map((area) => area.id).sort()).toEqual([one.discoveryAreaId, two.discoveryAreaId].sort())
  await intentService.setActive(one.id, false, metadata)
  expect(apiState.configurations.at(-1)?.areas).toEqual([{ id: two.discoveryAreaId, type: 'RADIUS', radiusMeters: 5000 }])
  await intentService.setActive(two.id, false, metadata)
  expect(apiState.configurations.at(-1)).toEqual({ areas: [] })
  expect(await db.intents.count()).toBe(2)
})
it('requires active-delete confirmation and retains a retryable record until successful synchronization', async () => {
  const intent = fixtureIntent()
  await intentService.save(intent, metadata); await intentService.setActive(intent.id, true, metadata)
  await expect(intentService.delete(intent.id, metadata)).rejects.toThrow('Confirm deletion')
  server.use(http.put(`${base}/v1/presences/:presenceId/discovery-areas`, () => new HttpResponse(null, { status: 503 })))
  await expect(intentService.delete(intent.id, metadata, true)).rejects.toMatchObject({ status: 503 })
  expect(await intentRepository.get(intent.id)).toMatchObject({ active: false, pendingDeletion: true })
  await expect(intentService.delete(intent.id, metadata)).rejects.toMatchObject({ status: 503 })
  expect(await intentRepository.get(intent.id)).toBeDefined()
  server.resetHandlers()
  await intentService.delete(intent.id, metadata)
  expect(await intentRepository.get(intent.id)).toBeUndefined()
  expect(apiState.configurations.at(-1)).toEqual({ areas: [] })
})
it('preserves data and withdraws an active Intent when the current template is incompatible', async () => {
  const intent = fixtureIntent({ claims: { certification: { type: 'CODE', value: 'AOW' } } })
  await intentService.save(intent, metadata); await intentService.setActive(intent.id, true, metadata)
  apiState.templates[0].fields = []
  await intentService.synchronize(metadata)
  expect(await intentRepository.get(intent.id)).toMatchObject({ active: false, claims: intent.claims })
  expect(apiState.configurations.at(-1)).toEqual({ areas: [] })
  await expect(intentService.setActive(intent.id, true, metadata)).rejects.toThrow('needs review')
})
it('suspends remote geography when templates are unavailable without losing active local choices', async () => {
  const intent = fixtureIntent()
  await intentService.save(intent, metadata); await intentService.setActive(intent.id, true, metadata)
  server.use(http.get(`${base}/v1/intent-templates/:key`, () => new HttpResponse(null, { status: 503 })))
  await expect(intentService.synchronize(metadata)).rejects.toThrow('suspended')
  expect(apiState.configurations.at(-1)).toEqual({ areas: [] })
  expect((await intentRepository.get(intent.id))?.active).toBe(true)
})
it('enforces the current maximum number of active intents', async () => {
  const one = fixtureIntent(), two = fixtureIntent({ title: 'Other' })
  await intentService.save(one, metadata); await intentService.save(two, metadata)
  const limited = { ...metadata, maxDiscoveryAreas: 1 }
  await intentService.setActive(one.id, true, limited)
  await expect(intentService.setActive(two.id, true, limited)).rejects.toThrow('up to 1')
  expect((await intentRepository.get(two.id))?.active).toBe(false)
})
