import { liveQuery } from 'dexie'
import { ApiError, locationClient } from '../../api/locationClient'
import { db, type LocationDatabase } from '../../location/persistence/db'
import { identityRepository, validateIdentity, type StoredNodeIdentity } from '../persistence/identityRepository'
import { base64url, decodeBase64url, exportPublicKey, generateNodeKeys, IdentityFailure, registrationStatement, requireCrypto, timestamp, uuid } from './crypto'

type Replacement = { status: 'REGISTERING' | 'ERROR' | 'REGISTRATION_RECOVERY_REQUIRED'; reason?: string; fingerprint?: string }
export type NodeIdentitySnapshot =
  | { status: 'INITIALIZING' }
  | { status: 'REGISTERING'; fingerprint: string }
  | { status: 'READY'; nodeId: string; fingerprint: string; createdAt: string; registeredAt: string; replacement?: Replacement }
  | { status: 'UNSUPPORTED'; reason: string }
  | { status: 'ERROR' | 'REGISTRATION_RECOVERY_REQUIRED'; reason: string; recoverable: true }
type RegistrationApi = Pick<typeof locationClient, 'issueNodeRegistrationChallenge' | 'registerNode'>

const queues = new Map<string, Promise<unknown>>()
function coordinated<T>(name: string, action: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => navigator.locks ? await navigator.locks.request(`kavozi-node-identity:${name}`, action) : action()
  const result = (queues.get(name) ?? Promise.resolve()).then(run, run)
  queues.set(name, result.catch(() => undefined))
  return result
}
function ready(record: StoredNodeIdentity): Extract<NodeIdentitySnapshot, { status: 'READY' }> {
  return { status: 'READY', nodeId: record.nodeId!, fingerprint: record.localFingerprint, createdAt: record.createdAt, registeredAt: record.registeredAt! }
}
function safeFailure(error: unknown): IdentityFailure {
  if (error instanceof IdentityFailure) return error
  if (error instanceof ApiError && error.status === 409) return new IdentityFailure('RECOVERY', 'This public key is already registered, but its node ID was not saved locally. The backend has no proof-backed recovery operation yet. Keep this key and retry after recovery support is available, or explicitly create a new identity.')
  if (error instanceof ApiError && [400, 413].includes(error.status)) return new IdentityFailure('PROTOCOL', 'The backend rejected node registration. The same local key has been preserved; retry registration or check backend compatibility.')
  return new IdentityFailure('TRANSIENT', 'Node identity could not be initialized or registered. Check the connection and browser storage, then retry. Existing keys are preserved.')
}

export class NodeIdentityManager {
  private snapshot: NodeIdentitySnapshot = { status: 'INITIALIZING' }
  private listeners = new Set<() => void>()
  private changedListeners = new Set<(fingerprint: string) => void>()
  private flight?: Promise<NodeIdentitySnapshot>
  private flightKind?: 'initialize' | 'regenerate'
  private repository: ReturnType<typeof identityRepository>
  private database: LocationDatabase
  private api: RegistrationApi
  private observer?: { unsubscribe(): void }
  private observedIdentity?: string

  constructor(database = db, api: RegistrationApi = locationClient) {
    this.database = database; this.api = api; this.repository = identityRepository(database)
  }
  getSnapshot = (): NodeIdentitySnapshot => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    if (!this.observer) {
      // IndexedDB notifications work across tabs, and contain no key objects in public state.
      this.observer = liveQuery(async () => {
        const active = await this.repository.get('active')
        return active ? `${active.localIdentityId}:${active.status}:${active.nodeId ?? ''}` : ''
      }).subscribe({ next: (identity) => {
        const changed = this.observedIdentity !== undefined && identity !== this.observedIdentity
        this.observedIdentity = identity
        if (changed && !this.flight) void this.initialize()
      }, error: () => { /* initialize exposes a sanitized storage error */ } })
    }
    return () => {
      this.listeners.delete(listener)
      if (!this.listeners.size) { this.observer?.unsubscribe(); this.observer = undefined; this.observedIdentity = undefined }
    }
  }
  onIdentityChanged(listener: (fingerprint: string) => void) {
    this.changedListeners.add(listener)
    return () => { this.changedListeners.delete(listener) }
  }
  private publish(snapshot: NodeIdentitySnapshot, identityChanged = false) {
    const prior = this.snapshot
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
    if (snapshot.status === 'READY' && (identityChanged || (prior.status === 'READY' && prior.fingerprint !== snapshot.fingerprint)))
      for (const listener of this.changedListeners) listener(snapshot.fingerprint)
  }
  private async generate(slot: StoredNodeIdentity['slot'], replacesIdentityId?: string | null): Promise<StoredNodeIdentity> {
    const keys = await generateNodeKeys()
    const record: StoredNodeIdentity = { slot, schemaVersion: 1, localIdentityId: crypto.randomUUID(), status: 'LOCAL_ONLY',
      ...keys, ...await exportPublicKey(keys.publicKey), createdAt: new Date().toISOString(), ...(slot === 'candidate' ? { replacesIdentityId } : {}) }
    // Atomic singleton insertion also prevents different winning keys without Web Locks.
    return this.repository.installIfAbsent(record)
  }
  private async register(record: StoredNodeIdentity): Promise<StoredNodeIdentity> {
    await validateIdentity(record)
    if (record.status === 'REGISTERED') return record
    record = { ...record, status: 'REGISTERING' }
    await this.repository.save(record)
    for (let attempt = 0; attempt < 2; attempt++) {
      const challenge = await this.api.issueNodeRegistrationChallenge({ publicKey: record.publicKeySpki })
      if (challenge.fingerprint !== record.localFingerprint || !uuid(challenge.challengeId) || !timestamp(challenge.expiresAt)
        || typeof challenge.challenge !== 'string' || challenge.challenge.length !== 43 || decodeBase64url(challenge.challenge).length !== 32)
        throw new IdentityFailure('PROTOCOL', 'Registration challenge failed verification. The local key has been preserved.')
      if (Date.parse(challenge.expiresAt) <= Date.now()) {
        if (attempt === 0) continue
        throw new IdentityFailure('TRANSIENT', 'Registration challenges expired. Check the device clock and retry with the same key.')
      }
      const statement = registrationStatement(challenge.challengeId, challenge.challenge, record.localFingerprint)
      const signature = await requireCrypto().sign('Ed25519', record.privateKey, statement)
      let response
      try {
        response = await this.api.registerNode({ challengeId: challenge.challengeId.toLowerCase(), challenge: challenge.challenge,
          publicKey: record.publicKeySpki, signature: base64url(new Uint8Array(signature)) })
      } catch (error) {
        if (error instanceof ApiError && error.status === 400 && Date.parse(challenge.expiresAt) <= Date.now() && attempt === 0) continue
        // Another tab without Web Locks may have completed the same proof concurrently.
        if (error instanceof ApiError && error.status === 409) {
          const stored = await this.repository.get(record.slot)
          if (stored?.localIdentityId === record.localIdentityId && stored.status === 'REGISTERED') return validateIdentity(stored)
        }
        throw error
      }
      if (response.fingerprint !== record.localFingerprint || response.keyAlgorithm !== 'Ed25519' || response.status !== 'ACTIVE'
        || !uuid(response.nodeId) || !timestamp(response.createdAt))
        throw new IdentityFailure('PROTOCOL', 'Registered node response failed verification. The local key has been preserved; registration recovery may be required.')
      const registered: StoredNodeIdentity = { ...record, status: 'REGISTERED', nodeId: response.nodeId,
        serverFingerprint: response.fingerprint, registeredAt: response.createdAt }
      await this.repository.save(registered)
      return registered
    }
    throw new IdentityFailure('TRANSIENT', 'Registration could not finish. Retry using the same key.')
  }
  private run(kind: 'initialize' | 'regenerate', action: () => Promise<void>): Promise<NodeIdentitySnapshot> {
    if (this.flight) {
      // A deliberate replacement must not be swallowed by a background reload.
      if (kind === 'regenerate' && this.flightKind === 'initialize') return this.flight.then(() => this.run(kind, action))
      return this.flight
    }
    this.flightKind = kind
    this.flight = coordinated(this.database.name, async () => {
      try { requireCrypto(); await action() }
      catch (error) {
        const failure = safeFailure(error)
        const status = failure.code === 'RECOVERY' ? 'REGISTRATION_RECOVERY_REQUIRED' : 'ERROR'
        // Failed replacement must not remove access to the previous working node.
        let current: StoredNodeIdentity | undefined
        try { current = await this.repository.get('active'); if (current) await validateIdentity(current) } catch { current = undefined }
        if (current?.status === 'REGISTERED') this.publish({ ...ready(current), replacement: { status, reason: failure.message } })
        else if (failure.code === 'UNSUPPORTED') this.publish({ status: 'UNSUPPORTED', reason: failure.message })
        else this.publish({ status, reason: failure.message, recoverable: true })
      }
      return this.snapshot
    }).finally(() => { this.flight = undefined; this.flightKind = undefined })
    return this.flight
  }
  initialize = (): Promise<NodeIdentitySnapshot> => this.run('initialize', async () => {
    let active = await this.repository.get('active')
    const candidate = await this.repository.get('candidate')
    if (!active && candidate) {
      const registered = await this.register(candidate)
      await this.repository.promote(registered); this.publish(ready(registered), true); return
    }
    active ??= await this.generate('active')
    await validateIdentity(active)
    if (active.status !== 'REGISTERED') {
      this.publish({ status: 'REGISTERING', fingerprint: active.localFingerprint })
      active = await this.register(active)
    }
    if (candidate) {
      await validateIdentity(candidate)
      if (candidate.status === 'REGISTERED') { await this.repository.promote(candidate); this.publish(ready(candidate), true); return }
      this.publish({ ...ready(active), replacement: { status: 'ERROR', fingerprint: candidate.localFingerprint, reason: 'A replacement identity is pending. Retry to register the same candidate; the current identity remains usable.' } })
    } else this.publish(ready(active))
  })
  /** Invoke only after deliberate UI confirmation; a persisted candidate is reused on retry. */
  regenerate = (discardPending = false): Promise<NodeIdentitySnapshot> => this.run('regenerate', async () => {
    const active = await this.repository.get('active')
    if (this.snapshot.status === 'READY') this.publish({ ...this.snapshot, replacement: { status: 'REGISTERING' } })
    if (discardPending) await this.repository.discardCandidate()
    const candidate = await this.repository.get('candidate') ?? await this.generate('candidate', active?.localIdentityId ?? null)
    await validateIdentity(candidate)
    if (this.snapshot.status === 'READY') this.publish({ ...this.snapshot, replacement: { status: 'REGISTERING', fingerprint: candidate.localFingerprint } })
    else this.publish({ status: 'REGISTERING', fingerprint: candidate.localFingerprint })
    const registered = await this.register(candidate)
    await this.repository.promote(registered)
    this.publish(ready(registered), true)
  })
  async sign(data: Uint8Array, expectedFingerprint?: string): Promise<Uint8Array<ArrayBuffer>> {
    return coordinated(this.database.name, async () => {
      try {
        const active = await this.repository.get('active')
        if (!active || active.status !== 'REGISTERED') throw new IdentityFailure('TRANSIENT', 'A registered node identity is required for signing.')
        if (expectedFingerprint && active.localFingerprint !== expectedFingerprint) throw new IdentityFailure('TRANSIENT', 'Node identity changed. Reopen the conversation with the current identity.')
        await validateIdentity(active)
        const signature = await requireCrypto().sign('Ed25519', active.privateKey, new Uint8Array(data))
        if ((await this.repository.get('active'))?.localIdentityId !== active.localIdentityId) throw new IdentityFailure('TRANSIENT', 'Identity changed during signing. Retry with the current identity.')
        return new Uint8Array(signature)
      } catch (error) { throw safeFailure(error) }
    })
  }
}
export const nodeIdentityManager = new NodeIdentityManager()
