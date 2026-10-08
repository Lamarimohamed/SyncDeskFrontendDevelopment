import type {
  ActivityEvent,
  ActivityKind,
  ChangeDraft,
  ConflictRecord,
  PendingChange,
  RemoteChange,
  SyncSnapshot,
} from '@/domain/sync'
import { nextId } from '@/lib/ids'
import { logger } from '@/lib/logger'
import { readJson, writeJson, type KeyValueStorage } from '@/lib/storage'

/**
 * Frontend simulation of the synchronization layer. It models connectivity,
 * a pending-operation queue and a merge step, but contains no real CRDT:
 * conflict handling mirrors last-writer-wins semantics for price only.
 * A real synchronizer can replace this class behind the same surface.
 */

export interface SyncEngineOptions {
  storage: KeyValueStorage
  replicaId?: string
  deviceId?: string
  connectMs?: number
  syncMs?: number
  autoSyncDelayMs?: number
  now?: () => number
  isAutoSyncEnabled?: () => boolean
  seedActivity?: ActivityEvent[]
  seedLastSyncAt?: number | null
}

type MergeHandler = (change: RemoteChange) => void
type Listener = () => void

interface Persisted {
  connectivity: 'online' | 'offline'
  pending: PendingChange[]
  activity: ActivityEvent[]
  conflicts: ConflictRecord[]
  remote: RemoteChange[]
  lastSyncAt: number | null
  counters: SyncSnapshot['counters']
}

const STORAGE_KEY = 'syncdesk.sync.v1'
const ACTIVITY_LIMIT = 120
const OP_OVERHEAD_BYTES = 96
const STATE_RECEIVED_BASE_BYTES = 180
const MERGE_RULE = 'Last-writer-wins register: the value with the later timestamp is kept; the other value is overwritten, not preserved.'

export class SyncEngine {
  readonly replicaId: string
  readonly deviceId: string
  private readonly opts: Required<Omit<SyncEngineOptions, 'storage' | 'seedActivity' | 'seedLastSyncAt'>> & {
    storage: KeyValueStorage
  }
  private snapshot: SyncSnapshot
  private remote: RemoteChange[]
  private listeners = new Set<Listener>()
  private mergeHandler: MergeHandler = () => {}
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private failNextSync = false
  private inFlight = new Set<string>()

  constructor(options: SyncEngineOptions) {
    this.replicaId = options.replicaId ?? 'replica-a7f2'
    this.deviceId = options.deviceId ?? 'dev-counter'
    this.opts = {
      storage: options.storage,
      replicaId: this.replicaId,
      deviceId: this.deviceId,
      connectMs: options.connectMs ?? 1100,
      syncMs: options.syncMs ?? 1600,
      autoSyncDelayMs: options.autoSyncDelayMs ?? 1500,
      now: options.now ?? Date.now,
      isAutoSyncEnabled: options.isAutoSyncEnabled ?? (() => true),
    }
    const saved = readJson<Persisted | null>(options.storage, STORAGE_KEY, null)
    this.remote = saved?.remote ?? []
    this.snapshot = {
      replicaId: this.replicaId,
      connectivity: saved?.connectivity ?? 'online',
      phase: 'idle',
      pending: (saved?.pending ?? []).map((p) => ({ ...p, status: p.status === 'syncing' ? 'pending' : p.status })),
      activity: saved?.activity ?? options.seedActivity ?? [],
      conflicts: saved?.conflicts ?? [],
      lastSyncAt: saved ? saved.lastSyncAt : (options.seedLastSyncAt ?? null),
      lastError: null,
      remoteWaiting: this.remote.length,
      counters: saved?.counters ?? { bytesSent: 0, bytesReceived: 0, mergeCount: 0, conflictCount: 0, lastMergeAt: null },
    }
  }

  getSnapshot = (): SyncSnapshot => this.snapshot

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setMergeHandler(handler: MergeHandler): void {
    this.mergeHandler = handler
  }

  /** Resume work that was interrupted by a page refresh. */
  start(): void {
    if (this.snapshot.connectivity === 'online' && this.snapshot.pending.length > 0 && this.opts.isAutoSyncEnabled()) {
      this.scheduleAutoSync()
    }
  }

  dispose(): void {
    this.timers.forEach(clearTimeout)
    this.timers.clear()
  }

  enqueue(draft: ChangeDraft): PendingChange {
    const createdAt = this.opts.now()
    const change: PendingChange = {
      ...draft,
      id: nextId('op'),
      status: 'pending',
      attempts: 0,
      createdAt,
      sizeBytes: OP_OVERHEAD_BYTES + draft.summary.length + (draft.to?.length ?? 0),
    }
    this.update({ pending: [...this.snapshot.pending, change] })
    this.log('change-created', `Local change created: ${draft.summary}`, draft.entityLabel)
    if (this.snapshot.connectivity !== 'online') {
      this.log('change-queued', 'Change queued', 'Waiting for connectivity')
    } else if (this.opts.isAutoSyncEnabled()) {
      this.scheduleAutoSync()
    }
    return change
  }

  goOffline(): void {
    if (this.snapshot.connectivity === 'offline') return
    this.clearTimers()
    this.log('connection-lost', 'Connection lost', 'Working from the local replica')
    this.update({
      connectivity: 'offline',
      phase: 'idle',
      pending: this.snapshot.pending.map((p) => (p.status === 'syncing' ? { ...p, status: 'pending' } : p)),
    })
    logger.debug('CONNECTIVITY', 'offline')
  }

  goOnline(): void {
    if (this.snapshot.connectivity !== 'offline') return
    this.clearTimers()
    this.log('connection-restored', 'Connection restored', 'Reconnecting to peers')
    this.update({ connectivity: 'connecting' })
    this.later(this.opts.connectMs, () => {
      this.update({ connectivity: 'online' })
      this.runSync()
    })
  }

  /** Drop the connection and re-establish it. */
  reconnect(): void {
    this.goOffline()
    this.later(300, () => this.goOnline())
  }

  syncNow(): void {
    if (this.snapshot.connectivity === 'offline') return
    if (this.snapshot.connectivity === 'connecting' || this.snapshot.phase === 'syncing') return
    this.runSync()
  }

  retryChange(id: string): void {
    this.update({
      pending: this.snapshot.pending.map((p) => (p.id === id ? { ...p, status: 'pending' } : p)),
    })
    this.syncNow()
  }

  removeChange(id: string): boolean {
    const target = this.snapshot.pending.find((p) => p.id === id)
    if (!target || !target.discardable || target.status === 'syncing') return false
    this.update({ pending: this.snapshot.pending.filter((p) => p.id !== id) })
    this.log('info', 'Pending change discarded', target.summary)
    return true
  }

  clearPending(): void {
    if (this.snapshot.pending.length === 0) return
    this.update({ pending: [], phase: this.snapshot.phase === 'error' ? 'idle' : this.snapshot.phase, lastError: null })
    this.log('info', 'Pending queue cleared', 'Development control')
  }

  setFailNextSync(value = true): void {
    this.failNextSync = value
  }

  /** A remote device edits a price concurrently; this replica learns of it at the next merge. */
  simulateRemotePriceChange(entityId: string, entityLabel: string, newPrice: number, deviceName = 'Kitchen display'): void {
    const change: RemoteChange = {
      id: nextId('rc'),
      deviceId: 'dev-kitchen',
      deviceName,
      entityId,
      entityLabel,
      field: 'price',
      value: newPrice,
      timestamp: this.opts.now(),
    }
    this.remote = [...this.remote, change]
    this.update({ remoteWaiting: this.remote.length })
    if (this.snapshot.connectivity === 'online' && this.snapshot.phase !== 'syncing') this.runSync()
  }

  private runSync(): void {
    if (this.snapshot.connectivity !== 'online' || this.snapshot.phase === 'syncing') return
    this.clearTimers()
    this.log('sync-started', 'Synchronization started', `${this.snapshot.pending.length} local changes to send`)
    this.inFlight = new Set(this.snapshot.pending.map((p) => p.id))
    this.update({
      phase: 'syncing',
      lastError: null,
      pending: this.snapshot.pending.map((p) => ({ ...p, status: 'syncing' })),
    })
    this.later(this.opts.syncMs, () => this.finishSync())
  }

  private finishSync(): void {
    if (this.snapshot.connectivity !== 'online') return
    if (this.failNextSync) {
      this.failNextSync = false
      this.log('sync-failed', 'Synchronization failed', 'Peer did not acknowledge the state exchange')
      this.update({
        phase: 'error',
        lastError: 'The peer did not acknowledge the state exchange.',
        pending: this.snapshot.pending.map((p) =>
          this.inFlight.has(p.id) ? { ...p, status: 'failed', attempts: p.attempts + 1 } : p,
        ),
      })
      return
    }

    const inbox = this.remote
    const local = this.snapshot.pending.filter((p) => this.inFlight.has(p.id))
    const rest = this.snapshot.pending.filter((p) => !this.inFlight.has(p.id)).map((p) => ({ ...p, status: 'pending' as const }))
    const received = inbox.length
    const receivedBytes = STATE_RECEIVED_BASE_BYTES + received * 120
    this.log('state-received', 'State received', received ? `${received} remote change${received > 1 ? 's' : ''}` : 'No remote changes')

    const conflicts: ConflictRecord[] = []
    for (const remote of inbox) {
      const localOp = local.find((p) => p.entityId === remote.entityId && p.field === remote.field)
      if (localOp) {
        const conflict = this.resolveConflict(localOp, remote)
        conflicts.push(conflict)
        this.log('conflict', 'Concurrent change detected', `${remote.entityLabel} · ${remote.field}`)
        if (conflict.winner === 'remote') this.mergeHandler(remote)
      } else {
        this.mergeHandler(remote)
        this.log('remote-applied', `Remote change applied: ${remote.entityLabel} ${remote.field}`, remote.deviceName)
      }
    }
    this.remote = []

    const sent = local.reduce((sum, p) => sum + p.sizeBytes, 0)
    const at = this.opts.now()
    this.log('merge-completed', 'Merge completed')
    this.log('converged', 'Replicas converged', 'Pending changes: 0')
    const c = this.snapshot.counters
    this.update({
      phase: 'idle',
      pending: rest,
      remoteWaiting: 0,
      conflicts: [...conflicts.reverse(), ...this.snapshot.conflicts].slice(0, 20),
      lastSyncAt: at,
      lastError: null,
      counters: {
        bytesSent: c.bytesSent + sent,
        bytesReceived: c.bytesReceived + receivedBytes,
        mergeCount: c.mergeCount + 1,
        conflictCount: c.conflictCount + conflicts.length,
        lastMergeAt: at,
      },
    })
    this.inFlight = new Set()
    if (rest.length > 0 && this.opts.isAutoSyncEnabled()) this.scheduleAutoSync()
  }

  private resolveConflict(localOp: PendingChange, remote: RemoteChange): ConflictRecord {
    const remoteWins =
      remote.timestamp > localOp.createdAt || (remote.timestamp === localOp.createdAt && remote.deviceId > this.deviceId)
    const localValue = localOp.to ?? ''
    const remoteValue = `${remote.value} DA`
    return {
      id: nextId('cf'),
      at: this.opts.now(),
      entityLabel: remote.entityLabel,
      field: remote.field,
      local: localValue,
      localAt: localOp.createdAt,
      remote: remoteValue,
      remoteAt: remote.timestamp,
      remoteDevice: remote.deviceName,
      result: remoteWins ? remoteValue : localValue,
      winner: remoteWins ? 'remote' : 'local',
      rule: MERGE_RULE,
    }
  }

  private scheduleAutoSync(): void {
    this.later(this.opts.autoSyncDelayMs, () => this.syncNow())
  }

  private later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t)
      fn()
    }, ms)
    this.timers.add(t)
  }

  private clearTimers(): void {
    this.timers.forEach(clearTimeout)
    this.timers.clear()
  }

  private log(kind: ActivityKind, title: string, detail?: string): void {
    const event: ActivityEvent = { id: nextId('ev'), at: this.opts.now(), kind, title, detail, deviceId: this.deviceId }
    this.snapshot = { ...this.snapshot, activity: [event, ...this.snapshot.activity].slice(0, ACTIVITY_LIMIT) }
    this.commit()
    logger.debug('SYNC', title, detail)
  }

  private update(patch: Partial<SyncSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    this.commit()
  }

  private commit(): void {
    this.persist()
    this.listeners.forEach((l) => l())
  }

  private persist(): void {
    const s = this.snapshot
    const data: Persisted = {
      connectivity: s.connectivity === 'offline' ? 'offline' : 'online',
      pending: s.pending,
      activity: s.activity,
      conflicts: s.conflicts,
      remote: this.remote,
      lastSyncAt: s.lastSyncAt,
      counters: s.counters,
    }
    writeJson(this.opts.storage, STORAGE_KEY, data)
  }
}
