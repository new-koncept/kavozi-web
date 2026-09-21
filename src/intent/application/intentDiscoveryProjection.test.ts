import { describe, expect, it } from 'vitest'
import { diveTemplate, fixtureIntent } from '../../test/intentFixtures'
import { metadata } from '../../test/fixtures'
import type { Intent, IntentFieldValue } from '../model/Intent'
import { intentsForOffer } from '../model/Intent'
import type { Template } from '../api/intentTemplateClient'
import { compileActiveDiscoveryProjections, compileDiscoveryProjection } from './intentDiscoveryProjection'

const template: Template = { ...diveTemplate, fields: [
  ...diveTemplate.fields!,
  { key: 'range', type: 'RANGE', roles: ['CLAIM'], constraints: { kind: 'RANGE', min: 0, max: 100 } },
  { key: 'choice', type: 'CODE', roles: ['CLAIM', 'REQUIREMENT'], operators: ['IN'], constraints: { kind: 'CODE', options: [{ value: 'x', label: 'Visible label' }] } },
] }
const compile = (claims: Record<string, IntentFieldValue>) => compileDiscoveryProjection(fixtureIntent({ claims }), template, metadata)
describe('minimal typed discovery compilation', () => {
  it('preserves stable ID and radius, with empty optional claims and zero requirements', () => {
    const intent = fixtureIntent()
    expect(compileDiscoveryProjection(intent, template, metadata)).toEqual({ id: intent.discoveryProjectionId, geography: { type: 'RADIUS', radiusMeters: 5000 }, claims: {}, requirements: [] })
    expect(compileDiscoveryProjection({ ...intent, title: 'Edited locally' }, template, metadata).id).toBe(intent.discoveryProjectionId)
  })
  it('omits an empty optional text claim without dropping false or zero', () => {
    expect(compile({ note: { type: 'TEXT', value: '' }, insured: { type: 'BOOLEAN', value: false }, experience: { type: 'NUMBER', value: 0 } }).claims).toEqual({ insured: { type: 'BOOLEAN', value: false }, experience: { type: 'NUMBER', value: 0 } })
  })
  it('sends only the administrative UUID, never the display name or category', () => {
    const id = crypto.randomUUID()
    const intent = fixtureIntent({ geography: { type: 'ADMINISTRATIVE_AREA', administrativeAreaId: id, displayName: 'Bratislava', administrativeAreaType: 'CITY' } })
    expect(compileDiscoveryProjection(intent, template, metadata).geography).toEqual({ type: 'ADMINISTRATIVE_AREA', administrativeAreaId: id })
  })
  it.each<[string, IntentFieldValue, unknown]>([
    ['insured', { type: 'BOOLEAN', value: false }, { type: 'BOOLEAN', value: false }],
    ['experience', { type: 'NUMBER', value: 120 }, { type: 'NUMBER', value: 120 }],
    ['certification', { type: 'CODE', value: 'AOW' }, { type: 'CODE', value: 'AOW' }],
    ['note', { type: 'TEXT', value: 'Careful diver' }, { type: 'TEXT', value: 'Careful diver' }],
    ['languages', { type: 'SET', elementType: 'CODE', values: ['en', 'cs'] }, { type: 'SET', valueType: 'CODE', values: [{ type: 'CODE', value: 'en' }, { type: 'CODE', value: 'cs' }] }],
    ['range', { type: 'RANGE', lower: 5, upper: 10 }, { type: 'RANGE', lower: 5, upper: 10 }],
  ])('compiles populated %s with exact discriminator and payload', (key, value, expected) => {
    expect(compile({ [key]: value }).claims).toEqual({ [key]: expected })
  })
  it.each(['BOOLEAN', 'NUMBER', 'TEXT'] as const)('wraps SET<%s> items as typed scalar values', (type) => {
    const values = type === 'BOOLEAN' ? [false, true] : type === 'NUMBER' ? [0, 12] : ['hello', 'world']
    const definition: Template = { ...template, fields: [{ key: 'items', type: 'SET', roles: ['CLAIM'], constraints: { kind: 'SET', elementType: type } }] }
    const result = compileDiscoveryProjection(fixtureIntent({ claims: { items: { type: 'SET', elementType: type, values } } }), definition, metadata)
    expect(result.claims?.items).toEqual({ type: 'SET', valueType: type, values: values.map((value) => ({ type, value })) })
  })
  it('compiles GTE, INTERSECTS and CODE IN requirements using unchanged field keys', () => {
    const intent = fixtureIntent({ claims: { experience: { type: 'NUMBER', value: 120 } }, requirements: [
      { id: 'local1', fieldKey: 'experience', operator: 'GTE', value: { type: 'NUMBER', value: 20 } },
      { id: 'local2', fieldKey: 'languages', operator: 'INTERSECTS', value: { type: 'SET', elementType: 'CODE', values: ['en'] } },
      { id: 'local3', fieldKey: 'choice', operator: 'IN', value: { type: 'SET', elementType: 'CODE', values: ['x'] } },
    ] })
    expect(compileDiscoveryProjection(intent, template, metadata).requirements).toEqual([
      { field: 'experience', operator: 'GTE', value: { type: 'NUMBER', value: 20 } },
      { field: 'languages', operator: 'INTERSECTS', value: { type: 'SET', valueType: 'CODE', values: [{ type: 'CODE', value: 'en' }] } },
      { field: 'choice', operator: 'IN', value: { type: 'SET', valueType: 'CODE', values: [{ type: 'CODE', value: 'x' }] } },
    ])
  })
  it('never includes preferences, agent instruction, title, template key, encounter options or local predicate IDs', () => {
    const intent = fixtureIntent({ title: 'Secret title', preferences: [{ id: 'secret', fieldKey: 'unknown', operator: 'EQ' }], encounterOptions: { depth: { type: 'RANGE', lower: 10, upper: 20 } } })
    const result = compileDiscoveryProjection(intent, template, metadata)
    expect(Object.keys(result).sort()).toEqual(['claims', 'geography', 'id', 'requirements'])
    expect(JSON.stringify(result)).not.toMatch(/preferences|agentInstruction|title|templateKey|encounterOptions|secret|patient|depth/)
  })
  it.each<Partial<Intent>>([
    { claims: { experience: { type: 'NUMBER', value: -1 } } },
    { claims: { range: { type: 'RANGE', lower: 10, upper: 5 } } },
    { requirements: [{ id: 'x', fieldKey: 'experience', operator: 'INTERSECTS', value: { type: 'NUMBER', value: 1 } }] },
  ])('rejects invalid values and unsupported operator combinations', (data) => {
    expect(() => compileDiscoveryProjection(fixtureIntent(structuredClone(data)), template, metadata)).toThrow(/review/)
  })
  it.each(['INSTANT', 'REFERENCE'] as const)('preserves local SET<%s> but refuses to invent a discovery encoding', (type) => {
    const value = type === 'INSTANT' ? '2026-09-20T10:00:00Z' : 'ref'
    const definition: Template = { ...template, fields: [{ key: 'items', type: 'SET', roles: ['CLAIM'], constraints: { kind: 'SET', elementType: type, options: [{ value }] } }] }
    const intent = fixtureIntent({ claims: { items: { type: 'SET', elementType: type, values: [value] } } })
    const original = structuredClone(intent)
    expect(() => compileDiscoveryProjection(intent, definition, metadata)).toThrow('cannot use this kind of list')
    expect(intent).toEqual(original)
  })
  it('enforces backend claim, requirement, set, text and UTF-8 request byte limits', () => {
    const intent = fixtureIntent({ claims: { note: { type: 'TEXT', value: 'héllo' }, languages: { type: 'SET', elementType: 'CODE', values: ['en', 'cs'] } }, requirements: [{ id: 'r', fieldKey: 'experience', operator: 'GTE', value: { type: 'NUMBER', value: 20 } }] })
    for (const limit of [{ maxClaimsPerProjection: 1 }, { maxRequirementsPerProjection: 0 }, { maxSetItems: 1 }, { maxTextLength: 4 }, { maxProjectionRequestBytes: 10 }])
      expect(() => compileDiscoveryProjection(intent, template, { ...metadata, ...limit })).toThrow()
    const body = JSON.stringify({ projections: [compileDiscoveryProjection(intent, template, metadata)] })
    expect(() => compileDiscoveryProjection(intent, template, { ...metadata, maxProjectionRequestBytes: body.length })).toThrow('request limit')
  })
  it('compiles only active intents, enforces aggregate size, uniqueness and current template availability', () => {
    const one = fixtureIntent({ active: true }), two = fixtureIntent({ active: true }), inactive = fixtureIntent()
    const templates = new Map([['dive', template]])
    expect(compileActiveDiscoveryProjections([one, two, inactive], templates, metadata)).toHaveLength(2)
    expect(compileActiveDiscoveryProjections([], templates, metadata)).toEqual([])
    expect(() => compileActiveDiscoveryProjections([one, two], templates, { ...metadata, maxDiscoveryProjections: 1 })).toThrow()
    expect(() => compileActiveDiscoveryProjections([one, { ...two, discoveryProjectionId: one.discoveryProjectionId }], templates, metadata)).toThrow('unique')
    expect(() => compileActiveDiscoveryProjections([one], new Map(), metadata)).toThrow('unavailable')
    const oneSize = new TextEncoder().encode(JSON.stringify({ projections: [compileDiscoveryProjection(one, template, metadata)] })).length
    expect(() => compileActiveDiscoveryProjections([one, two], templates, { ...metadata, maxProjectionRequestBytes: oneSize })).toThrow('request limit')
  })
  it('maps one/multiple/unknown local projection IDs only to saved local intents', () => {
    const one = fixtureIntent(), two = fixtureIntent()
    expect(intentsForOffer([one.discoveryProjectionId], [one, two])).toEqual([one])
    expect(intentsForOffer([one.discoveryProjectionId, two.discoveryProjectionId, 'unknown'], [one, two])).toEqual([one, two])
    expect(intentsForOffer(['unknown'], [one, two])).toEqual([])
  })
})
