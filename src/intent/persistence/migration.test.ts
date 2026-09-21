import Dexie from 'dexie'
import { expect, it } from 'vitest'
import { LocationDatabase } from '../../location/persistence/db'
import { fixtureIntent } from '../../test/intentFixtures'

it.each([1, 2])('upgrades v%s preserving credentials, preferences and existing Intent data/UUIDs', async (version) => {
  const name = `kavozi-upgrade-${crypto.randomUUID()}`
  const old = new Dexie(name)
  old.version(1).stores({ presences: 'key', configurations: 'key', preferences: 'key' })
  if (version === 2) old.version(2).stores({ intents: 'id, templateKey, updatedAt' })
  const intent = fixtureIntent({ active: true, claims: { experience: { type: 'NUMBER', value: 120 } } })
  const { discoveryProjectionId, ...otherFields } = intent
  await old.table('presences').put({ key: 'current', id: 'existing', token: 'private-test-token', sequence: 42 })
  await old.table('preferences').put({ key: 'discovery', stopped: false })
  if (version === 2) await old.table('intents').put({ ...otherFields, discoveryAreaId: discoveryProjectionId })
  old.close()
  const upgraded = new LocationDatabase(name)
  try {
    expect(await upgraded.presences.get('current')).toMatchObject({ id: 'existing', token: 'private-test-token', sequence: 42 })
    expect(await upgraded.preferences.get('discovery')).toEqual({ key: 'discovery', stopped: false })
    expect(upgraded.tables.map((table) => table.name)).not.toContain('configurations')
    if (version === 2) expect(await upgraded.intents.get(intent.id)).toEqual(intent)
    else expect(await upgraded.intents.count()).toBe(0)
    upgraded.close(); await upgraded.open()
    if (version === 2) expect((await upgraded.intents.get(intent.id))?.discoveryProjectionId).toBe(discoveryProjectionId)
  } finally { await upgraded.delete() }
})
