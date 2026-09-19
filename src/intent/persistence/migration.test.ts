import Dexie from 'dexie'
import { expect, it } from 'vitest'
import { LocationDatabase } from '../../location/persistence/db'

it('upgrades v1 without deleting Presence credentials or saved Location preferences', async () => {
  const name = `kavozi-upgrade-${crypto.randomUUID()}`
  const old = new Dexie(name)
  old.version(1).stores({ presences: 'key', configurations: 'key', preferences: 'key' })
  await old.table('presences').put({ key: 'current', id: 'existing', token: 'private-test-token' })
  await old.table('configurations').put({ key: 'areas', areas: [{ id: 'old-area', kind: 'radius', meters: 5000 }] })
  old.close()
  const upgraded = new LocationDatabase(name)
  try {
    expect((await upgraded.presences.get('current'))?.id).toBe('existing')
    expect((await upgraded.configurations.get('areas'))?.areas).toHaveLength(1)
    expect(await upgraded.intents.count()).toBe(0)
  } finally { await upgraded.delete() }
})
