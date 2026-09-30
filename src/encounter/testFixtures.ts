import type { Schema } from '../api/locationClient'
import type { EncounterMetadata } from './api/encounterClient'
import type { EncounterView } from './application/events'
export const roomId = '10000000-0000-4000-8000-000000000001'
export const selfId = '20000000-0000-4000-8000-000000000001'
export const otherId = '20000000-0000-4000-8000-000000000002'
export const encounterMetadata: EncounterMetadata = { signatureProfile: 'kavozi-node-http-v1', signatureAlgorithm: 'ed25519',
  signatureMaxAgeSeconds: 300, signatureFutureSkewSeconds: 30, maxMessagePayloadBytes: 16384, maxRequestBytes: 32768, pollAfterSeconds: 3 }
export const fixtureRoom: EncounterView = { encounterId: roomId, state: 'OPEN', membershipVersion: 2,
  self: { participantId: selfId, firstVisibleSequence: 1 }, participants: [{ participantId: selfId, state: 'ACTIVE' }, { participantId: otherId, state: 'ACTIVE' }] }
export const fixturePage: Schema['EncounterEventPage'] = { events: [], nextAfterSequence: 0, hasMore: false, pollAfterSeconds: 3, state: 'OPEN', membershipVersion: 2 }
