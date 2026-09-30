import type { Schema } from '../../api/locationClient'
import { db, type LocationDatabase } from '../../location/persistence/db'

export type PendingMessage = {
  fingerprint: string
  encounterId: string
  senderParticipantId: string
  body: Schema['SendEncounterMessageRequest']
  serialized: string
  status: 'pending' | 'review'
}
export function outboxRepository(database: LocationDatabase = db) {
  return {
    get: (fingerprint: string, encounterId: string) => database.encounterOutbox.get([fingerprint, encounterId]),
    // Atomic unique key prevents another tab from overwriting an unresolved send.
    add: (pending: PendingMessage) => database.encounterOutbox.add(pending),
    put: (pending: PendingMessage) => database.transaction('rw', database.encounterOutbox, async () => {
      const current = await database.encounterOutbox.get([pending.fingerprint, pending.encounterId])
      if (current?.body.messageId === pending.body.messageId) await database.encounterOutbox.put(pending)
    }),
    remove: (fingerprint: string, encounterId: string, messageId?: string) => database.transaction('rw', database.encounterOutbox, async () => {
      const current = await database.encounterOutbox.get([fingerprint, encounterId])
      // A late acknowledgment in another tab must not remove a newer pending send.
      if (!messageId || current?.body.messageId === messageId) await database.encounterOutbox.delete([fingerprint, encounterId])
    }),
  }
}
