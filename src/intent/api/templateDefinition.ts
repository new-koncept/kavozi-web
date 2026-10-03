import type { Template } from './intentTemplateClient'

/** Validate the executable parts of untrusted JSON; TS declarations are not runtime checks. */
export function usableTemplate(template: Template, expectedKey: string): boolean {
  if (!template || template.key !== expectedKey || typeof template.name !== 'string' || !template.name.trim() || !Array.isArray(template.fields)) return false
  const keys = new Set<string>()
  for (const field of template.fields) {
    if (!field || typeof field.key !== 'string' || !field.key || keys.has(field.key)) return false
    keys.add(field.key)
    if (!['BOOLEAN', 'NUMBER', 'CODE', 'TEXT', 'SET', 'RANGE'].includes(field.type ?? '') || !Array.isArray(field.roles)
      || !field.roles.every((role) => ['CLAIM', 'REQUIREMENT', 'PREFERENCE', 'ENCOUNTER_OPTION'].includes(role))) return false
    if (field.operators !== undefined && (!Array.isArray(field.operators) || !field.operators.every((operator) => ['EQ', 'NEQ', 'GT', 'GTE', 'LT', 'LTE', 'IN', 'NOT_IN', 'INTERSECTS', 'CONTAINS_ALL', 'RANGE_INTERSECTS'].includes(operator)))) return false
    if (field.required !== undefined && typeof field.required !== 'boolean') return false
    const c = field.constraints
    if (!c || c.kind !== field.type) return false
    if (c.kind === 'NUMBER' || c.kind === 'RANGE') {
      if ([c.min, c.max, c.step].some((n) => n !== undefined && (typeof n !== 'number' || !Number.isFinite(n)))) return false
      if (c.min !== undefined && c.max !== undefined && c.min > c.max) return false
      if (c.step !== undefined && c.step <= 0) return false
    }
    if (c.kind === 'CODE' || c.kind === 'SET') {
      if (c.options !== undefined && (!Array.isArray(c.options) || c.options.some((option) => !option || typeof option.value !== 'string'
        || (option.label !== undefined && typeof option.label !== 'string') || (option.order !== undefined && !Number.isFinite(option.order)))
        || new Set(c.options.map((o) => o.value)).size !== c.options.length)) return false
    }
    if (c.kind === 'CODE' && c.orderedValues != null) {
      if (!Array.isArray(c.orderedValues) || c.orderedValues.some((value) => typeof value !== 'string')
        || new Set(c.orderedValues).size !== c.orderedValues.length || !c.options
        || c.orderedValues.length !== c.options.length
        || c.orderedValues.some((value) => !c.options!.some((option) => option.value === value))) return false
    }
    if (c.kind === 'TEXT' || c.kind === 'SET') {
      const min = c.kind === 'TEXT' ? c.minLength : c.minItems
      const max = c.kind === 'TEXT' ? c.maxLength : c.maxItems
      if ([min, max].some((n) => n !== undefined && (!Number.isInteger(n) || n < 0))) return false
      if (min !== undefined && max !== undefined && min > max) return false
    }
    if (c.kind === 'SET' && !['BOOLEAN', 'NUMBER', 'CODE', 'TEXT', 'INSTANT', 'REFERENCE'].includes(c.elementType ?? '')) return false
  }
  const agent = template.agentConfiguration
  if (agent) {
    if ((agent.enabled !== undefined && typeof agent.enabled !== 'boolean') || (agent.required !== undefined && typeof agent.required !== 'boolean')) return false
    if (agent.maxLength !== undefined && (!Number.isInteger(agent.maxLength) || agent.maxLength < 0)) return false
    if (agent.label !== undefined && typeof agent.label !== 'string') return false
    if (agent.prompt !== undefined && typeof agent.prompt !== 'string') return false
  }
  return true
}
