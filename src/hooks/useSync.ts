import { useSyncExternalStore } from 'react'
import type { SyncIndicatorState, SyncSnapshot } from '@/domain/sync'
import { syncService } from '@/services/container'

export function useSyncSnapshot(): SyncSnapshot {
  return useSyncExternalStore(syncService.subscribe, syncService.getSnapshot, syncService.getSnapshot)
}

export function deriveIndicatorState(s: SyncSnapshot): SyncIndicatorState {
  if (s.connectivity === 'offline') return 'offline'
  if (s.connectivity === 'connecting') return 'connecting'
  if (s.phase === 'error') return 'error'
  if (s.phase === 'syncing') return 'syncing'
  if (s.pending.length > 0) return 'pending'
  if (s.lastSyncAt === null) return 'unknown'
  return 'synchronized'
}

export function useIndicatorState(): SyncIndicatorState {
  return deriveIndicatorState(useSyncSnapshot())
}

/** Pending operations touching a given entity, for per-record save status. */
export function usePendingFor(entityId: string | undefined) {
  const s = useSyncSnapshot()
  return entityId ? s.pending.filter((p) => p.entityId === entityId) : []
}
