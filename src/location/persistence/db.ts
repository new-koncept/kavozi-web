import type { StoredNodeIdentity } from '../../identity/persistence/identityRepository'
import Dexie, { type Table } from 'dexie'
import type { LocalPresence } from '../model/local'
import type { Intent } from '../../intent/model/Intent'
import type { PendingMessage } from '../../encounter/persistence/outbox'

export type DiscoveryPreference = {
  key: 'discovery'
  stopped: boolean
  locationEnabled?: boolean
}

export class LocationDatabase extends Dexie {
  nodeIdentities!: Table<StoredNodeIdentity, string>
  encounterOutbox!: Table<PendingMessage, [string, string]>
  presences!: Table<LocalPresence, string>
  preferences!: Table<DiscoveryPreference, string>
  intents!: Table<Intent, string>

  constructor(name = 'kavozi-location') {
    super(name)
    this.version(1).stores({ presences: 'key', configurations: 'key', preferences: 'key' })
    this.version(2).stores({ intents: 'id, templateKey, updatedAt' })
    this.version(3).stores({ configurations: null }).upgrade(async (transaction) => {
      // Read the legacy property only here; preserve the existing UUID and all user data.
      await transaction.table('intents').toCollection().modify((intent: Record<string, unknown>) => {
        intent.discoveryProjectionId ??= intent.discoveryAreaId ?? crypto.randomUUID()
        delete intent.discoveryAreaId
      })
    })
    this.version(4).stores({ nodeIdentities: 'slot' })
    this.version(5).stores({ encounterOutbox: '[fingerprint+encounterId]' })
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
  async reserve(id: string, field: 'sequence') {
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

export const discoveryPreferenceRepository = {
  get: () => db.preferences.get('discovery'),
  async setLocationEnabled(locationEnabled: boolean) {
    return db.transaction('rw', db.preferences, async () => {
      const current = await db.preferences.get('discovery')
      await db.preferences.put({ key: 'discovery', stopped: current?.stopped ?? false, locationEnabled })
    })
  },
}
