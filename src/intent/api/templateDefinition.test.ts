import { expect, it } from 'vitest'
import { diveTemplate } from '../../test/intentFixtures'
import { usableTemplate } from './templateDefinition'

it('accepts the supported vocabulary and rejects inconsistent runtime definitions', () => {
  expect(usableTemplate(diveTemplate, 'dive')).toBe(true)
  const changed = structuredClone(diveTemplate)
  changed.fields![0].constraints = { kind: 'TEXT' }
  expect(usableTemplate(changed, 'dive')).toBe(false)
  changed.fields![0].constraints = { kind: 'NUMBER', step: -1 }
  expect(usableTemplate(changed, 'dive')).toBe(false)
  changed.fields![0].constraints = { kind: 'NUMBER', min: 10, max: 1 }
  expect(usableTemplate(changed, 'dive')).toBe(false)
  expect(usableTemplate({ ...diveTemplate, fields: undefined }, 'dive')).toBe(false)
  expect(usableTemplate(diveTemplate, 'different-key')).toBe(false)
})
it('rejects duplicate keys, malformed options, and invalid agent limits', () => {
  expect(usableTemplate({ ...diveTemplate, fields: [diveTemplate.fields![0], diveTemplate.fields![0]] }, 'dive')).toBe(false)
  const changed = structuredClone(diveTemplate)
  changed.fields![1].constraints = { kind: 'CODE', options: [{ value: 'x' }, { value: 'x' }] }
  expect(usableTemplate(changed, 'dive')).toBe(false)
  expect(usableTemplate({ ...diveTemplate, agentConfiguration: { enabled: true, maxLength: -1 } }, 'dive')).toBe(false)
})
it('requires orderedValues to be a complete, unique ordering of CODE options', () => {
  for (const orderedValues of [['OW'], ['OW', 'OW'], ['OW', 'unknown'], [1, 'AOW']] as unknown[][]) {
    const changed = structuredClone(diveTemplate)
    const constraints = changed.fields![1].constraints
    if (constraints?.kind === 'CODE') constraints.orderedValues = orderedValues as string[]
    expect(usableTemplate(changed, 'dive')).toBe(false)
  }
})
it('accepts null orderedValues as an explicitly unordered CODE field', () => {
  const changed = structuredClone(diveTemplate)
  const constraints = changed.fields![1].constraints
  if (constraints?.kind === 'CODE') constraints.orderedValues = null
  expect(usableTemplate(changed, 'dive')).toBe(true)
})
