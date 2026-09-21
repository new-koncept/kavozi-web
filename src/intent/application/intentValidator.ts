import type { Constraints, Template, TemplateField } from '../api/intentTemplateClient'
import type { Intent, IntentFieldValue, IntentOperator } from '../model/Intent'
import type { LocationMetadata } from '../../location/application/metadata'
import { fieldEditorConstraints, supportsEditor } from './fieldSemantics'

export interface ValidationIssue { path: string; message: string; warning: boolean }
export const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

function numberErrors(value: number, c: { min?: number; max?: number; step?: number }) {
  const errors: string[] = []
  if (!Number.isFinite(value)) return ['Enter a finite number.']
  if (c.min !== undefined && value < c.min) errors.push(`Minimum is ${c.min}.`)
  if (c.max !== undefined && value > c.max) errors.push(`Maximum is ${c.max}.`)
  if (c.step !== undefined) {
    const steps = (value - (c.min ?? 0)) / c.step
    if (c.step <= 0 || !Number.isFinite(steps) || Math.abs(steps - Math.round(steps)) > 1e-7) errors.push(`Use increments of ${c.step}.`)
  }
  return errors
}

export function validateValue(value: IntentFieldValue | undefined, constraints: Constraints | undefined): string[] {
  if (!constraints || !supportsEditor(constraints)) return ['This field definition cannot currently be represented.']
  if (!value) return ['Choose a value.']
  if (value.type !== constraints.kind) return ['The field type changed. Review or remove the saved value.']
  switch (constraints.kind) {
    case 'BOOLEAN': return value.type === 'BOOLEAN' && typeof value.value === 'boolean' ? [] : ['Choose yes or no.']
    case 'NUMBER': return value.type === 'NUMBER' ? numberErrors(value.value, constraints) : ['Enter a number.']
    case 'CODE': return value.type === 'CODE' && constraints.options?.some((option) => option.value === value.value) ? [] : ['This option is no longer available.']
    case 'TEXT': {
      if (value.type !== 'TEXT' || typeof value.value !== 'string') return ['Enter text.']
      const errors: string[] = []
      if (value.value.length < (constraints.minLength ?? 0)) errors.push(`Use at least ${constraints.minLength} characters.`)
      if (constraints.maxLength !== undefined && value.value.length > constraints.maxLength) errors.push(`Use at most ${constraints.maxLength} characters.`)
      return errors
    }
    case 'RANGE': {
      if (value.type !== 'RANGE' || value.lower === undefined || value.upper === undefined) return ['Enter both range bounds.']
      return [...numberErrors(value.lower, constraints), ...numberErrors(value.upper, constraints),
        ...(value.lower > value.upper ? ['Lower bound must not exceed upper bound.'] : [])]
    }
    case 'SET': {
      if (value.type !== 'SET' || value.elementType !== constraints.elementType || !Array.isArray(value.values)) return ['The set element type changed. Review the saved values.']
      const errors: string[] = []
      if (value.values.length < (constraints.minItems ?? 0)) errors.push(`Choose at least ${constraints.minItems} items.`)
      if (constraints.maxItems !== undefined && value.values.length > constraints.maxItems) errors.push(`Choose at most ${constraints.maxItems} items.`)
      if (new Set(value.values).size !== value.values.length) errors.push('Remove duplicate items.')
      for (const item of value.values) {
        if (constraints.elementType === 'NUMBER' && (typeof item !== 'number' || !Number.isFinite(item))) errors.push('Items must be numbers.')
        if (constraints.elementType === 'BOOLEAN' && typeof item !== 'boolean') errors.push('Items must be yes or no.')
        if (['TEXT', 'CODE', 'INSTANT', 'REFERENCE'].includes(constraints.elementType ?? '') && (typeof item !== 'string' || !item.trim())) errors.push('Items must be non-empty values.')
        if (constraints.elementType === 'INSTANT' && (typeof item !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(item) || !Number.isFinite(Date.parse(item)))) errors.push('Enter a date and time with a timezone.')
        if ((constraints.elementType === 'CODE' || constraints.elementType === 'REFERENCE') && !constraints.options?.some((option) => option.value === item)) errors.push('A selected option is no longer available.')
      }
      return [...new Set(errors)]
    }
  }
}

export function validatePredicateValue(field: TemplateField, operator: IntentOperator, value?: IntentFieldValue) {
  if (!field.operators?.includes(operator)) return ['The selected comparison is no longer permitted.']
  const errors = validateValue(value, fieldEditorConstraints(field, operator))
  // IN operands are sets but every element must still satisfy the scalar field constraints.
  if ((operator === 'IN' || operator === 'NOT_IN') && value?.type === 'SET' && field.constraints) {
    for (const item of value.values) {
      const c = field.constraints
      if (c.kind === 'NUMBER' && typeof item === 'number') errors.push(...validateValue({ type: 'NUMBER', value: item }, c))
      if (c.kind === 'TEXT' && typeof item === 'string') errors.push(...validateValue({ type: 'TEXT', value: item }, c))
    }
  }
  return errors
}

export function validateIntent(intent: Intent, template: Template | undefined, metadata: LocationMetadata) {
  const issues: ValidationIssue[] = []
  const add = (path: string, message: string, warning = false) => issues.push({ path, message, warning })
  if (!intent.title.trim()) add('title', 'Give your intent a title.')
  if (!isUuid(intent.discoveryProjectionId)) add('geography', 'The local discovery identifier is invalid.')
  const g = intent.geography
  if (!g) add('geography', 'Choose where you are open to discovery.')
  else if (!metadata.supportedGeographyTypes.includes(g.type)) add('geography', 'This geography is not currently supported.')
  else if (g.type === 'RADIUS') numberErrors(g.radiusMeters, { min: metadata.minRadiusMeters, max: metadata.maxRadiusMeters }).forEach((e) => add('geography', e))
  else if (!isUuid(g.administrativeAreaId) || !g.displayName || !['CITY', 'DISTRICT'].includes(g.administrativeAreaType)) add('geography', 'Select a valid city or district again.')
  if (!template || template.key !== intent.templateKey || !Array.isArray(template.fields)) {
    add('template', 'The current template is unavailable. Your saved data is preserved.')
    return { issues, valid: false, needsReview: true }
  }
  const fields = new Map(template.fields.filter((field) => field.key).map((field) => [field.key!, field]))
  if (fields.size !== template.fields.length) add('template', 'The template contains missing or duplicate field keys.')
  for (const [role, values, prefix] of [['CLAIM', intent.claims, 'claims'], ['ENCOUNTER_OPTION', intent.encounterOptions, 'encounterOptions']] as const) {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) continue
      const field = fields.get(key)
      if (!field?.roles?.includes(role)) add(`${prefix}.${key}`, 'This field or its role is no longer available. Remove it explicitly to continue.')
      else validateValue(value, fieldEditorConstraints(field)).forEach((e) => add(`${prefix}.${key}`, e))
    }
    for (const field of fields.values()) {
      if (field.required && field.roles?.includes(role) && !values[field.key!]) add(`${prefix}.${field.key}`, `${field.label ?? field.key} is required.`)
    }
  }
  for (const [role, predicates, prefix] of [['REQUIREMENT', intent.requirements, 'requirements'], ['PREFERENCE', intent.preferences, 'preferences']] as const) {
    for (const predicate of predicates) {
      const field = fields.get(predicate.fieldKey)
      if (!field?.roles?.includes(role)) add(`${prefix}.${predicate.id}`, 'This field or role is no longer available.', role === 'PREFERENCE')
      else validatePredicateValue(field, predicate.operator, predicate.value).forEach((e) => add(`${prefix}.${predicate.id}`, e, role === 'PREFERENCE'))
    }
    for (const field of fields.values()) {
      if (field.required && field.roles?.includes(role) && !field.roles.includes('CLAIM') && !field.roles.includes('ENCOUNTER_OPTION')
        && !predicates.some((predicate) => predicate.fieldKey === field.key)) add(prefix, `${field.label ?? field.key} is required.`, role === 'PREFERENCE')
    }
  }
  const agent = template.agentConfiguration
  if (agent?.enabled) {
    if (agent.required && !intent.agentInstruction?.trim()) add('agentInstruction', 'Add your agent instruction.')
    if (agent.maxLength !== undefined && (intent.agentInstruction?.length ?? 0) > agent.maxLength) add('agentInstruction', `Use at most ${agent.maxLength} characters.`)
  } else if (intent.agentInstruction) add('agentInstruction', 'Agent instructions are no longer supported by this template. Remove the saved instruction to continue.')
  return { issues, valid: !issues.some((issue) => !issue.warning), needsReview: issues.some((issue) => !issue.warning) }
}
