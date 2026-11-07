import { describe, expect, it, vi } from 'vitest'
import { buildSeed } from '@/data/seed'
import { createMemoryStorage } from '@/lib/storage'
import { MockRepository } from '@/repositories/MockRepository'
import { SyncEngine } from '@/services/sync/SyncEngine'
import { BackendApiClient, BackendApiError } from './backendApi'
import { startBackendServer } from '@/backend/api/server'
import { ReplicaStore } from '@/backend/persistence/ReplicaStore'
import type { VersionedRetailOperation } from '@/domain/retailSync'

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

const waitForIdle = async (engine: SyncEngine): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('browser sync did not finish')), 2500)
    const check = () => {
      if (engine.getSnapshot().phase === 'idle' && engine.getSnapshot().pending.length === 0) {
        clearTimeout(timeout)
        resolve()
      }
    }
    engine.subscribe(check)
    check()
  })
}

const waitForError = async (engine: SyncEngine): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('browser sync did not enter error state')), 2500)
    const check = () => {
      if (engine.getSnapshot().phase === 'error') {
        clearTimeout(timeout)
        resolve()
      }
    }
    engine.subscribe(check)
    check()
  })
}

const versionedPatch = (index: number): VersionedRetailOperation => ({
  schemaVersion: 2,
  operationId: `fault-patch-${index}`,
  replicaId: 'fault-source',
  version: { logicalTime: index + 1, replicaId: 'fault-source', operationId: `fault-patch-${index}` },
  kind: 'product.patch',
  productId: 'p-coffee',
  changes: { name: `Fault product ${index}` },
})

describe('BackendApiClient', () => {
  it('rejects an incompatible bootstrap response explicitly', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        apiVersion: '1',
        protocolVersion: 'old-protocol',
        backendReplicaId: 'backend',
        initialization: { status: 'initialized', catalogState: 'empty', initializedAt: 1, registeredReplicaCount: 0 },
        catalog: { products: [], categories: [] },
        stockStates: {},
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    try {
      await expect(new BackendApiClient('http://localhost:8787').getBootstrap())
        .rejects.toMatchObject({ code: 'incompatible_backend' })
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('persists a versioned offline write across browser reinitialization', async () => {
    const seed = buildSeed(1)
    const storage = createMemoryStorage()
    const firstEngine = new SyncEngine({ storage, replicaId: 'browser-reload', isAutoSyncEnabled: () => false })
    const firstRepository = new MockRepository(firstEngine, storage, seed, { latencyMs: 0, now: () => 1 })

    await firstEngine.goOffline()
    await firstRepository.updateProduct('p-coffee', { ...seed.products[0], name: 'Saved offline edit' })
    const savedOperation = firstEngine.getSnapshot().pending[0].versionedOperation
    firstEngine.dispose()

    const secondEngine = new SyncEngine({ storage, replicaId: 'browser-reload', isAutoSyncEnabled: () => false })
    try {
      new MockRepository(secondEngine, storage, seed, { latencyMs: 0, now: () => 1 })
      expect(secondEngine.getSnapshot().pending[0].versionedOperation).toEqual(savedOperation)
      expect(secondEngine.getSnapshot().pending[0].status).toBe('pending')
    } finally {
      secondEngine.dispose()
    }
  })

  it('recovers when a durable push response is lost', async () => {
    const backend = await startBackendServer({ port: 0 })
    const seed = buildSeed(1)
    const storage = createMemoryStorage()
    const client = new BackendApiClient(`http://127.0.0.1:${backend.port}`)
    const originalPush = client.pushVersionedOperations.bind(client)
    let loseResponse = false
    client.pushVersionedOperations = async (operations) => {
      const result = await originalPush(operations)
      if (loseResponse) {
        loseResponse = false
        throw new BackendApiError(0, 'backend_unavailable', 'Simulated lost response')
      }
      return result
    }
    const engine = new SyncEngine({ storage, replicaId: 'lost-ack', connectMs: 0, syncMs: 0, isAutoSyncEnabled: () => false, backendClient: client })
    const repository = new MockRepository(engine, storage, seed, { latencyMs: 0, now: () => 1 })

    try {
      await client.pushVersionedOperations([{
        schemaVersion: 2,
        operationId: 'lost-ack-seed',
        replicaId: 'seed',
        version: { logicalTime: 1, replicaId: 'seed', operationId: 'lost-ack-seed' },
        kind: 'product.restore',
        productId: seed.products[0].id,
        product: seed.products[0],
      }])
      loseResponse = true
      engine.syncNow()
      await waitForIdle(engine)
      await repository.updateProduct('p-coffee', { ...seed.products[0], price: 121 })
      engine.syncNow()
      await waitForError(engine)
      expect(engine.getSnapshot().pending).toHaveLength(1)
      expect(engine.getSnapshot().phase).toBe('error')

      engine.retryChange(engine.getSnapshot().pending[0].id)
      await waitForIdle(engine)
      expect(engine.getSnapshot().pending).toHaveLength(0)
      expect((await client.getRetailCatalog()).products.find((item) => item.id === 'p-coffee')?.price).toBe(121)
    } finally {
      engine.dispose()
      await backend.close()
    }
  })

  it('recovers an interrupted multi-page pull without skipping operations', async () => {
    const backend = await startBackendServer({ port: 0 })
    const source = new BackendApiClient(`http://127.0.0.1:${backend.port}`)
    const operations = Array.from({ length: 101 }, (_, index) => versionedPatch(index))
    await source.pushVersionedOperations(operations.slice(0, 100))
    await source.pushVersionedOperations(operations.slice(100))
    const seed = buildSeed(1)
    const storage = createMemoryStorage()
    const target = new BackendApiClient(`http://127.0.0.1:${backend.port}`)
    const originalPull = target.pullVersionedOperations.bind(target)
    let pullCalls = 0
    target.pullVersionedOperations = async (after, limit) => {
      pullCalls += 1
      if (pullCalls === 2) throw new BackendApiError(0, 'backend_unavailable', 'Simulated interrupted pull')
      return originalPull(after, limit)
    }
    const engine = new SyncEngine({ storage, replicaId: 'pull-recovery', connectMs: 0, syncMs: 0, isAutoSyncEnabled: () => false, backendClient: target })
    new MockRepository(engine, storage, seed, { latencyMs: 0, now: () => 1 })

    try {
      engine.syncNow()
      await waitForError(engine)
      const savedAfterInterruption = JSON.parse(storage.getItem('syncdesk.sync.v1') ?? '{}').cursor
      expect(savedAfterInterruption).toBe(100)

      engine.syncNow()
      await waitForIdle(engine)
      expect(JSON.parse(storage.getItem('syncdesk.sync.v1') ?? '{}').cursor).toBe(101)
    } finally {
      engine.dispose()
      await backend.close()
    }
  })

  it('retries partially accepted batches without duplicate effects', async () => {
    const backend = await startBackendServer({ port: 0 })
    const client = new BackendApiClient(`http://127.0.0.1:${backend.port}`)
    const first = versionedPatch(1)
    const second = versionedPatch(2)
    const invalid = { ...versionedPatch(3), version: { ...versionedPatch(3).version, operationId: 'mismatch' } } as VersionedRetailOperation

    await expect(client.pushVersionedOperations([first, second, invalid])).rejects.toBeInstanceOf(BackendApiError)
    const page = await client.pullVersionedOperations(0, 100)
    expect(page.operations.map((entry) => entry.operation.operationId)).toEqual([first.operationId, second.operationId])

    const retry = await client.pushVersionedOperations([first, second])
    expect(retry.map((result) => result.status)).toEqual(['duplicate', 'duplicate'])
    expect((await client.pullVersionedOperations(0, 100)).operations).toHaveLength(2)
    await backend.close()
  })

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

      const catalog = await client.getRetailCatalog()
      expect(catalog).toEqual({ products: [], categories: [] })
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

  it('converges two independent browser replicas through versioned HTTP sync', async () => {
    const backend = await startBackendServer({ port: 0 })
    const seed = buildSeed(1)
    const firstStorage = createMemoryStorage()
    const secondStorage = createMemoryStorage()
    const client = new BackendApiClient(`http://127.0.0.1:${backend.port}`)
    const firstEngine = new SyncEngine({
      storage: firstStorage,
      replicaId: 'browser-a',
      connectMs: 0,
      syncMs: 0,
      autoSyncDelayMs: 0,
      isAutoSyncEnabled: () => false,
      backendClient: client,
    })

    const secondEngine = new SyncEngine({
      storage: secondStorage,
      replicaId: 'browser-b',
      connectMs: 0,
      syncMs: 0,
      autoSyncDelayMs: 0,
      isAutoSyncEnabled: () => false,
      backendClient: client,
    })
    const firstRepository = new MockRepository(firstEngine, firstStorage, seed, { latencyMs: 0, now: () => 1 })
    const secondRepository = new MockRepository(secondEngine, secondStorage, seed, { latencyMs: 0, now: () => 1 })

    try {
      const created = await firstRepository.createProduct({
        name: 'HTTP replica product',
        nameAr: '',
        description: '',
        descriptionAr: '',
        price: 250,
        categoryId: seed.categories[0].id,
        availability: 'available',
        stock: 2,
        lowStockThreshold: 1,
      })
      firstEngine.syncNow()
      await waitForIdle(firstEngine)
      secondEngine.syncNow()
      await waitForIdle(secondEngine)

      expect(await secondRepository.getProduct(created.id)).toMatchObject({
        id: created.id,
        name: created.name,
        price: created.price,
      })
      expect(await firstRepository.getProducts()).toEqual(await secondRepository.getProducts())
      expect(await firstRepository.getCategories()).toEqual(await secondRepository.getCategories())
      expect(secondEngine.getSnapshot().pending).toHaveLength(0)
    } finally {
      firstEngine.dispose()
      secondEngine.dispose()
      await backend.close()
    }
  })

  it('resolves concurrent browser writes deterministically after both replicas reconnect', async () => {
    const backend = await startBackendServer({ port: 0 })
    const seed = buildSeed(1)
    const firstStorage = createMemoryStorage()
    const secondStorage = createMemoryStorage()
    const client = new BackendApiClient(`http://127.0.0.1:${backend.port}`)
    const firstEngine = new SyncEngine({ storage: firstStorage, replicaId: 'browser-a', connectMs: 0, syncMs: 0, autoSyncDelayMs: 0, isAutoSyncEnabled: () => false, backendClient: client })
    const secondEngine = new SyncEngine({ storage: secondStorage, replicaId: 'browser-b', connectMs: 0, syncMs: 0, autoSyncDelayMs: 0, isAutoSyncEnabled: () => false, backendClient: client })
    const firstRepository = new MockRepository(firstEngine, firstStorage, seed, { latencyMs: 0, now: () => 1 })
    const secondRepository = new MockRepository(secondEngine, secondStorage, seed, { latencyMs: 0, now: () => 1 })

    try {
      await firstRepository.updateProduct('p-coffee', { ...seed.products[0], name: 'Replica A' })
      await secondRepository.updateProduct('p-coffee', { ...seed.products[0], name: 'Replica B' })
      firstEngine.syncNow()
      await waitForIdle(firstEngine)
      secondEngine.syncNow()
      await waitForIdle(secondEngine)
      firstEngine.syncNow()
      await waitForIdle(firstEngine)

      const firstProduct = await firstRepository.getProduct('p-coffee')
      const secondProduct = await secondRepository.getProduct('p-coffee')
      expect(firstProduct.name).toBe(secondProduct.name)
      expect(firstProduct.name).toBe('Replica B')
    } finally {
      firstEngine.dispose()
      secondEngine.dispose()
      await backend.close()
    }
  })

  it('preserves different-field edits across independent browser replicas', async () => {
    const backend = await startBackendServer({ port: 0 })
    const seed = buildSeed(1)
    const firstStorage = createMemoryStorage()
    const secondStorage = createMemoryStorage()
    const client = new BackendApiClient(`http://127.0.0.1:${backend.port}`)
    const firstEngine = new SyncEngine({ storage: firstStorage, replicaId: 'browser-a', connectMs: 0, syncMs: 0, isAutoSyncEnabled: () => false, backendClient: client })
    const secondEngine = new SyncEngine({ storage: secondStorage, replicaId: 'browser-b', connectMs: 0, syncMs: 0, isAutoSyncEnabled: () => false, backendClient: client })
    const firstRepository = new MockRepository(firstEngine, firstStorage, seed, { latencyMs: 0, now: () => 1 })
    const secondRepository = new MockRepository(secondEngine, secondStorage, seed, { latencyMs: 0, now: () => 1 })

    try {
      await firstRepository.updateProduct('p-coffee', { ...seed.products[0], name: 'Premium Coffee' })
      await secondRepository.updateProduct('p-coffee', { ...seed.products[0], price: 120 })
      firstEngine.syncNow()
      await waitForIdle(firstEngine)
      secondEngine.syncNow()
      await waitForIdle(secondEngine)
      firstEngine.syncNow()
      await waitForIdle(firstEngine)

      expect(await firstRepository.getProduct('p-coffee')).toMatchObject({ name: 'Premium Coffee', price: 120 })
      expect(await secondRepository.getProduct('p-coffee')).toMatchObject({ name: 'Premium Coffee', price: 120 })
    } finally {
      firstEngine.dispose()
      secondEngine.dispose()
      await backend.close()
    }
  })

  it('recovers a browser cursor and operation log after backend restart', async () => {
    const store = new ReplicaStore()
    const firstBackend = await startBackendServer({ port: 0, store })
    const seed = buildSeed(1)
    const storage = createMemoryStorage()
    const client = new BackendApiClient(`http://127.0.0.1:${firstBackend.port}`)
    const engine = new SyncEngine({
      storage,
      replicaId: 'browser-recovery',
      connectMs: 0,
      syncMs: 0,
      autoSyncDelayMs: 0,
      isAutoSyncEnabled: () => false,
      backendClient: client,
    })
    const repository = new MockRepository(engine, storage, seed, { latencyMs: 0, now: () => 1 })

    try {
      await repository.createProduct({
        name: 'Restart recovery product',
        nameAr: '',
        description: '',
        descriptionAr: '',
        price: 275,
        categoryId: seed.categories[0].id,
        availability: 'available',
        stock: 1,
        lowStockThreshold: 1,
      })
      engine.syncNow()
      await waitForIdle(engine)
      const persistedCursor = JSON.parse(storage.getItem('syncdesk.sync.v1') ?? '{}').cursor
      await firstBackend.close()

      const secondBackend = await startBackendServer({ port: 0, store })
      try {
        const restartedClient = new BackendApiClient(`http://127.0.0.1:${secondBackend.port}`)
        const restartedEngine = new SyncEngine({
          storage,
          replicaId: 'browser-recovery',
          connectMs: 0,
          syncMs: 0,
          autoSyncDelayMs: 0,
          isAutoSyncEnabled: () => false,
          backendClient: restartedClient,
        })
        const restartedRepository = new MockRepository(restartedEngine, storage, seed, { latencyMs: 0, now: () => 1 })
        restartedEngine.syncNow()
        await waitForIdle(restartedEngine)
        expect(persistedCursor).toBeGreaterThan(0)
        expect(await restartedRepository.getProducts()).toEqual(await repository.getProducts())
        restartedEngine.dispose()
      } finally {
        await secondBackend.close()
      }
    } finally {
      engine.dispose()
    }
  })
})
