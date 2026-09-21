import { formatRadius } from '../../location/model/local'

// Local user-owned values. Tags preserve meaning when a template changes type.
export type ElementKind = 'BOOLEAN' | 'NUMBER' | 'CODE' | 'TEXT' | 'INSTANT' | 'REFERENCE'
export type IntentFieldValue =
  | { type: 'BOOLEAN'; value: boolean }
  | { type: 'NUMBER'; value: number }
  | { type: 'CODE' | 'TEXT'; value: string }
  | { type: 'SET'; elementType: ElementKind; values: (string | number | boolean)[] }
  | { type: 'RANGE'; lower?: number; upper?: number }

export type IntentOperator = 'EQ' | 'NEQ' | 'GT' | 'GTE' | 'LT' | 'LTE' | 'IN' | 'NOT_IN' | 'INTERSECTS' | 'CONTAINS_ALL' | 'RANGE_INTERSECTS'
export interface IntentPredicate { id: string; fieldKey: string; operator: IntentOperator; value?: IntentFieldValue }
export type IntentGeography =
  | { type: 'RADIUS'; radiusMeters: number }
  | { type: 'ADMINISTRATIVE_AREA'; administrativeAreaId: string; displayName: string; administrativeAreaType: 'CITY' | 'DISTRICT' }

export interface Intent {
  id: string
  templateKey: string
  title: string
  geography?: IntentGeography
  claims: Record<string, IntentFieldValue>
  requirements: IntentPredicate[]
  preferences: IntentPredicate[]
  encounterOptions: Record<string, IntentFieldValue>
  agentInstruction?: string
  pendingDeletion?: boolean
  active: boolean
  discoveryProjectionId: string
  createdAt: string
  updatedAt: string
}

export function newIntent(templateKey: string): Intent {
  const now = new Date().toISOString()
  return { id: crypto.randomUUID(), templateKey, title: '', claims: {}, requirements: [], preferences: [],
    encounterOptions: {}, active: false, discoveryProjectionId: crypto.randomUUID(), createdAt: now, updatedAt: now }
}

export function intentsForOffer(ids: readonly string[], intents: Intent[]) {
  return intents.filter((intent) => ids.includes(intent.discoveryProjectionId))
}

export function formatIntentValue(value: IntentFieldValue) {
  if (value.type === 'SET') return value.values.map(String).join(', ')
  if (value.type === 'RANGE') return `${value.lower ?? '…'} – ${value.upper ?? '…'}`
  if (value.type === 'BOOLEAN') return value.value ? 'Yes' : 'No'
  return String(value.value)
}

export function geographyLabel(geography?: IntentGeography) {
  return !geography ? 'Choose a geography' : geography.type === 'RADIUS' ? `${formatRadius(geography.radiusMeters)} around me` : geography.displayName
}
