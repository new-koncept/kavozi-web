import type { components } from '../../api/generated/schema'
import type { LocationMetadata } from '../../location/application/metadata'
import type { Template, TemplateField } from '../api/intentTemplateClient'
import type { Intent, IntentFieldValue } from '../model/Intent'
import { validateIntent } from './intentValidator'

type Schema = components['schemas']
export class ProjectionError extends Error {
  readonly intentId?: string
  constructor(message: string, intentId?: string) { super(message); this.name = 'ProjectionError'; this.intentId = intentId }
}

/** Exact template keys identify both claims and requirement targets; labels never cross this boundary. */
function fieldIdentity(field: TemplateField): string {
  if (!field.key?.trim()) throw new ProjectionError('Review this intent: a field definition is unavailable.')
  return field.key
}
function scalar(type: string, value: string | number | boolean, metadata: LocationMetadata): Schema['ScalarValue'] {
  switch (type) {
    case 'BOOLEAN': if (typeof value === 'boolean') return { type, value }; break
    case 'NUMBER': if (typeof value === 'number' && Number.isFinite(value)) return { type, value }; break
    case 'CODE':
    case 'TEXT':
      if (typeof value === 'string' && value.length <= metadata.maxTextLength) return { type, value }
      break
  }
  throw new ProjectionError('Review this intent: a value is unsupported or exceeds the discovery text limit.')
}
function compileValue(value: IntentFieldValue, metadata: LocationMetadata): Schema['DiscoveryValue'] {
  switch (value.type) {
    case 'BOOLEAN': case 'NUMBER': case 'CODE': case 'TEXT': return scalar(value.type, value.value, metadata)
    case 'SET': {
      const valueType = value.elementType
      if (valueType === 'INSTANT' || valueType === 'REFERENCE') throw new ProjectionError('Review this intent: discovery cannot use this kind of list yet. Your saved values are preserved.')
      if (value.values.length > metadata.maxSetItems) throw new ProjectionError(`Review this intent: discovery allows up to ${metadata.maxSetItems} items in a list.`)
      return { type: 'SET', valueType, values: value.values.map((item) => scalar(valueType, item, metadata)) }
    }
    case 'RANGE':
      if (value.lower === undefined || value.upper === undefined || !Number.isFinite(value.lower) || !Number.isFinite(value.upper) || value.lower > value.upper)
        throw new ProjectionError('Review this intent: enter a valid lower and upper bound.')
      return { type: 'RANGE', lower: value.lower, upper: value.upper }
  }
}

/** Privacy allowlist: construct fresh transport objects, never spread an Intent or its values. */
export function compileDiscoveryProjection(intent: Intent, template: Template, metadata: LocationMetadata): Schema['DiscoveryProjectionRequest'] {
  const fields = new Map((template.fields ?? []).map((field) => [field.key, field]))
  const populatedClaims = Object.fromEntries(Object.entries(intent.claims).filter(([key, value]) => {
    const field = fields.get(key)
    return value !== undefined && !(value.type === 'TEXT' && value.value === '' && field?.roles?.includes('CLAIM') && !field.required)
  }))
  const validation = validateIntent({ ...intent, claims: populatedClaims }, template, metadata)
  if (!validation.valid) throw new ProjectionError(`This intent needs review before activation. ${validation.issues.find((issue) => !issue.warning)?.message ?? ''}`, intent.id)
  const geography = intent.geography!
  try {
    const claims: NonNullable<Schema['DiscoveryProjectionRequest']['claims']> = Object.fromEntries(
      Object.entries(populatedClaims).map(([key, value]) => [fieldIdentity(fields.get(key)!), compileValue(value, metadata)]))
    const requirements: Schema['HardRequirementRequest'][] = intent.requirements.map((requirement) => ({
      field: fieldIdentity(fields.get(requirement.fieldKey)!), operator: requirement.operator, value: compileValue(requirement.value!, metadata),
    }))
    if (Object.keys(claims).length > metadata.maxClaimsPerProjection) throw new ProjectionError(`Review this intent: discovery allows up to ${metadata.maxClaimsPerProjection} claims.`)
    if (requirements.length > metadata.maxRequirementsPerProjection) throw new ProjectionError(`Review this intent: discovery allows up to ${metadata.maxRequirementsPerProjection} hard requirements.`)
    const projection: Schema['DiscoveryProjectionRequest'] = {
      id: intent.discoveryProjectionId,
      geography: geography.type === 'RADIUS' ? { type: 'RADIUS', radiusMeters: geography.radiusMeters }
        : { type: 'ADMINISTRATIVE_AREA', administrativeAreaId: geography.administrativeAreaId },
      claims, requirements,
    }
    checkRequestSize([projection], metadata)
    return projection
  } catch (error) {
    if (error instanceof ProjectionError) throw new ProjectionError(error.message, intent.id)
    throw error
  }
}
function checkRequestSize(projections: Schema['DiscoveryProjectionRequest'][], metadata: LocationMetadata) {
  const body: Schema['DiscoveryProjectionsRequest'] = { projections }
  if (new TextEncoder().encode(JSON.stringify(body)).byteLength > metadata.maxProjectionRequestBytes)
    throw new ProjectionError('Your active intents exceed the discovery request limit. Reduce their claims or requirements.')
}
export function compileActiveDiscoveryProjections(intents: Intent[], templates: ReadonlyMap<string, Template>, metadata: LocationMetadata): Schema['DiscoveryProjectionRequest'][] {
  const active = intents.filter((intent) => intent.active)
  if (active.length > metadata.maxDiscoveryProjections) throw new ProjectionError(`You can activate up to ${metadata.maxDiscoveryProjections} intents.`)
  if (new Set(active.map((intent) => intent.discoveryProjectionId)).size !== active.length) throw new ProjectionError('Review your intents: local discovery identifiers must be unique.')
  const projections = active.map((intent) => {
    const template = templates.get(intent.templateKey)
    if (!template) throw new ProjectionError('Current templates are unavailable. Review this intent before activating it.', intent.id)
    return compileDiscoveryProjection(intent, template, metadata)
  })
  checkRequestSize(projections, metadata)
  return projections
}
export function discoveryReview(intent: Intent, template: Template, metadata: LocationMetadata): string | undefined {
  try { compileDiscoveryProjection(intent, template, metadata) }
  catch (error) { return error instanceof ProjectionError ? error.message : 'Review this intent before activating it.' }
}
