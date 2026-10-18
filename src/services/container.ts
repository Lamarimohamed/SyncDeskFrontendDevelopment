import { buildSeed } from '@/data/seed'
import { browserStorage } from '@/lib/storage'
import { env } from '@/lib/env'
import { preferencesStore } from '@/state/preferences'
import { LocalAuthService } from './auth/AuthService'
import { SyncEngine } from './sync/SyncEngine'
import { MockRepository } from '@/repositories/MockRepository'
import type { Repository } from '@/repositories/Repository'
import { SyncService } from './syncService'
import { BackendApiClient } from './backendApi'
import { logger } from '@/lib/logger'

const storage = browserStorage('local')
const seed = buildSeed(Date.now())
const backendClient = env.backendUrl ? new BackendApiClient(env.backendUrl) : undefined

const engine = new SyncEngine({
  storage,
  seedActivity: seed.activity,
  seedLastSyncAt: seed.lastSyncAt,
  isAutoSyncEnabled: () => preferencesStore.get().autoSync,
  backendClient,
})

const mockRepository = new MockRepository(engine, storage, seed, { latencyMs: env.isTest ? 0 : 300 })

export const repository: Repository = mockRepository
export const syncService = new SyncService(engine, repository, mockRepository)

export const authService = new LocalAuthService({
  persistent: storage,
  session: browserStorage('session'),
  isOnline: () => engine.getSnapshot().connectivity !== 'offline',
})

engine.start()

if (backendClient) {
  void backendClient
    .getRetailCatalog()
    .then((catalog) => mockRepository.hydrateCatalog(catalog))
    .catch((error: unknown) => {
      logger.warn('REPOSITORY', 'Catalog hydration unavailable', error instanceof Error ? error.message : 'The backend catalog could not be loaded.')
    })
}
