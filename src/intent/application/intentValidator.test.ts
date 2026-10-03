import { describe, expect, it } from 'vitest'
import { diveTemplate, fixtureIntent } from '../../test/intentFixtures'
import { metadata } from '../../test/fixtures'
import { codeOptions, fieldEditorConstraints, supportsEditor } from './fieldSemantics'
import { validateIntent, validatePredicateValue, validateValue } from './intentValidator'
import type { TemplateField } from '../api/intentTemplateClient'

const field = (key: string) => diveTemplate.fields!.find((f) => f.key === key)!
describe('generic template semantics and local validation', () => {
  it.each(['BOOLEAN', 'NUMBER', 'CODE', 'TEXT', 'SET', 'RANGE'] as const)('selects the generic %s editor from the discriminated constraints', (type) => {
    const definition = diveTemplate.fields!.find((f) => f.type === type)!
    expect(fieldEditorConstraints(definition)?.kind).toBe(type)
    expect(supportsEditor(fieldEditorConstraints(definition))).toBe(true)
  })
  it('validates NUMBER bounds and steps without coercing values', () => {
    const c = field('experience').constraints
    expect(validateValue({ type: 'NUMBER', value: -1 }, c)).not.toEqual([])
    expect(validateValue({ type: 'NUMBER', value: 10001 }, c)).not.toEqual([])
    expect(validateValue({ type: 'NUMBER', value: 1.5 }, c)).not.toEqual([])
    expect(validateValue({ type: 'NUMBER', value: 120 }, c)).toEqual([])
    expect(validateValue({ type: 'TEXT', value: '120' }, c)).not.toEqual([])
  })
  it('validates RANGE ordering, completeness, bounds and increments', () => {
    const c = field('depth').constraints
    expect(validateValue({ type: 'RANGE', lower: 20, upper: 10 }, c)).toContain('Lower bound must not exceed upper bound.')
    expect(validateValue({ type: 'RANGE', lower: 10 }, c)).not.toEqual([])
    expect(validateValue({ type: 'RANGE', lower: 10, upper: 45 }, c)).not.toEqual([])
    expect(validateValue({ type: 'RANGE', lower: 10, upper: 30 }, c)).toEqual([])
  })
  it('validates SET cardinality, element types, duplicates and CODE options', () => {
    const c = field('languages').constraints
    expect(validateValue({ type: 'SET', elementType: 'CODE', values: [] }, c)).not.toEqual([])
    expect(validateValue({ type: 'SET', elementType: 'CODE', values: ['en', 'cs', 'en', 'cs'] }, c)).not.toEqual([])
    expect(validateValue({ type: 'SET', elementType: 'CODE', values: ['missing'] }, c)).not.toEqual([])
    expect(validateValue({ type: 'SET', elementType: 'TEXT', values: ['en'] }, c)).not.toEqual([])
    expect(validateValue({ type: 'SET', elementType: 'CODE', values: ['en'] }, c)).toEqual([])
    expect(validateValue({ type: 'CODE', value: 'removed' }, field('certification').constraints)).not.toEqual([])
  })
  it('validates text length and explicit boolean values', () => {
    expect(validateValue({ type: 'TEXT', value: 'x' }, field('note').constraints)).not.toEqual([])
    expect(validateValue({ type: 'TEXT', value: 'xx' }, field('note').constraints)).toEqual([])
    expect(validateValue({ type: 'BOOLEAN', value: false }, field('insured').constraints)).toEqual([])
  })
  it('only permits supplied operators, preserves operand shape, and validates IN members', () => {
    expect(validatePredicateValue(field('experience'), 'INTERSECTS', { type: 'NUMBER', value: 1 })).not.toEqual([])
    expect(validatePredicateValue(field('experience'), 'IN', { type: 'SET', elementType: 'NUMBER', values: [-1] })).not.toEqual([])
    expect(validatePredicateValue(field('experience'), 'IN', { type: 'SET', elementType: 'NUMBER', values: [12, 15] })).toEqual([])
    expect(validatePredicateValue(field('languages'), 'INTERSECTS', { type: 'TEXT', value: 'en' })).not.toEqual([])
  })
  it('uses complete orderedValues metadata for ordered CODE comparisons', () => {
    const certification = field('certification')
    expect(fieldEditorConstraints(certification, 'GTE')?.kind).toBe('CODE')
    if (certification.constraints?.kind === 'CODE') expect(codeOptions(certification.constraints).map((option) => option.value)).toEqual(['OW', 'AOW'])
    const missing = structuredClone(certification)
    if (missing.constraints?.kind === 'CODE') missing.constraints.orderedValues = undefined
    expect(fieldEditorConstraints(missing, 'GTE')).toBeUndefined()
    const explicitlyUnordered = structuredClone(certification)
    if (explicitlyUnordered.constraints?.kind === 'CODE') explicitlyUnordered.constraints.orderedValues = null
    expect(fieldEditorConstraints(explicitlyUnordered, 'GTE')).toBeUndefined()
    const incomplete = structuredClone(certification)
    if (incomplete.constraints?.kind === 'CODE') incomplete.constraints.orderedValues = ['OW']
    expect(fieldEditorConstraints(incomplete, 'GTE')).toBeUndefined()
  })
  it('requires configured agent instruction and required claims, without defaulting missing optional values', () => {
    const intent = fixtureIntent({ agentInstruction: undefined })
    expect(validateIntent(intent, diveTemplate, metadata).valid).toBe(false)
    const required = structuredClone(diveTemplate)
    required.fields![0].required = true
    expect(validateIntent(fixtureIntent(), required, metadata).issues.some((i) => i.path === 'claims.experience')).toBe(true)
    expect(validateIntent(fixtureIntent(), diveTemplate, metadata).valid).toBe(true)
  })
  it.each(['removed', 'type', 'option', 'operator'] as const)('marks %s template changes for review and preserves local data', (change) => {
    const intent = fixtureIntent({ claims: { certification: { type: 'CODE', value: 'AOW' } }, requirements: [{ id: 'r', fieldKey: 'certification', operator: 'GTE', value: { type: 'CODE', value: 'AOW' } }] })
    const original = structuredClone(intent)
    const template = structuredClone(diveTemplate)
    const f = template.fields!.find((f) => f.key === 'certification')!
    if (change === 'removed') template.fields = template.fields!.filter((f) => f.key !== 'certification')
    if (change === 'type') { f.type = 'TEXT'; f.constraints = { kind: 'TEXT' } }
    if (change === 'option') f.constraints = { kind: 'CODE', options: [{ value: 'OW', label: 'Open Water' }], orderedValues: ['OW'] }
    if (change === 'operator') f.operators = ['EQ']
    expect(validateIntent(intent, template, metadata).needsReview).toBe(true)
    expect(intent).toEqual(original)
  })
  it('reports invalid preferences without preventing activation', () => {
    const intent = fixtureIntent({ preferences: [{ id: 'p', fieldKey: 'missing', operator: 'EQ', value: { type: 'TEXT', value: 'hello' } }] })
    const validation = validateIntent(intent, diveTemplate, metadata)
    expect(validation.valid).toBe(true)
    expect(validation.issues[0].warning).toBe(true)
  })
  it('blocks missing geography, invalid radius, invalid administrative IDs, and unsupported reference values', () => {
    expect(validateIntent(fixtureIntent({ geography: undefined }), diveTemplate, metadata).valid).toBe(false)
    expect(validateIntent(fixtureIntent({ geography: { type: 'RADIUS', radiusMeters: 1 } }), diveTemplate, metadata).valid).toBe(false)
    expect(validateIntent(fixtureIntent({ geography: { type: 'ADMINISTRATIVE_AREA', administrativeAreaId: 'missing', displayName: 'City', administrativeAreaType: 'CITY' } }), diveTemplate, metadata).valid).toBe(false)
    const reference: TemplateField = { type: 'SET', constraints: { kind: 'SET', elementType: 'REFERENCE' } }
    expect(supportsEditor(fieldEditorConstraints(reference))).toBe(false)
  })
})
