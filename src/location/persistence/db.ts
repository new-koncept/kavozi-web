import Dexie, { type Table } from 'dexie'
import type { LocalDiscoveryArea, LocalPresence } from '../model/local'
import type { Intent } from '../../intent/model/Intent'

export class LocationDatabase extends Dexie {
  presences!: Table<LocalPresence, string>
  configurations!: Table<{ key: 'areas'; areas: LocalDiscoveryArea[] }, string>
  preferences!: Table<{ key: 'discovery'; stopped: boolean }, string>
  intents!: Table<Intent, string>

  constructor(name = 'kavozi-location') {
    super(name)
    this.version(1).stores({ presences: 'key', configurations: 'key', preferences: 'key' })
    this.version(2).stores({ intents: 'id, templateKey, updatedAt' })
  }
}

export const db = new LocationDatabase()

export const presenceRepository = {
  get: () => db.presences.get('current'),
  save: (presence: LocalPresence) => db.presences.put(presence),
  async update(id: string, changes: Partial<LocalPresence>) {
    return db.transaction('rw', db.presences, async () => {
      const current = await db.presences.get('current')
      if (!current || current.id !== id) throw new Error('Presence changed. Please try again.')
      const updated = { ...current, ...changes }
      await db.presences.put(updated)
      return updated
    })
  },
  async reserve(id: string, field: 'sequence' | 'revision') {
    return db.transaction('rw', db.presences, async () => {
      const current = await db.presences.get('current')
      if (!current || current.id !== id) throw new Error('Presence changed. Please try again.')
      const value = current[field] + 1
      if (!Number.isSafeInteger(value)) throw new Error('Please reset your presence.')
      await db.presences.put({ ...current, [field]: value })
      return value
    })
  },
}

export const discoveryAreaRepository = {
  async get() { return (await db.configurations.get('areas'))?.areas ?? [] },
  save: (areas: LocalDiscoveryArea[]) => db.configurations.put({ key: 'areas', areas }),
}
