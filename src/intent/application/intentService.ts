import { ApiError, locationClient, type Schema } from '../../api/locationClient'
import { withPresenceLock } from '../../location/application/browserLock'
import type { LocationMetadata } from '../../location/application/metadata'
import { db, presenceRepository } from '../../location/persistence/db'
import { intentTemplateClient, type Template } from '../api/intentTemplateClient'
import type { Intent } from '../model/Intent'
import { compileActiveDiscoveryProjections, compileDiscoveryProjection, ProjectionError } from './intentDiscoveryProjection'
import { validateIntent } from './intentValidator'

export class IntentError extends Error {}
const stamp = () => new Date().toISOString()

async function replace(projections: Schema['DiscoveryProjectionRequest'][]) {
  const presence = await presenceRepository.get()
  if (!presence || !(Date.parse(presence.expiresAt) > Date.now())) throw new IntentError('Start discovery before changing active intents.')
  try {
    const response = await locationClient.replaceDiscoveryProjections(presence, { projections })
    if (response.status !== 'RECORDED') throw new ApiError(502)
  } catch (error) {
    if (error instanceof ApiError && [400, 413, 422].includes(error.status))
      throw new IntentError('Review your active intents: discovery could not accept their values, requirements, or size. Your saved configuration has not changed.')
    throw error
  }
}
async function templatesFor(intents: Intent[]) {
  const templates = new Map<string, Template>()
  for (const key of new Set(intents.filter((intent) => intent.active).map((intent) => intent.templateKey))) templates.set(key, await intentTemplateClient.get(key))
  return templates
}
async function sync(metadata: LocationMetadata) {
  if (!(await presenceRepository.get())) return [] as Intent[]
  const intents = await db.intents.toArray()
  const templates = new Map<string, Template>()
  const invalid = new Set<string>()
  for (const intent of intents.filter((item) => item.active)) {
    try {
      const template = templates.get(intent.templateKey) ?? await intentTemplateClient.get(intent.templateKey)
      templates.set(intent.templateKey, template)
      compileDiscoveryProjection(intent, template, metadata)
    } catch (error) {
      if (error instanceof ProjectionError || (error instanceof ApiError && error.status === 404)) invalid.add(intent.id)
      else {
        await replace([])
        throw new IntentError('Current templates are unavailable. Discovery is suspended; your intents are preserved.')
      }
    }
  }
  const desired = intents.map((intent) => invalid.has(intent.id) ? { ...intent, active: false, updatedAt: stamp() } : intent)
  let projections: Schema['DiscoveryProjectionRequest'][]
  try { projections = compileActiveDiscoveryProjections(desired, templates, metadata) }
  catch (error) { await replace([]); throw error }
  await replace(projections)
  // Changed templates withdraw entire incompatible intents, never individual requirements.
  if (invalid.size) await db.intents.bulkPut(desired.filter((intent) => invalid.has(intent.id)))
  return desired.filter((intent) => intent.active)
}

/** Serialized replacement before commit: failed requests leave the prior local choice intact. */
async function commitActiveChange(previous: Intent[], desired: Intent[], metadata: LocationMetadata, commit: () => Promise<unknown>) {
  const templates = await templatesFor(desired)
  const projections = compileActiveDiscoveryProjections(desired, templates, metadata)
  // A stopped device has no remote Presence to update; retain local editing/deletion behavior.
  if (!(await presenceRepository.get())) { await commit(); return }
  await replace(projections)
  try { await commit() }
  catch (error) {
    // IndexedDB can fail after a successful PUT. Restore the last saved remote configuration.
    try { await replace(compileActiveDiscoveryProjections(previous, await templatesFor(previous), metadata)) }
    catch { await replace([]) }
    throw error
  }
}
export const intentService = {
  synchronize: (metadata: LocationMetadata) => withPresenceLock(() => sync(metadata)),
  save: (intent: Intent, metadata: LocationMetadata) => withPresenceLock(async () => {
    const template = await intentTemplateClient.get(intent.templateKey)
    const validation = validateIntent(intent, template, metadata)
    if (!validation.valid) throw new IntentError(validation.issues.filter((issue) => !issue.warning).map((issue) => issue.message).join(' '))
    const previous = await db.intents.toArray()
    const existing = previous.find((item) => item.id === intent.id)
    if (existing?.pendingDeletion) throw new IntentError('Finish the pending deletion first.')
    const saved: Intent = { ...intent, active: existing?.active ?? false,
      discoveryProjectionId: existing?.discoveryProjectionId ?? intent.discoveryProjectionId,
      createdAt: existing?.createdAt ?? intent.createdAt, updatedAt: stamp() }
    if (saved.active) await commitActiveChange(previous, previous.map((item) => item.id === saved.id ? saved : item), metadata, () => db.intents.put(saved))
    else await db.intents.put(saved)
  }),
  setActive: (id: string, active: boolean, metadata: LocationMetadata) => withPresenceLock(async () => {
    const previous = await db.intents.toArray()
    const intent = previous.find((item) => item.id === id)
    if (!intent) throw new IntentError('This intent no longer exists.')
    if (active && !(await presenceRepository.get())) throw new IntentError('Start discovery before activating an intent.')
    if (active && intent.pendingDeletion) throw new IntentError('Finish deleting this intent before activating it.')
    const changed = { ...intent, active, updatedAt: stamp() }
    await commitActiveChange(previous, previous.map((item) => item.id === id ? changed : item), metadata, () => db.intents.put(changed))
  }),
  delete: (id: string, metadata: LocationMetadata, confirmedActive = false) => withPresenceLock(async () => {
    const previous = await db.intents.toArray()
    const intent = previous.find((item) => item.id === id)
    if (!intent) return
    if (intent.active && !confirmedActive) throw new IntentError('Confirm deletion of this active intent first.')
    if (intent.active || intent.pendingDeletion) await commitActiveChange(previous, previous.filter((item) => item.id !== id), metadata, () => db.intents.delete(id))
    else await db.intents.delete(id)
  }),
}
