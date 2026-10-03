import type { Constraints, TemplateField } from '../api/intentTemplateClient'
import type { IntentOperator } from '../model/Intent'

type CodeConstraints = Extract<Constraints, { kind: 'CODE' }>

export const operatorLabels: Record<IntentOperator, string> = {
  EQ: 'Is', NEQ: 'Is not', GT: 'More than', GTE: 'At least', LT: 'Less than', LTE: 'At most',
  IN: 'Is one of', NOT_IN: 'Is not one of', INTERSECTS: 'Has something in common with',
  CONTAINS_ALL: 'Includes all of', RANGE_INTERSECTS: 'Overlaps with',
}

function hasCompleteCodeOrdering(constraints: CodeConstraints) {
  const options = constraints.options
  const ordered = constraints.orderedValues
  if (!options?.length || !ordered || ordered.length !== options.length || new Set(ordered).size !== ordered.length) return false
  const values = new Set(options.map((option) => option.value))
  return ordered.every((value) => values.has(value))
}

export function codeOptions(constraints: CodeConstraints) {
  if (!hasCompleteCodeOrdering(constraints)) return constraints.options ?? []
  const byValue = new Map(constraints.options!.map((option) => [option.value, option]))
  return constraints.orderedValues!.flatMap((value) => {
    const option = byValue.get(value)
    return option ? [option] : []
  })
}

/** Operand shape is explicit; unsupported combinations are never coerced. */
export function fieldEditorConstraints(field: TemplateField, operator?: IntentOperator): Constraints | undefined {
  const constraints = field.constraints
  if (!field.type || !constraints || constraints.kind !== field.type) return undefined
  if (!operator) return constraints
  if (!field.operators?.includes(operator)) return undefined
  if (operator === 'IN' || operator === 'NOT_IN') {
    if (constraints.kind === 'SET' || constraints.kind === 'RANGE') return undefined
    return { kind: 'SET', elementType: constraints.kind, minItems: 1,
      ...(constraints.kind === 'CODE' ? { options: codeOptions(constraints) } : {}) }
  }
  if (operator === 'INTERSECTS' || operator === 'CONTAINS_ALL') return constraints.kind === 'SET' ? constraints : undefined
  if (operator === 'RANGE_INTERSECTS') return constraints.kind === 'RANGE' ? constraints : undefined
  if (['GT', 'GTE', 'LT', 'LTE'].includes(operator) && constraints.kind !== 'NUMBER'
    && !(constraints.kind === 'CODE' && hasCompleteCodeOrdering(constraints))) return undefined
  return constraints
}

export function supportsEditor(constraints?: Constraints) {
  if (!constraints) return false
  if (constraints.kind !== 'SET') return true
  return Boolean(constraints.elementType && (constraints.elementType !== 'REFERENCE' || constraints.options?.length))
}
