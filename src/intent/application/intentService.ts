import { ApiError, locationClient } from '../../api/locationClient'
import { withPresenceLock } from '../../location/application/browserLock'
import type { LocationMetadata } from '../../location/application/metadata'
import { db, presenceRepository } from '../../location/persistence/db'
import { intentTemplateClient } from '../api/intentTemplateClient'
import type { Intent } from '../model/Intent'
import { buildLocationDiscoveryAreas } from './intentDiscoveryProjection'
import { validateIntent } from './intentValidator'

export class IntentError extends Error {}
const stamp = () => new Date().toISOString()

async function sync(metadata: LocationMetadata) {
  const presence = await presenceRepository.get()
  if (!presence) return [] as Intent[]
  const intents = await db.intents.toArray()
  const active = intents.filter((intent) => intent.active)
  const eligible: Intent[] = []
  for (const intent of active) {
    try {
      const template = await intentTemplateClient.get(intent.templateKey)
      if (validateIntent(intent, template, metadata).valid) eligible.push(intent)
      else await db.intents.update(intent.id, { active: false, updatedAt: stamp() })
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) await db.intents.update(intent.id, { active: false, updatedAt: stamp() })
      else {
        // Do not leave unverified geography advertised when schemas cannot be resolved.
        const response = await locationClient.replaceDiscoveryAreas(presence, { areas: [] })
        if (response.status !== 'RECORDED') throw new ApiError(502)
        throw new IntentError('Current templates are unavailable. Discovery is suspended; your intents are preserved.')
      }
    }
  }
  if (eligible.length > metadata.maxDiscoveryAreas) {
    await locationClient.replaceDiscoveryAreas(presence, { areas: [] })
    throw new IntentError(`Only ${metadata.maxDiscoveryAreas} intents can be active. Turn some off to resume.`)
  }
  const areas = buildLocationDiscoveryAreas(eligible)
  const response = await locationClient.replaceDiscoveryAreas(presence, { areas })
  if (response.status !== 'RECORDED') throw new ApiError(502)
  return eligible
}

export const intentService = {
  synchronize: (metadata: LocationMetadata) => withPresenceLock(() => sync(metadata)),
  save: (intent: Intent, metadata: LocationMetadata) => withPresenceLock(async () => {
    const template = await intentTemplateClient.get(intent.templateKey)
    const validation = validateIntent(intent, template, metadata)
    if (!validation.valid) throw new IntentError(validation.issues.filter((issue) => !issue.warning).map((issue) => issue.message).join(' '))
    const existing = await db.intents.get(intent.id)
    if (existing?.pendingDeletion) throw new IntentError('Finish the pending deletion first.')
    const saved: Intent = { ...intent, active: existing?.active ?? false,
      discoveryAreaId: existing?.discoveryAreaId ?? intent.discoveryAreaId,
      createdAt: existing?.createdAt ?? intent.createdAt, updatedAt: stamp() }
    await db.intents.put(saved)
    if (saved.active) await sync(metadata)
  }),
  setActive: (id: string, active: boolean, metadata: LocationMetadata) => withPresenceLock(async () => {
    const intent = await db.intents.get(id)
    if (!intent) throw new IntentError('This intent no longer exists.')
    if (active && intent.pendingDeletion) throw new IntentError('Finish deleting this intent before activating it.')
    if (active) {
      if (!(await presenceRepository.get())) throw new IntentError('Start discovery before activating an intent.')
      const template = await intentTemplateClient.get(intent.templateKey)
      if (!validateIntent(intent, template, metadata).valid) throw new IntentError('This intent needs review before activation.')
      const count = (await db.intents.toArray()).filter((item) => item.active && item.id !== id).length
      if (count >= metadata.maxDiscoveryAreas) throw new IntentError(`You can activate up to ${metadata.maxDiscoveryAreas} intents.`)
    }
    await db.intents.update(id, { active, updatedAt: stamp() })
    await sync(metadata)
  }),
  delete: (id: string, metadata: LocationMetadata, confirmedActive = false) => withPresenceLock(async () => {
    const intent = await db.intents.get(id)
    if (!intent) return
    if (intent.active && !confirmedActive) throw new IntentError('Confirm deletion of this active intent first.')
    if (intent.active || intent.pendingDeletion) {
      await db.intents.update(id, { active: false, pendingDeletion: true, updatedAt: stamp() })
      await sync(metadata)
    }
    await db.intents.delete(id)
  }),
}
