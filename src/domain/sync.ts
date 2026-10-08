export type ConnectivityStatus = 'online' | 'offline' | 'connecting'
export type SyncPhase = 'idle' | 'syncing' | 'error'
export type SyncIndicatorState =
  | 'synchronized'
  | 'pending'
  | 'syncing'
  | 'offline'
  | 'connecting'
  | 'error'
  | 'unknown'

export type CrdtKind = 'LWW Register' | 'OR-Set' | 'PN-Counter'
export type ChangeKind =
  | 'product.create'
  | 'product.update'
  | 'product.delete'
  | 'category.create'
  | 'category.update'
  | 'category.delete'
  | 'stock.adjust'
export type EntityType = 'product' | 'category' | 'stock'
export type ChangeStatus = 'pending' | 'syncing' | 'failed'

export interface PendingChange {
  id: string
  kind: ChangeKind
  entityType: EntityType
  entityId: string
  entityLabel: string
  summary: string
  /** Field touched by the change; used to detect concurrent edits. */
  field?: string
  from?: string
  to?: string
  crdt: CrdtKind
  createdAt: number
  status: ChangeStatus
  attempts: number
  sizeBytes: number
  /** Whether it is semantically safe to discard the change from the queue. */
  discardable: boolean
}

export type ChangeDraft = Omit<PendingChange, 'id' | 'status' | 'attempts' | 'createdAt' | 'sizeBytes'>

export type ActivityKind =
  | 'connection-lost'
  | 'connection-restored'
  | 'change-created'
  | 'change-queued'
  | 'sync-started'
  | 'state-received'
  | 'merge-completed'
  | 'converged'
  | 'sync-failed'
  | 'conflict'
  | 'remote-applied'
  | 'device'
  | 'info'

export interface ActivityEvent {
  id: string
  at: number
  kind: ActivityKind
  title: string
  detail?: string
  deviceId: string
}

export interface RemoteChange {
  id: string
  deviceId: string
  deviceName: string
  entityId: string
  entityLabel: string
  field: 'price'
  value: number
  timestamp: number
}

export interface ConflictRecord {
  id: string
  at: number
  entityLabel: string
  field: string
  local: string
  localAt: number
  remote: string
  remoteAt: number
  remoteDevice: string
  result: string
  winner: 'local' | 'remote'
  rule: string
}

export interface SyncCounters {
  bytesSent: number
  bytesReceived: number
  mergeCount: number
  conflictCount: number
  lastMergeAt: number | null
}

export interface SyncSnapshot {
  replicaId: string
  connectivity: ConnectivityStatus
  phase: SyncPhase
  pending: PendingChange[]
  activity: ActivityEvent[]
  conflicts: ConflictRecord[]
  lastSyncAt: number | null
  lastError: string | null
  remoteWaiting: number
  counters: SyncCounters
}

export type MetricProvenance = 'real' | 'simulated' | 'unavailable'
