import type { SyncEngine } from '@/services/sync/SyncEngine'

export interface BrowserConnectivityTarget {
  addEventListener(type: 'offline' | 'online', listener: () => void): void
  removeEventListener(type: 'offline' | 'online', listener: () => void): void
}

export interface BrowserConnectivityOptions {
  /** Current network state; defaults to the real navigator.onLine. */
  isOnline?: () => boolean
}

/**
 * Bridges real browser connectivity events into the sync engine so that
 * a genuine network loss queues edits (engine "offline") and a restored
 * connection replays them. The simulated demo controls remain usable:
 * they only differ from this bridge when the browser network actually
 * changes, at which point reality wins.
 */
export function wireBrowserConnectivity(
  engine: SyncEngine,
  target: BrowserConnectivityTarget | undefined = typeof window === 'undefined' ? undefined : window,
  options: BrowserConnectivityOptions = {},
): () => void {
  if (!target) return () => {}
  const isOnline = options.isOnline ?? (() => navigator.onLine)

  const onOffline = () => engine.goOffline()
  const onOnline = () => engine.goOnline()

  target.addEventListener('offline', onOffline)
  target.addEventListener('online', onOnline)
  if (!isOnline()) engine.goOffline()

  return () => {
    target.removeEventListener('offline', onOffline)
    target.removeEventListener('online', onOnline)
  }
}
