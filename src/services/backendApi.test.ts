import { describe, expect, it, vi } from 'vitest'
import { buildSeed } from '@/data/seed'
import { createMemoryStorage } from '@/lib/storage'
import { MockRepository } from '@/repositories/MockRepository'
import { SyncEngine } from '@/services/sync/SyncEngine'
import { BackendApiClient, BackendApiError } from './backendApi'
import { startBackendServer } from '@/backend/api/server'
import { ReplicaStore } from '@/backend/persistence/ReplicaStore'

const pendingChange = async () => {
  const seed = buildSeed(1)
  const storage = createMemoryStorage()
  const engine = new SyncEngine({ storage, isAutoSyncEnabled: () => false })
  const repository = new MockRepository(engine, storage, seed, { latencyMs: 0, now: () => 1 })
  await repository.adjustStock({
    productId: 'p-coffee',
    type: 'add',
    quantity: 1,
    reason: 'restock',
    notes: '',
  })
  return { engine, change: engine.getSnapshot().pending[0] }
}

describe('BackendApiClient', () => {
  it('sends a valid CRDT state message for pending frontend changes', async () => {
    const { engine, change } = await pendingChange()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          applied: true,
          acknowledgement: { status: 'applied', messageId: 'replica-a7f2:op-1' },
          replicaId: 'backend-replica',
          snapshot: {},
          persistedAt: 1,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    try {
      await new BackendApiClient('http://localhost:8787/').syncChanges(engine.replicaId, [change])
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8787/v1/sync/messages',
        expect.objectContaining({ method: 'POST' }),
      )
      const request = fetchMock.mock.calls[0][1] as RequestInit
      const message = JSON.parse(String(request.body)) as {
        type: string
        protocol: string
        version: number
        fromReplicaId: string
        snapshot: { set: { adds: Record<string, unknown> } }
      }
      expect(message).toMatchObject({
        type: 'state',
        protocol: 'syncdesk-state',
        version: 1,
        fromReplicaId: engine.replicaId,
      })
      expect(Object.keys(message.snapshot.set.adds)).toHaveLength(1)
    } finally {
      fetchMock.mockRestore()
      engine.dispose()
    }
  })

  it('maps backend errors to a stable typed error', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 'persistence_failed', message: 'The synchronization update could not be persisted.' } }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      ),
    )
    try {
      await expect(new BackendApiClient('http://localhost:8787').health()).rejects.toEqual(
        new BackendApiError(503, 'persistence_failed', 'The synchronization update could not be persisted.'),
      )
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('rejects malformed catalog responses', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ catalog: { products: [{}], categories: [] } }), { status: 200 }),
    )
    try {
      await expect(new BackendApiClient('http://localhost:8787').getRetailCatalog()).rejects.toEqual(
        new BackendApiError(200, 'invalid_backend_response', 'The backend returned an invalid catalog.'),
      )
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('maps an unavailable backend during catalog hydration to a stable error', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    try {
      await expect(new BackendApiClient('http://localhost:8787').getRetailCatalog()).rejects.toEqual(
        new BackendApiError(0, 'backend_unavailable', 'The backend is unavailable.'),
      )
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('completes a real frontend sync through the backend HTTP server', async () => {
    const backend = await startBackendServer({ port: 0 })
    const seed = buildSeed(1)
    const storage = createMemoryStorage()
    const client = new BackendApiClient(`http://127.0.0.1:${backend.port}`)
    const engine = new SyncEngine({
      storage,
      connectMs: 0,
      syncMs: 0,
      autoSyncDelayMs: 0,
      isAutoSyncEnabled: () => true,
      backendClient: client,
    })

    const repository = new MockRepository(engine, storage, seed, { latencyMs: 0, now: () => 1 })

    try {
      await repository.adjustStock({
        productId: 'p-coffee',
        type: 'add',
        quantity: 1,
        reason: 'restock',
        notes: '',
      })
      engine.syncNow()
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('backend sync did not finish')), 1000)
        const check = () => {
          if (engine.getSnapshot().phase === 'idle' && engine.getSnapshot().pending.length === 0) {
            clearTimeout(timeout)
            resolve()
          }
        }
        engine.subscribe(check)
        check()
      })

      const state = await client.getReplica()
      expect(state.persisted).toBe(true)
      expect(engine.getSnapshot().lastError).toBeNull()
    } finally {
      engine.dispose()
      await backend.close()
    }
  })

  it('loads a backend catalog into the local repository without duplication', async () => {
    const backend = await startBackendServer({ port: 0 })
    const seed = buildSeed(1)
    const storage = createMemoryStorage()
    const sourceEngine = new SyncEngine({ storage: createMemoryStorage(), isAutoSyncEnabled: () => false })
    const sourceRepository = new MockRepository(sourceEngine, storage, seed, { latencyMs: 0 })
    const created = await sourceRepository.createProduct({
      name: 'Hydrated coffee',
      nameAr: '',
      description: '',
      descriptionAr: '',
      price: 300,
      categoryId: seed.categories[0].id,
      availability: 'available',
      stock: 2,
      lowStockThreshold: 1,
    })

    const client = new BackendApiClient(`http://127.0.0.1:${backend.port}`)

    try {
      await client.syncRetailOperations([{ operationId: 'hydrate-op', kind: 'product.upsert', product: created }])
      const localEngine = new SyncEngine({ storage, isAutoSyncEnabled: () => false })
      const localRepository = new MockRepository(localEngine, storage, seed, { latencyMs: 0 })
      await localRepository.hydrateCatalog(await client.getRetailCatalog())
      await localRepository.hydrateCatalog(await client.getRetailCatalog())
      expect((await localRepository.getProducts()).filter((product) => product.id === created.id)).toHaveLength(1)
      expect((await localRepository.getProducts()).find((product) => product.id === created.id)?.name).toBe('Hydrated coffee')
      localEngine.dispose()
    } finally {
      sourceEngine.dispose()
      await backend.close()
    }
  })

  it('round-trips product update and deletion through the backend catalog', async () => {
    const backend = await startBackendServer({ port: 0 })
    const seed = buildSeed(1)
    const product = seed.products[0]
    const client = new BackendApiClient(`http://127.0.0.1:${backend.port}`)

    try {
      await client.syncRetailOperations([{ operationId: 'roundtrip-create', kind: 'product.upsert', product }])
      const updated = { ...product, name: 'Updated remotely', updatedAt: product.updatedAt + 1 }
      await client.syncRetailOperations([{ operationId: 'roundtrip-update', kind: 'product.upsert', product: updated }])
      expect((await client.getRetailCatalog()).products.find((item) => item.id === product.id)?.name).toBe('Updated remotely')

      await client.syncRetailOperations([{ operationId: 'roundtrip-delete', kind: 'product.delete', productId: product.id }])
      expect((await client.getRetailCatalog()).products.some((item) => item.id === product.id)).toBe(false)
    } finally {
      await backend.close()
    }
  })

  it('hydrates the same catalog after backend restart', async () => {
    const store = new ReplicaStore()
    const first = await startBackendServer({ port: 0, store })
    const seed = buildSeed(1)
    const client = new BackendApiClient(`http://127.0.0.1:${first.port}`)

    await client.syncRetailOperations([{ operationId: 'restart-product', kind: 'product.upsert', product: seed.products[0] }])
    await first.close()

    const second = await startBackendServer({ port: 0, store })
    try {
      const restartedClient = new BackendApiClient(`http://127.0.0.1:${second.port}`)
      expect((await restartedClient.getRetailCatalog()).products).toContainEqual(seed.products[0])
    } finally {
      await second.close()
    }
  })

  it('persists a product mutation through the retail backend endpoint', async () => {
    const backend = await startBackendServer({ port: 0 })
    const seed = buildSeed(1)
    const storage = createMemoryStorage()
    const client = new BackendApiClient(`http://127.0.0.1:${backend.port}`)
    const engine = new SyncEngine({
      storage,
      connectMs: 0,
      syncMs: 0,
      autoSyncDelayMs: 0,
      isAutoSyncEnabled: () => true,
      backendClient: client,
    })
    const repository = new MockRepository(engine, storage, seed, { latencyMs: 0, now: () => 1 })

    try {
      const created = await repository.createProduct({
        name: 'Backend coffee',
        nameAr: '',
        description: 'Created through the retail path',
        descriptionAr: '',
        price: 250,
        categoryId: seed.categories[0].id,
        availability: 'available',
        stock: 4,
        lowStockThreshold: 1,
      })
      engine.syncNow()
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('retail sync did not finish')), 1000)
        const check = () => {
          if (engine.getSnapshot().phase === 'idle' && engine.getSnapshot().pending.length === 0) {
            clearTimeout(timeout)
            resolve()
          }
        }
        engine.subscribe(check)
        check()
      })

      const catalog = await client.getRetailCatalog()
      expect(catalog.products).toContainEqual(expect.objectContaining({ id: created.id, name: 'Backend coffee' }))
    } finally {
      engine.dispose()
      await backend.close()
    }
  })
})
