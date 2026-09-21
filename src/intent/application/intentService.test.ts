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
  await intentService.save({ ...intent, title: 'New title', discoveryProjectionId: crypto.randomUUID() }, metadata)
  const saved = await intentRepository.get(intent.id)
  expect(saved?.title).toBe('New title')
  expect(saved?.discoveryProjectionId).toBe(intent.discoveryProjectionId)
  expect(saved).not.toHaveProperty('version')
  expect(saved).not.toHaveProperty('revision')
  expect(saved).not.toHaveProperty('templateVersion')
})
it('activates/deactivates by replacing the complete geography set', async () => {
  const one = fixtureIntent(), two = fixtureIntent({ title: 'Second' })
  await intentService.save(one, metadata); await intentService.save(two, metadata)
  await intentService.setActive(one.id, true, metadata)
  await intentService.setActive(two.id, true, metadata)
  expect(apiState.configurations.at(-1)?.projections.map((area) => area.id).sort()).toEqual([one.discoveryProjectionId, two.discoveryProjectionId].sort())
  await intentService.setActive(one.id, false, metadata)
  expect(apiState.configurations.at(-1)?.projections).toEqual([{ id: two.discoveryProjectionId, geography: { type: 'RADIUS', radiusMeters: 5000 }, claims: {}, requirements: [] }])
  await intentService.setActive(two.id, false, metadata)
  expect(apiState.configurations.at(-1)).toEqual({ projections: [] })
  expect(await db.intents.count()).toBe(2)
})
it('requires active-delete confirmation and retains a retryable record until successful synchronization', async () => {
  const intent = fixtureIntent()
  await intentService.save(intent, metadata); await intentService.setActive(intent.id, true, metadata)
  await expect(intentService.delete(intent.id, metadata)).rejects.toThrow('Confirm deletion')
  server.use(http.put(`${base}/v1/presences/:presenceId/discovery-projections`, () => new HttpResponse(null, { status: 503 })))
  await expect(intentService.delete(intent.id, metadata, true)).rejects.toMatchObject({ status: 503 })
  expect(await intentRepository.get(intent.id)).toMatchObject({ active: true })
  await expect(intentService.delete(intent.id, metadata, true)).rejects.toMatchObject({ status: 503 })
  expect(await intentRepository.get(intent.id)).toBeDefined()
  server.resetHandlers()
  await intentService.delete(intent.id, metadata, true)
  expect(await intentRepository.get(intent.id)).toBeUndefined()
  expect(apiState.configurations.at(-1)).toEqual({ projections: [] })
})
it('preserves data and withdraws an active Intent when the current template is incompatible', async () => {
  const intent = fixtureIntent({ claims: { certification: { type: 'CODE', value: 'AOW' } } })
  await intentService.save(intent, metadata); await intentService.setActive(intent.id, true, metadata)
  apiState.templates[0].fields = []
  await intentService.synchronize(metadata)
  expect(await intentRepository.get(intent.id)).toMatchObject({ active: false, claims: intent.claims })
  expect(apiState.configurations.at(-1)).toEqual({ projections: [] })
  await expect(intentService.setActive(intent.id, true, metadata)).rejects.toThrow('needs review')
})
it('suspends remote geography when templates are unavailable without losing active local choices', async () => {
  const intent = fixtureIntent()
  await intentService.save(intent, metadata); await intentService.setActive(intent.id, true, metadata)
  server.use(http.get(`${base}/v1/intent-templates/:key`, () => new HttpResponse(null, { status: 503 })))
  await expect(intentService.synchronize(metadata)).rejects.toThrow('suspended')
  expect(apiState.configurations.at(-1)).toEqual({ projections: [] })
  expect((await intentRepository.get(intent.id))?.active).toBe(true)
})
it('enforces the current maximum number of active intents', async () => {
  const one = fixtureIntent(), two = fixtureIntent({ title: 'Other' })
  await intentService.save(one, metadata); await intentService.save(two, metadata)
  const limited = { ...metadata, maxDiscoveryProjections: 1 }
  await intentService.setActive(one.id, true, limited)
  await expect(intentService.setActive(two.id, true, limited)).rejects.toThrow('up to 1')
  expect((await intentRepository.get(two.id))?.active).toBe(false)
})
it('does not persist failed activation or deactivation, including deterministic rejection', async () => {
  const intent = fixtureIntent(); await intentService.save(intent, metadata)
  server.use(http.put(`${base}/v1/presences/:presenceId/discovery-projections`, () => new HttpResponse(null, { status: 422 })))
  await expect(intentService.setActive(intent.id, true, metadata)).rejects.toThrow('Review your active intents')
  expect((await db.intents.get(intent.id))?.active).toBe(false)
  server.resetHandlers(); await intentService.setActive(intent.id, true, metadata)
  server.use(http.put(`${base}/v1/presences/:presenceId/discovery-projections`, () => new HttpResponse(null, { status: 503 })))
  await expect(intentService.setActive(intent.id, false, metadata)).rejects.toMatchObject({ status: 503 })
  expect((await db.intents.get(intent.id))?.active).toBe(true)
})
it('commits activation only after recording, and active deletion only after withdrawal', async () => {
  const intent = fixtureIntent(); await intentService.save(intent, metadata)
  const snapshots: unknown[] = []
  server.use(http.put(`${base}/v1/presences/:presenceId/discovery-projections`, async ({ request }) => {
    snapshots.push({ local: await db.intents.get(intent.id), body: await request.json() })
    return HttpResponse.json({ status: 'RECORDED' })
  }))
  await intentService.setActive(intent.id, true, metadata)
  expect(snapshots[0]).toMatchObject({ local: { active: false }, body: { projections: [{ id: intent.discoveryProjectionId }] } })
  await intentService.delete(intent.id, metadata, true)
  expect(snapshots[1]).toMatchObject({ local: { active: true }, body: { projections: [] } })
  expect(await db.intents.get(intent.id)).toBeUndefined()
})
it('resynchronizes active edits before saving and preserves the last saved values on failure', async () => {
  const intent = fixtureIntent(); await intentService.save(intent, metadata); await intentService.setActive(intent.id, true, metadata)
  const existing = (await db.intents.get(intent.id))!
  const changed = { ...existing, claims: { experience: { type: 'NUMBER' as const, value: 120 } } }
  await intentService.save(changed, metadata)
  expect(apiState.configurations.at(-1)?.projections[0]).toMatchObject({ id: intent.discoveryProjectionId, claims: changed.claims })
  server.use(http.put(`${base}/v1/presences/:presenceId/discovery-projections`, () => new HttpResponse(null, { status: 503 })))
  await expect(intentService.save({ ...changed, claims: { experience: { type: 'NUMBER', value: 500 } } }, metadata)).rejects.toMatchObject({ status: 503 })
  expect((await db.intents.get(intent.id))?.claims).toEqual(changed.claims)
})
it('rejects metadata-incompatible claims before any activation request or local mutation', async () => {
  const intent = fixtureIntent({ claims: { experience: { type: 'NUMBER', value: 120 } } })
  await intentService.save(intent, metadata)
  await expect(intentService.setActive(intent.id, true, { ...metadata, maxClaimsPerProjection: 0 })).rejects.toThrow('up to 0 claims')
  expect(apiState.configurations).toEqual([])
  expect((await db.intents.get(intent.id))?.active).toBe(false)
})
it('keeps editing, deactivation and deletion local after discovery has explicitly stopped', async () => {
  const one = fixtureIntent(), two = fixtureIntent()
  await intentService.save(one, metadata); await intentService.save(two, metadata)
  await intentService.setActive(one.id, true, metadata); await intentService.setActive(two.id, true, metadata)
  await presenceService.stop()
  const count = apiState.configurations.length
  await intentService.save({ ...(await db.intents.get(one.id))!, title: 'Edited while stopped' }, metadata)
  await intentService.setActive(one.id, false, metadata)
  await intentService.delete(two.id, metadata, true)
  expect((await db.intents.get(one.id))?.title).toBe('Edited while stopped')
  expect((await db.intents.get(one.id))?.active).toBe(false)
  expect(await db.intents.get(two.id)).toBeUndefined()
  expect(apiState.configurations).toHaveLength(count)
  await expect(intentService.setActive(one.id, true, metadata)).rejects.toThrow('Start discovery')
})
