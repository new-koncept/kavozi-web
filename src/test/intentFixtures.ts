import type { Template } from '../intent/api/intentTemplateClient'
import { newIntent, type Intent } from '../intent/model/Intent'

export const diveTemplate: Template = {
  key: 'dive', name: 'Dive Buddy', description: 'Find a possibility for your next dive.', fields: [
    { key: 'experience', label: 'Completed dives', type: 'NUMBER', roles: ['CLAIM', 'REQUIREMENT'], operators: ['GTE', 'EQ', 'IN'], constraints: { kind: 'NUMBER', min: 0, max: 10000, step: 1, unit: 'dives' } },
    { key: 'certification', label: 'Certification', type: 'CODE', roles: ['CLAIM', 'REQUIREMENT'], operators: ['EQ', 'GTE'], constraints: { kind: 'CODE', options: [{ value: 'OW', label: 'Open Water', order: 0 }, { value: 'AOW', label: 'Advanced Open Water', order: 1 }] } },
    { key: 'languages', label: 'Languages', type: 'SET', roles: ['CLAIM', 'REQUIREMENT', 'PREFERENCE'], operators: ['INTERSECTS', 'CONTAINS_ALL'], constraints: { kind: 'SET', elementType: 'CODE', minItems: 1, maxItems: 3, options: [{ value: 'en', label: 'English' }, { value: 'cs', label: 'Czech' }] } },
    { key: 'insured', label: 'Insured', type: 'BOOLEAN', roles: ['CLAIM'], constraints: { kind: 'BOOLEAN' } },
    { key: 'note', label: 'A little about me', type: 'TEXT', roles: ['CLAIM'], constraints: { kind: 'TEXT', minLength: 2, maxLength: 100 } },
    { key: 'depth', label: 'Depth', type: 'RANGE', roles: ['ENCOUNTER_OPTION'], constraints: { kind: 'RANGE', min: 0, max: 40, step: 1, unit: 'm' } },
  ], agentConfiguration: { enabled: true, label: 'Your agent instruction', prompt: 'What would make someone a good diving buddy for you?', maxLength: 500, required: true },
}
export const coffeeTemplate: Template = {
  key: 'coffee', name: 'Coffee & Conversation', description: 'Make room for a conversation.', fields: [
    { key: 'topics', label: 'Topics', type: 'SET', roles: ['CLAIM'], constraints: { kind: 'SET', elementType: 'TEXT', maxItems: 5 } },
  ], agentConfiguration: { enabled: true, label: 'A note for your agent', prompt: 'What would you like to talk about?', maxLength: 300, required: false },
}
export function fixtureIntent(overrides: Partial<Intent> = {}): Intent {
  return { ...newIntent('dive'), title: 'Weekend diving', geography: { type: 'RADIUS', radiusMeters: 5000 }, agentInstruction: 'I enjoy patient, careful buddies.', ...overrides }
}
