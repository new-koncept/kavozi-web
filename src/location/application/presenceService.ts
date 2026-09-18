import { ApiError, locationClient } from '../../api/locationClient'
import type { LocalPresence } from '../model/local'
import { db, presenceRepository } from '../persistence/db'
import { withPresenceLock } from './browserLock'

async function create(): Promise<LocalPresence> {
  // If POST has an ambiguous network failure, a reload must not silently repeat it.
  await db.preferences.put({ key: 'discovery', stopped: true })
  const response = await locationClient.createPresence()
  if (!response.presenceId || !response.presenceToken || !response.expiresAt
    || !(Date.parse(response.expiresAt) > Date.now())
    || !Number.isFinite(response.locationUpdateAfterSeconds) || !Number.isFinite(response.inboxPollAfterSeconds)
    || !(response.locationUpdateAfterSeconds! > 0) || !(response.inboxPollAfterSeconds! > 0)) throw new ApiError(502)
  const presence: LocalPresence = {
    key: 'current', id: response.presenceId, token: response.presenceToken,
    expiresAt: response.expiresAt, locationInterval: response.locationUpdateAfterSeconds!,
    inboxInterval: response.inboxPollAfterSeconds!, sequence: 0, acceptedSequence: 0,
    revision: 0, syncedRevision: 0,
  }
  await db.transaction('rw', db.presences, db.preferences, async () => {
    await presenceRepository.save(presence)
    await db.preferences.put({ key: 'discovery', stopped: false })
  })
  return presence
}

export const presenceService = {
  ensure: (explicit = false) => withPresenceLock(async () => {
    const current = await presenceRepository.get()
    if (current && Date.parse(current.expiresAt) > Date.now() && current.token) return current
    if (current) await db.presences.delete('current')
    if (!explicit && (await db.preferences.get('discovery'))?.stopped) return null
    return create()
  }),
  recover: (invalidId: string, allowCreate: boolean) => withPresenceLock(async () => {
    const current = await presenceRepository.get()
    if (!current || current.id !== invalidId) return current ?? null
    await db.transaction('rw', db.presences, db.preferences, async () => {
      await db.presences.delete('current')
      await db.preferences.put({ key: 'discovery', stopped: true })
    })
    return allowCreate ? create() : null
  }),
  stop: () => withPresenceLock(async () => {
    const current = await presenceRepository.get()
    if (current && Date.parse(current.expiresAt) > Date.now()) {
      try { await locationClient.deletePresence(current) }
      catch (error) {
        // Already invalid/expired credentials cannot be retained or reused.
        if (!(error instanceof ApiError && (error.invalidPresence || error.status === 404 || error.status === 410))) throw error
      }
    }
    await db.transaction('rw', db.presences, db.preferences, async () => {
      await db.presences.delete('current')
      await db.preferences.put({ key: 'discovery', stopped: true })
    })
  }),
}
