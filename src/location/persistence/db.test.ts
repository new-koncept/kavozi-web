import { afterEach, describe, expect, it } from 'vitest'
import { db, discoveryAreaRepository, presenceRepository } from './db'
import { areaLabel, formatRadius, matchedLocalAreas, type LocalDiscoveryArea, type LocalPresence } from '../model/local'

const presence: LocalPresence = {
  key: 'current', id: 'own-id', token: 'private-token', expiresAt: '2099-01-01T00:00:00Z',
  locationInterval: 10, inboxInterval: 30, sequence: 0, acceptedSequence: 0,
  revision: 0, syncedRevision: 0,
}
afterEach(async () => { await db.presences.clear(); await db.configurations.clear() })

describe('browser state', () => {
  it('persists Presence credentials in IndexedDB', async () => {
    await presenceRepository.save(presence)
    expect(await presenceRepository.get()).toEqual(presence)
  })
  it('reserves monotonically increasing sequences and revisions atomically', async () => {
    await presenceRepository.save(presence)
    expect(await Promise.all([presenceRepository.reserve(presence.id, 'sequence'), presenceRepository.reserve(presence.id, 'sequence')])).toEqual([1, 2])
    expect(await presenceRepository.reserve(presence.id, 'revision')).toBe(1)
    expect(await presenceRepository.reserve(presence.id, 'revision')).toBe(2)
    expect((await presenceRepository.get())?.acceptedSequence).toBe(0)
  })
  it('does not update a replacement Presence with old request state', async () => {
    await presenceRepository.save(presence)
    await expect(presenceRepository.reserve('old-id', 'sequence')).rejects.toThrow('Presence changed')
  })
  it('retains stable local area IDs and maps only known local IDs', async () => {
    const areas: LocalDiscoveryArea[] = [{ id: 'my-area', kind: 'radius', meters: 5000 }]
    await discoveryAreaRepository.save(areas)
    const restored = await discoveryAreaRepository.get()
    expect(restored).toEqual(areas)
    expect(matchedLocalAreas(['unknown', 'my-area'], restored)).toEqual(areas)
    expect(matchedLocalAreas(['unknown'], restored)).toEqual([])
    expect(areaLabel(restored[0])).toBe('5 km around me')
  })
  it('formats human-readable radius units', () => {
    expect(formatRadius(500)).toBe('500 m')
    expect(formatRadius(1250)).toBe('1.25 km')
  })
})
