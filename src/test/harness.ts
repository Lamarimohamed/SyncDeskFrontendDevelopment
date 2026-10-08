import { buildSeed } from '@/data/seed'
import { createMemoryStorage } from '@/lib/storage'
import { MockRepository } from '@/repositories/MockRepository'
import { SyncEngine } from '@/services/sync/SyncEngine'
import { SyncService } from '@/services/syncService'

export function createHarness() {
  const storage = createMemoryStorage()
  const seed = buildSeed(Date.now())
  const engine = new SyncEngine({
    storage,
    connectMs: 10,
    syncMs: 10,
    autoSyncDelayMs: 10,
    seedActivity: seed.activity,
    seedLastSyncAt: seed.lastSyncAt,
    isAutoSyncEnabled: () => true,
  })
  const repo = new MockRepository(engine, storage, seed, { latencyMs: 0 })
  const sync = new SyncService(engine, repo, repo)
  engine.start()
  return { storage, engine, repo, sync, dispose: () => engine.dispose() }
}
