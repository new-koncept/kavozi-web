import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { ApiError, locationClient, type Schema } from '../../api/locationClient'
import { apiState, base, metadata, position, resetApiState, server } from '../../test/server'
import { db, discoveryAreaRepository, presenceRepository } from '../persistence/db'
import { presenceService } from './presenceService'
import { fixProblem, submitLocation } from './locationService'
import { replaceDiscoveryAreas, toTransportAreas } from './discoveryAreaService'
import { loadMetadata } from './metadata'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(resetApiState)
afterEach(async () => {
  vi.restoreAllMocks(); server.resetHandlers()
  await db.presences.clear(); await db.configurations.clear(); await db.preferences.clear()
})

describe('contract and application services', () => {
  it('deduplicates concurrent startup requests', async () => {
    const [first, second] = await Promise.all([presenceService.ensure(), presenceService.ensure()])
    expect(first?.id).toBe(second?.id)
    expect(apiState.creates).toBe(1)
  })
  it('replaces expired Presence and resets counters', async () => {
    const first = (await presenceService.ensure())!
    await presenceRepository.update(first.id, { expiresAt: '2000-01-01T00:00:00Z', sequence: 20, revision: 30 })
    const next = await presenceService.ensure()
    expect(next?.id).not.toBe(first.id)
    expect(next?.sequence).toBe(0)
    expect(next?.revision).toBe(0)
  })
  it('does not automatically retry an ambiguous creation failure on reload', async () => {
    let calls = 0
    server.use(http.post(`${base}/v1/presences`, () => { calls++; return HttpResponse.error() }))
    await expect(presenceService.ensure()).rejects.toBeInstanceOf(ApiError)
    expect(await presenceService.ensure()).toBeNull()
    expect(calls).toBe(1)
  })
  it('persists accepted sequence and renewed expiry, and throttles after reload', async () => {
    const presence = (await presenceService.ensure())!
    const fix = position()
    const renewed = new Date(Date.now() + 7200_000).toISOString()
    server.use(http.put(`${base}/v1/presences/:presenceId/location`, async ({ request }) => {
      const body = await request.json() as Schema['FixRequest']
      return HttpResponse.json({ status: 'ACCEPTED', sequence: body.sequence, expiresAt: renewed })
    }))
    await submitLocation(presence.id, fix, metadata)
    expect(await presenceRepository.get()).toMatchObject({ sequence: 1, acceptedSequence: 1, expiresAt: renewed })
    const restored = (await presenceService.ensure())!
    expect(await submitLocation(restored.id, position(), metadata)).toHaveProperty('wait')
    await presenceRepository.update(presence.id, { lastLocationSentAt: Date.now() - 6000 })
    await submitLocation(restored.id, position(), metadata)
    expect((await presenceRepository.get())?.acceptedSequence).toBe(2)
  })
  it('consumes a rejected sequence safely and retries with a higher sequence', async () => {
    const presence = (await presenceService.ensure())!
    server.use(http.put(`${base}/v1/presences/:presenceId/location`, () => new HttpResponse('not a JSON error contract', { status: 409 }), { once: true }))
    await expect(submitLocation(presence.id, position(), metadata)).rejects.toMatchObject({ status: 409 })
    expect(await presenceRepository.get()).toMatchObject({ sequence: 1, acceptedSequence: 0 })
    await presenceRepository.update(presence.id, { lastLocationSentAt: 0 })
    await submitLocation(presence.id, position(), metadata)
    expect(apiState.fixes[0].sequence).toBe(2)
  })
  it('retains desired areas after failure and sends the whole set with a higher revision on retry', async () => {
    const presence = (await presenceService.ensure())!
    const areas = [{ id: crypto.randomUUID(), kind: 'radius' as const, meters: 5000 }]
    server.use(http.put(`${base}/v1/presences/:presenceId/discovery-areas`, () => new HttpResponse(null, { status: 409 }), { once: true }))
    await expect(replaceDiscoveryAreas(presence.id, areas, metadata)).rejects.toMatchObject({ status: 409 })
    expect(await discoveryAreaRepository.get()).toEqual(areas)
    expect(await presenceRepository.get()).toMatchObject({ revision: 1, syncedRevision: 0 })
    await replaceDiscoveryAreas(presence.id, areas, metadata)
    expect(apiState.configurations[0]).toEqual({ areas: toTransportAreas(areas) })
  })
  it('validates accuracy, freshness, future tolerance and radius using metadata', async () => {
    expect(fixProblem(position({ accuracy: metadata.maxAccuracyMeters + 1 }), metadata)).toBe('poor')
    expect(fixProblem(position({}, Date.now() - 121_000), metadata)).toBe('stale')
    expect(fixProblem(position({}, Date.now() + 11_000), metadata)).toBe('stale')
    expect(fixProblem(position({ latitude: 91 }), metadata)).toBe('unavailable')
    const presence = (await presenceService.ensure())!
    await expect(replaceDiscoveryAreas(presence.id, [{ id: crypto.randomUUID(), kind: 'radius', meters: 1 }], metadata)).rejects.toMatchObject({ status: 400 })
    expect(apiState.configurations).toHaveLength(0)
  })
  it('keeps credentials when deletion fails so the user can retry', async () => {
    const presence = await presenceService.ensure()
    server.use(http.delete(`${base}/v1/presences/:presenceId`, () => new HttpResponse(null, { status: 503 })))
    await expect(presenceService.stop()).rejects.toMatchObject({ status: 503 })
    expect(await presenceRepository.get()).toEqual(presence)
  })
  it('does not invent defaults when required metadata is missing', async () => {
    server.use(http.get(`${base}/.well-known/kavozi-location`, () => HttpResponse.json({ apiVersion: 'v1' })))
    await expect(loadMetadata()).rejects.toBeInstanceOf(ApiError)
  })
  it('uses optional administrative-area type and keeps public requests unauthenticated', async () => {
    let inspected = false
    server.use(http.get(`${base}/v1/location/administrative-areas`, ({ request }) => {
      expect(new URL(request.url).searchParams.get('type')).toBe('DISTRICT')
      expect(request.headers.has('Authorization')).toBe(false)
      inspected = true
      return HttpResponse.json([])
    }))
    expect(await locationClient.searchAdministrativeAreas('Žilina', 'DISTRICT')).toEqual([])
    expect(inspected).toBe(true)
  })
})
