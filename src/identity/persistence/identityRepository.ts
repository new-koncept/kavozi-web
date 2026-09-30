import type { LocationDatabase } from '../../location/persistence/db'
import { exportPublicKey, IdentityFailure, requireCrypto, timestamp, uuid, unsupportedCrypto } from '../application/crypto'

/** Internal storage model. Never expose this record (or its CryptoKeys) through React snapshots. */
export interface StoredNodeIdentity {
  slot: 'active' | 'candidate'
  schemaVersion: 1
  localIdentityId: string
  replacesIdentityId?: string | null
  status: 'LOCAL_ONLY' | 'REGISTERING' | 'REGISTERED'
  privateKey: CryptoKey
  publicKey: CryptoKey
  publicKeySpki: string
  localFingerprint: string
  nodeId?: string
  serverFingerprint?: string
  createdAt: string
  registeredAt?: string
}
export async function validateIdentity(record: StoredNodeIdentity) {
  const corrupt = () => new IdentityFailure('CORRUPT', 'Stored node identity is inconsistent. Retry, or explicitly regenerate it in Node identity settings. Your stored keys have been preserved.')
  try {
    if (record.schemaVersion !== 1 || !uuid(record.localIdentityId) || !timestamp(record.createdAt)
      || !['LOCAL_ONLY', 'REGISTERING', 'REGISTERED'].includes(record.status)
      || record.privateKey?.type !== 'private' || record.privateKey.extractable !== false
      || record.privateKey.algorithm.name !== 'Ed25519' || record.privateKey.usages.join() !== 'sign'
      || record.publicKey?.type !== 'public' || record.publicKey.extractable !== true
      || record.publicKey.algorithm.name !== 'Ed25519' || record.publicKey.usages.join() !== 'verify') throw corrupt()
    const exported = await exportPublicKey(record.publicKey)
    if (exported.publicKeySpki !== record.publicKeySpki || exported.localFingerprint !== record.localFingerprint) throw corrupt()
    // A real signing/verification operation checks that structured-cloned keys are usable and paired.
    const probe = crypto.getRandomValues(new Uint8Array(32))
    const signature = await requireCrypto().sign('Ed25519', record.privateKey, probe)
    if (!await requireCrypto().verify('Ed25519', record.publicKey, signature, probe)) throw corrupt()
    if (record.status === 'REGISTERED') {
      if (!uuid(record.nodeId) || record.serverFingerprint !== record.localFingerprint || !timestamp(record.registeredAt)) throw corrupt()
    } else if (record.nodeId !== undefined || record.serverFingerprint !== undefined || record.registeredAt !== undefined) throw corrupt()
    return record
  } catch (error) {
    if (error instanceof IdentityFailure && error.code === 'UNSUPPORTED') throw error
    if (unsupportedCrypto(error)) throw new IdentityFailure('UNSUPPORTED', 'This browser cannot use the stored Ed25519 identity.')
    throw corrupt()
  }
}
export function identityRepository(database: LocationDatabase) {
  const table = database.nodeIdentities
  return {
    discardCandidate: () => table.delete('candidate'),
    get: (slot: StoredNodeIdentity['slot']) => table.get(slot),
    async installIfAbsent(record: StoredNodeIdentity) {
      return database.transaction('rw', table, async () => {
        const existing = await table.get(record.slot)
        if (existing) return existing
        await table.add(record)
        return record
      })
    },
    async save(record: StoredNodeIdentity) {
      await database.transaction('rw', table, async () => {
        const current = await table.get(record.slot)
        if (current?.localIdentityId !== record.localIdentityId) throw new IdentityFailure('TRANSIENT', 'Node identity changed in another tab. Retry to reload it.')
        // A concurrent successful registration cannot be overwritten with incomplete state.
        if (current.status === 'REGISTERED' && record.status !== 'REGISTERED') return
        await table.put(record)
      })
    },
    async promote(candidate: StoredNodeIdentity) {
      await database.transaction('rw', table, async () => {
        const current = await table.get('active'), pending = await table.get('candidate')
        if (candidate.status !== 'REGISTERED' || !candidate.nodeId || pending?.localIdentityId !== candidate.localIdentityId
          || (current?.localIdentityId ?? null) !== candidate.replacesIdentityId)
          throw new IdentityFailure('TRANSIENT', 'Node identity changed in another tab. Reload before replacing it.')
        const { replacesIdentityId: _previous, ...active } = candidate
        void _previous
        await table.put({ ...active, slot: 'active' })
        await table.delete('candidate')
      })
    },
  }
}
