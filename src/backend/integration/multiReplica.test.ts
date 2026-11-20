import { request } from 'node:http'
import { describe, expect, it } from 'vitest'
import { buildSeed } from '@/data/seed'
import type { VersionedRetailOperation } from '@/domain/retailSync'
import { createMemoryStorage } from '@/lib/storage'
import { MockRepository } from '@/repositories/MockRepository'
import { BackendApiClient } from '@/services/backendApi'
import { SyncEngine } from '@/services/sync/SyncEngine'
import { VersionedRetailRuntime } from '../sync/versionedRetailRuntime'
import { startBackendServer } from '../api/server'

const httpRequest = (port: number, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> =>
  new Promise((resolve, reject) => {
    const encoded = body === undefined ? undefined : JSON.stringify(body)
    const client = request(
      { host: '127.0.0.1', port, method, path, headers: encoded ? { 'content-type': 'application/json' } : undefined },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString()) }))
      },
    )
    client.on('error', reject)
    client.end(encoded)
  })

const product = {
  id: 'p-integration',
  name: 'Coffee',
  nameAr: '',
  description: 'Original',
  descriptionAr: '',
  price: 100,
  categoryId: 'c-drinks',
  availability: 'available' as const,
  stock: 1,
  lowStockThreshold: 1,
  updatedAt: 1,
}

const restore: VersionedRetailOperation = {
  schemaVersion: 2,
  operationId: 'integration-restore',
  replicaId: 'seed',
  version: { logicalTime: 1, replicaId: 'seed', operationId: 'integration-restore' },
  kind: 'product.restore',
  productId: product.id,
  product,
}

const patch = (
  operationId: string,
  replicaId: string,
  changes: { name?: string; price?: number },
): VersionedRetailOperation => ({
  schemaVersion: 2,
  operationId,
  replicaId,
  version: { logicalTime: 2, replicaId, operationId },
  kind: 'product.patch',
  productId: product.id,
  changes,
})

describe('multi-replica backend-mediated synchronization', () => {
  it('completes catalog creation, update, referential rejection, and convergence', async () => {
    const backend = await startBackendServer({ port: 0, replicaId: 'catalog-server' })
    const category: VersionedRetailOperation = {
      schemaVersion: 2,
      operationId: 'catalog-category',
      replicaId: 'replica-a',
      version: { logicalTime: 1, replicaId: 'replica-a', operationId: 'catalog-category' },
      kind: 'category.patch',
      categoryId: 'c-catalog',
      changes: { name: 'Drinks', nameAr: '', description: 'Beverages' },
    }
    const restore: VersionedRetailOperation = {
      schemaVersion: 2,
      operationId: 'catalog-product',
      replicaId: 'replica-a',
      version: { logicalTime: 2, replicaId: 'replica-a', operationId: 'catalog-product' },
      kind: 'product.restore',
      productId: 'p-catalog',
      product: { ...product, id: 'p-catalog', categoryId: 'c-catalog' },
    }
    const update: VersionedRetailOperation = {
      schemaVersion: 2,
      operationId: 'catalog-update',
      replicaId: 'replica-b',
      version: { logicalTime: 3, replicaId: 'replica-b', operationId: 'catalog-update' },
      kind: 'product.patch',
      productId: 'p-catalog',
      changes: { price: 125 },
    }
    try {
      const pushed = await httpRequest(backend.port, 'POST', '/v1/sync/operations', { operations: [category, restore, update] })
      expect(pushed.body.accepted).toBe(3)

      const blockedDelete = await httpRequest(backend.port, 'POST', '/v1/sync/operations', {
        operations: [{
          schemaVersion: 2,
          operationId: 'catalog-blocked-delete',
          replicaId: 'replica-b',
          version: { logicalTime: 4, replicaId: 'replica-b', operationId: 'catalog-blocked-delete' },
          kind: 'category.delete',
          categoryId: 'c-catalog',
        }],
      })
      expect(blockedDelete.status).toBe(400)

      const replicas = [new VersionedRetailRuntime(), new VersionedRetailRuntime()]
      const page = await httpRequest(backend.port, 'GET', '/v1/sync/operations?after=0&limit=100')
      for (const replica of replicas)
        for (const entry of page.body.operations as Array<{ operation: VersionedRetailOperation }>) replica.apply(entry.operation)
      expect(replicas[0].catalog()).toEqual(replicas[1].catalog())
      expect(replicas[0].catalog().products[0]).toMatchObject({ categoryId: 'c-catalog', price: 125 })

      const deleteProduct: VersionedRetailOperation = {
        schemaVersion: 2,
        operationId: 'catalog-delete-product',
        replicaId: 'replica-a',
        version: { logicalTime: 5, replicaId: 'replica-a', operationId: 'catalog-delete-product' },
        kind: 'product.delete',
        productId: 'p-catalog',
      }
      const deleteCategory: VersionedRetailOperation = {
        schemaVersion: 2,
        operationId: 'catalog-delete-category',
        replicaId: 'replica-a',
        version: { logicalTime: 6, replicaId: 'replica-a', operationId: 'catalog-delete-category' },
        kind: 'category.delete',
        categoryId: 'c-catalog',
      }
      expect((await httpRequest(backend.port, 'POST', '/v1/sync/operations', { operations: [deleteProduct, deleteCategory] })).body.accepted).toBe(2)
      const finalPage = await httpRequest(backend.port, 'GET', '/v1/sync/operations?after=3&limit=100')
      for (const replica of replicas)
        for (const entry of finalPage.body.operations as Array<{ operation: VersionedRetailOperation }>) replica.apply(entry.operation)
      expect(replicas[0].catalog()).toEqual({ products: [], categories: [] })
    } finally {
      await backend.close()
    }
  })

  it('propagates the canonical stock outcome through SyncEngine state', async () => {
    const backend = await startBackendServer({ port: 0, replicaId: 'outcome-server' })
    const client = new BackendApiClient(`http://127.0.0.1:${backend.port}`)
    const engine = new SyncEngine({
      storage: createMemoryStorage(),
      replicaId: 'replica-outcome',
      deviceId: 'device-outcome',
      backendClient: client,
      syncMs: 1,
      autoSyncDelayMs: 1,
      isAutoSyncEnabled: () => false,
    })
    const restore: VersionedRetailOperation = {
      schemaVersion: 2,
      operationId: 'outcome-restore',
      replicaId: 'seed',
      version: { logicalTime: 1, replicaId: 'seed', operationId: 'outcome-restore' },
      kind: 'product.restore',
      productId: 'p-outcome',
      product: { ...product, id: 'p-outcome', stock: 0 },
    }
    try {
      await client.pushVersionedOperations([restore])
      engine.enqueue({
        kind: 'stock.adjust',
        entityType: 'stock',
        entityId: 'p-outcome',
        entityLabel: 'Coffee',
        summary: 'Stock +1 (restock)',
        field: 'stock',
        crdt: 'PN-Counter',
        discardable: false,
        retailOperation: { operationId: 'outcome-restock', kind: 'inventory.restock', productId: 'p-outcome', tokenIds: ['outcome-token'] },
      })
      engine.syncNow()
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('stock outcome was not received')), 1000)
        const unsubscribe = engine.subscribe(() => {
          if (engine.getSnapshot().latestStockOutcome?.operationId === 'outcome-restock') {
            clearTimeout(timeout)
            unsubscribe()
            resolve()
          }
        })
      })
      expect(engine.getSnapshot().latestStockOutcome).toMatchObject({ operationId: 'outcome-restock', status: 'applied' })
    } finally {
      engine.dispose()
      await backend.close()
    }
  })

  it('registers independent replicas and converges concurrent catalog edits', async () => {
    const backend = await startBackendServer({ port: 0, replicaId: 'integration-server' })
    try {
      expect((await httpRequest(backend.port, 'POST', '/v1/sync/operations', { operations: [restore] })).status).toBe(200)
      const registrations = await Promise.all([
        httpRequest(backend.port, 'POST', '/v1/bootstrap', { replicaId: 'replica-a' }),
        httpRequest(backend.port, 'POST', '/v1/bootstrap', { replicaId: 'replica-b' }),
      ])
      expect(registrations.every(({ status }) => status === 200)).toBe(true)
      expect(registrations[1].body.initialization.registeredReplicaCount).toBe(2)

      const operations = [patch('name-a', 'replica-a', { name: 'Premium' }), patch('price-b', 'replica-b', { price: 120 })]
      const pushed = await httpRequest(backend.port, 'POST', '/v1/sync/operations', { operations })
      expect(pushed.body.results.map((result: { status: string }) => result.status)).toEqual(['accepted', 'accepted'])

      const page = await httpRequest(backend.port, 'GET', '/v1/sync/operations?after=0&limit=100')
      const replicaStates = ['replica-a', 'replica-b'].map(() => new VersionedRetailRuntime())
      for (const state of replicaStates)
        for (const entry of page.body.operations as Array<{ operation: VersionedRetailOperation }>) state.apply(entry.operation)

      expect(replicaStates[0].catalog()).toEqual(replicaStates[1].catalog())
      expect(replicaStates[0].catalog().products[0]).toMatchObject({ name: 'Premium', price: 120 })
    } finally {
      await backend.close()
    }
  })

  it('retries duplicate delivery and advances a cursor only after applying a page', async () => {
    const backend = await startBackendServer({ port: 0 })
    try {
      const operations = [restore, patch('retry-name', 'replica-a', { name: 'Retry' })]
      const first = await httpRequest(backend.port, 'POST', '/v1/sync/operations', { operations })
      expect(first.body.accepted).toBe(2)
      const replica = new VersionedRetailRuntime()
      const firstPage = await httpRequest(backend.port, 'GET', '/v1/sync/operations?after=0&limit=1')
      for (const entry of firstPage.body.operations) replica.apply(entry.operation)
      const retry = await httpRequest(backend.port, 'GET', '/v1/sync/operations?after=0&limit=1')
      for (const entry of retry.body.operations) replica.apply(entry.operation)
      expect(replica.operationIds()).toEqual(['integration-restore'])

      const secondPage = await httpRequest(backend.port, 'GET', `/v1/sync/operations?after=${firstPage.body.nextCursor}&limit=10`)
      for (const entry of secondPage.body.operations) replica.apply(entry.operation)
      expect(replica.catalog().products[0].name).toBe('Retry')
      const duplicate = await httpRequest(backend.port, 'POST', '/v1/sync/operations', { operations: [operations[1]] })
      expect(duplicate.body.results[0].status).toBe('duplicate')
    } finally {
      await backend.close()
    }
  })

  it('converges product delete, restore, and subsequent patches across MockRepository replicas and restart (CRDT-1)', async () => {
    const backend = await startBackendServer({ port: 0, replicaId: 'crdt1-server' })
    const client = new BackendApiClient(`http://127.0.0.1:${backend.port}`)
    const seed = buildSeed(1)
    const storageA = createMemoryStorage()
    const storageB = createMemoryStorage()
    const engineA = new SyncEngine({
      storage: storageA,
      replicaId: 'replica-a',
      deviceId: 'device-a',
      connectMs: 0,
      syncMs: 0,
      isAutoSyncEnabled: () => false,
      backendClient: client,
    })
    const engineB = new SyncEngine({
      storage: storageB,
      replicaId: 'replica-b',
      deviceId: 'device-b',
      connectMs: 0,
      syncMs: 0,
      isAutoSyncEnabled: () => false,
      backendClient: client,
    })
    const repoA = new MockRepository(engineA, storageA, seed, { latencyMs: 0, now: () => 1 })
    const repoB = new MockRepository(engineB, storageB, seed, { latencyMs: 0, now: () => 1 })

    const syncReplica = async (engine: SyncEngine) => {
      engine.syncNow()
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('sync timed out')), 1500)
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

    try {
      // Replica A deletes p-coffee, syncs; then restores p-coffee, syncs
      const deleted = await repoA.deleteProduct('p-coffee')
      await syncReplica(engineA)
      await syncReplica(engineB)
      expect((await repoB.getProducts()).some((item) => item.id === 'p-coffee')).toBe(false)

      await repoA.restoreProduct(deleted)
      await syncReplica(engineA)
      await syncReplica(engineB)
      expect((await repoB.getProduct('p-coffee')).name).toBe(deleted.name)

      // Replica A now patches the restored product's price and name
      await repoA.updateProduct('p-coffee', { ...deleted, name: 'Restored & Patched Coffee', price: 330 })
      await syncReplica(engineA)

      // Restart Replica B from persisted storage before pulling the patch
      engineB.dispose()
      const restartedEngineB = new SyncEngine({
        storage: storageB,
        replicaId: 'replica-b',
        deviceId: 'device-b',
        connectMs: 0,
        syncMs: 0,
        isAutoSyncEnabled: () => false,
        backendClient: client,
      })
      const restartedRepoB = new MockRepository(restartedEngineB, storageB, seed, { latencyMs: 0, now: () => 1 })
      try {
        await syncReplica(restartedEngineB)
        expect(await restartedRepoB.getProduct('p-coffee')).toMatchObject({
          name: 'Restored & Patched Coffee',
          price: 330,
        })
        expect(await restartedRepoB.getProducts()).toEqual(await repoA.getProducts())
      } finally {
        restartedEngineB.dispose()
      }
    } finally {
      engineA.dispose()
      engineB.dispose()
      await backend.close()
    }
  })

  it('converges category delete and patch permutations across independent MockRepository replicas without resurrecting deleted categories (CRDT-2)', async () => {
    const seed = buildSeed(1)
    const createOp: VersionedRetailOperation = {
      schemaVersion: 2,
      operationId: 'cat-op-create',
      replicaId: 'replica-a',
      version: { logicalTime: 1, replicaId: 'replica-a', operationId: 'cat-op-create' },
      kind: 'category.patch',
      categoryId: 'c-new',
      changes: { name: 'Seasonal', nameAr: '', description: 'Winter' },
    }
    const stalePatchOp: VersionedRetailOperation = {
      schemaVersion: 2,
      operationId: 'cat-op-stale-patch',
      replicaId: 'replica-b',
      version: { logicalTime: 2, replicaId: 'replica-b', operationId: 'cat-op-stale-patch' },
      kind: 'category.patch',
      categoryId: 'c-new',
      changes: { description: 'Stale description' },
    }
    const deleteOp: VersionedRetailOperation = {
      schemaVersion: 2,
      operationId: 'cat-op-delete',
      replicaId: 'replica-a',
      version: { logicalTime: 3, replicaId: 'replica-a', operationId: 'cat-op-delete' },
      kind: 'category.delete',
      categoryId: 'c-new',
    }

    const storageAB = createMemoryStorage()
    const storageBA = createMemoryStorage()
    const engineAB = new SyncEngine({ storage: storageAB, replicaId: 'rep-ab', deviceId: 'dev-ab', isAutoSyncEnabled: () => false })
    const engineBA = new SyncEngine({ storage: storageBA, replicaId: 'rep-ba', deviceId: 'dev-ba', isAutoSyncEnabled: () => false })
    const repoAB = new MockRepository(engineAB, storageAB, seed, { latencyMs: 0 })
    const repoBA = new MockRepository(engineBA, storageBA, seed, { latencyMs: 0 })

    try {
      const applyTo = (repo: MockRepository, op: VersionedRetailOperation) =>
        (repo as unknown as { applyVersionedOperation: (o: VersionedRetailOperation, s: 'remote') => boolean }).applyVersionedOperation(op, 'remote')

      // Replica AB receives: create -> stalePatch -> delete -> duplicate delete
      applyTo(repoAB, createOp)
      applyTo(repoAB, stalePatchOp)
      applyTo(repoAB, deleteOp)
      applyTo(repoAB, deleteOp)

      // Replica BA receives: create -> delete -> stalePatch (out-of-order!) -> duplicate stalePatch
      applyTo(repoBA, createOp)
      applyTo(repoBA, deleteOp)
      applyTo(repoBA, stalePatchOp)
      applyTo(repoBA, stalePatchOp)

      expect((await repoAB.getCategories()).some((cat) => cat.id === 'c-new')).toBe(false)
      expect((await repoBA.getCategories()).some((cat) => cat.id === 'c-new')).toBe(false)
      expect(await repoAB.getCategories()).toEqual(await repoBA.getCategories())
    } finally {
      engineAB.dispose()
      engineBA.dispose()
    }
  })

  it('does not advance cursor or mark remote category.delete applied when blocked by local referential integrity, and applies it after resolution (CRDT-3)', async () => {
    const backend = await startBackendServer({ port: 0, replicaId: 'crdt3-server' })
    const client = new BackendApiClient(`http://127.0.0.1:${backend.port}`)
    const seed = buildSeed(1)
    const storage = createMemoryStorage()
    const engine = new SyncEngine({
      storage,
      replicaId: 'replica-crdt3',
      deviceId: 'device-crdt3',
      connectMs: 0,
      syncMs: 0,
      isAutoSyncEnabled: () => false,
      backendClient: client,
    })
    const repo = new MockRepository(engine, storage, seed, { latencyMs: 0, now: () => 1 })

    try {
      // Server creates and then deletes an unreferenced category 'c-drinks' on the server
      // while the local replica still has local products in 'c-drinks'.
      await client.pushVersionedOperations([
        {
          schemaVersion: 2,
          operationId: 'server-cat-create',
          replicaId: 'server',
          version: { logicalTime: 1, replicaId: 'server', operationId: 'server-cat-create' },
          kind: 'category.patch',
          categoryId: 'c-drinks',
          changes: { name: 'Drinks', nameAr: '', description: '' },
        },
        {
          schemaVersion: 2,
          operationId: 'server-cat-delete',
          replicaId: 'server',
          version: { logicalTime: 2, replicaId: 'server', operationId: 'server-cat-delete' },
          kind: 'category.delete',
          categoryId: 'c-drinks',
        },
      ])

      // Local replica attempts to pull: operation 1 succeeds, operation 2 ('server-cat-delete') is rejected
      engine.syncNow()
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('expected sync error')), 1500)
        const check = () => {
          if (engine.getSnapshot().phase === 'error') {
            clearTimeout(timeout)
            resolve()
          }
        }
        engine.subscribe(check)
        check()
      })

      const persistedSync = JSON.parse(storage.getItem('syncdesk.sync.v1') ?? '{}')
      expect(persistedSync.cursor).toBe(1)
      expect(persistedSync.appliedOperationIds).toContain('server-cat-create')
      expect(persistedSync.appliedOperationIds).not.toContain('server-cat-delete')
      expect((await repo.getCategories()).some((cat) => cat.id === 'c-drinks')).toBe(true)

      // Now move/delete local products referencing 'c-drinks', clear pending local queue so we only test the pull retry
      const localDrinkProducts = (await repo.getProducts()).filter((p) => p.categoryId === 'c-drinks')
      for (const prod of localDrinkProducts) {
        await repo.deleteProduct(prod.id)
      }
      engine.clearPending()

      // Retry pull: cursor resumes from position 1 and now applies 'server-cat-delete' at position 2
      engine.syncNow()
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('expected sync idle')), 1500)
        const check = () => {
          if (engine.getSnapshot().phase === 'idle') {
            clearTimeout(timeout)
            resolve()
          }
        }
        engine.subscribe(check)
        check()
      })

      const afterSync = JSON.parse(storage.getItem('syncdesk.sync.v1') ?? '{}')
      expect(afterSync.cursor).toBe(2)
      expect(afterSync.appliedOperationIds).toContain('server-cat-delete')
      expect((await repo.getCategories()).some((cat) => cat.id === 'c-drinks')).toBe(false)
    } finally {
      engine.dispose()
      await backend.close()
    }
  })

  it('preserves head-of-line blocked cursor across client restart while blocked, and advances after reference resolution', async () => {
    const backend = await startBackendServer({ port: 0, replicaId: 'hol-server' })
    const client = new BackendApiClient(`http://127.0.0.1:${backend.port}`)
    const seed = buildSeed(1)
    const storage = createMemoryStorage()
    const engine1 = new SyncEngine({
      storage,
      replicaId: 'replica-hol',
      deviceId: 'device-hol',
      connectMs: 0,
      syncMs: 0,
      isAutoSyncEnabled: () => false,
      backendClient: client,
    })
    new MockRepository(engine1, storage, seed, { latencyMs: 0, now: () => 1 })

    try {
      await client.pushVersionedOperations([
        {
          schemaVersion: 2,
          operationId: 'hol-cat-create',
          replicaId: 'server',
          version: { logicalTime: 1, replicaId: 'server', operationId: 'hol-cat-create' },
          kind: 'category.patch',
          categoryId: 'c-drinks',
          changes: { name: 'Drinks', nameAr: '', description: '' },
        },
        {
          schemaVersion: 2,
          operationId: 'hol-cat-delete',
          replicaId: 'server',
          version: { logicalTime: 2, replicaId: 'server', operationId: 'hol-cat-delete' },
          kind: 'category.delete',
          categoryId: 'c-drinks',
        },
        {
          schemaVersion: 2,
          operationId: 'hol-other-patch',
          replicaId: 'server',
          version: { logicalTime: 3, replicaId: 'server', operationId: 'hol-other-patch' },
          kind: 'category.patch',
          categoryId: 'c-bakery',
          changes: { name: 'Bakery Updated', nameAr: '', description: 'After blocked delete' },
        },
      ])

      // 1. First sync blocks at position 2 ('hol-cat-delete'); cursor stays at 1
      engine1.syncNow()
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('expected sync error')), 1500)
        const check = () => {
          if (engine1.getSnapshot().phase === 'error') {
            clearTimeout(timeout)
            resolve()
          }
        }
        engine1.subscribe(check)
        check()
      })
      expect(JSON.parse(storage.getItem('syncdesk.sync.v1') ?? '{}').cursor).toBe(1)
      engine1.dispose()

      // 2. Restart client while operation 2 is still blocked
      const engine2 = new SyncEngine({
        storage,
        replicaId: 'replica-hol',
        deviceId: 'device-hol',
        connectMs: 0,
        syncMs: 0,
        isAutoSyncEnabled: () => false,
        backendClient: client,
      })
      const repo2 = new MockRepository(engine2, storage, seed, { latencyMs: 0, now: () => 1 })
      try {
        // Still blocked on retry before resolution
        engine2.syncNow()
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('expected sync error after restart')), 1500)
          const check = () => {
            if (engine2.getSnapshot().phase === 'error') {
              clearTimeout(timeout)
              resolve()
            }
          }
          engine2.subscribe(check)
          check()
        })
        expect(JSON.parse(storage.getItem('syncdesk.sync.v1') ?? '{}').cursor).toBe(1)

        // 3. Resolve local referencing products by reassigning them to 'c-bakery'
        const drinkProducts = (await repo2.getProducts()).filter((p) => p.categoryId === 'c-drinks')
        for (const prod of drinkProducts) {
          await repo2.updateProduct(prod.id, { ...prod, categoryId: 'c-bakery' })
        }
        // Clear pending local queue so we isolate the pull recovery of positions 2 and 3
        engine2.clearPending()

        engine2.syncNow()
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('expected sync idle after resolution')), 1500)
          const check = () => {
            if (engine2.getSnapshot().phase === 'idle') {
              clearTimeout(timeout)
              resolve()
            }
          }
          engine2.subscribe(check)
          check()
        })

        const finalSync = JSON.parse(storage.getItem('syncdesk.sync.v1') ?? '{}')
        expect(finalSync.cursor).toBe(3)
        expect(finalSync.appliedOperationIds).toEqual(
          expect.arrayContaining(['hol-cat-create', 'hol-cat-delete', 'hol-other-patch']),
        )
        expect((await repo2.getCategories()).some((cat) => cat.id === 'c-drinks')).toBe(false)
        expect((await repo2.getCategories()).find((cat) => cat.id === 'c-bakery')?.name).toBe('Bakery Updated')
      } finally {
        engine2.dispose()
      }
    } finally {
      engine1.dispose()
      await backend.close()
    }
  })

  it('converges three independent offline clients editing products and categories concurrently after reconnection', async () => {
    const backend = await startBackendServer({ port: 0, replicaId: 'three-client-hub' })
    const seed = buildSeed(1)

    const createClientStack = (replicaId: string, deviceId: string) => {
      const storage = createMemoryStorage()
      const client = new BackendApiClient(`http://127.0.0.1:${backend.port}`)
      const engine = new SyncEngine({
        storage,
        replicaId,
        deviceId,
        connectMs: 0,
        syncMs: 0,
        autoSyncDelayMs: 0,
        isAutoSyncEnabled: () => false,
        backendClient: client,
      })
      const repo = new MockRepository(engine, storage, seed, { latencyMs: 0, now: () => 1 })
      return { storage, client, engine, repo }
    }

    const syncClient = async (engine: SyncEngine) => {
      engine.syncNow()
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`sync timed out for ${engine.replicaId}`)), 1500)
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

    const clientA = createClientStack('client-a', 'dev-a')
    const clientB = createClientStack('client-b', 'dev-b')
    const clientC = createClientStack('client-c', 'dev-c')

    try {
      // All three clients go offline and perform concurrent mutations
      clientA.engine.goOffline()
      clientB.engine.goOffline()
      clientC.engine.goOffline()

      // Client A edits p-coffee name and c-drinks name
      const coffeeA = await clientA.repo.getProduct('p-coffee')
      await clientA.repo.updateProduct('p-coffee', { ...coffeeA, name: 'Arabica Roast' })
      const drinksA = (await clientA.repo.getCategories()).find((c) => c.id === 'c-drinks')!
      await clientA.repo.updateCategory('c-drinks', {
        name: 'Artisan Drinks',
        nameAr: drinksA.nameAr,
        description: drinksA.description,
      })

      // Client B edits p-coffee price (different product field) and c-drinks description (different category field)
      const coffeeB = await clientB.repo.getProduct('p-coffee')
      await clientB.repo.updateProduct('p-coffee', { ...coffeeB, price: 240 })
      const drinksB = (await clientB.repo.getCategories()).find((c) => c.id === 'c-drinks')!
      await clientB.repo.updateCategory('c-drinks', {
        name: drinksB.name,
        nameAr: drinksB.nameAr,
        description: 'Hot and cold specialty beverages',
      })

      // Client C edits p-coffee price (same-field conflict with B; C > B tie-break at equal logicalTime) and creates a new product
      const coffeeC = await clientC.repo.getProduct('p-coffee')
      await clientC.repo.updateProduct('p-coffee', { ...coffeeC, price: 260, lowStockThreshold: 4 })
      const createdByC = await clientC.repo.createProduct({
        name: 'Cardamom Tea',
        nameAr: 'شاي بالهيل',
        description: 'Spiced tea',
        descriptionAr: '',
        price: 150,
        categoryId: 'c-drinks',
        availability: 'available',
        stock: 5,
        lowStockThreshold: 2,
      })

      // Reconnect all three clients and synchronize two rounds so all pushes and pulls complete
      clientA.engine.goOnline()
      clientB.engine.goOnline()
      clientC.engine.goOnline()
      await syncClient(clientA.engine)
      await syncClient(clientB.engine)
      await syncClient(clientC.engine)
      await syncClient(clientA.engine)
      await syncClient(clientB.engine)
      await syncClient(clientC.engine)

      const productsA = (await clientA.repo.getProducts()).sort((x, y) => x.id.localeCompare(y.id))
      const productsB = (await clientB.repo.getProducts()).sort((x, y) => x.id.localeCompare(y.id))
      const productsC = (await clientC.repo.getProducts()).sort((x, y) => x.id.localeCompare(y.id))
      expect(productsA).toEqual(productsB)
      expect(productsB).toEqual(productsC)

      const mergedCoffee = productsA.find((p) => p.id === 'p-coffee')!
      expect(mergedCoffee).toMatchObject({
        name: 'Arabica Roast',
        price: 260,
        lowStockThreshold: 4,
      })
      expect(productsA.some((p) => p.id === createdByC.id)).toBe(true)

      const catsA = (await clientA.repo.getCategories()).sort((x, y) => x.id.localeCompare(y.id))
      const catsB = (await clientB.repo.getCategories()).sort((x, y) => x.id.localeCompare(y.id))
      const catsC = (await clientC.repo.getCategories()).sort((x, y) => x.id.localeCompare(y.id))
      expect(catsA).toEqual(catsB)
      expect(catsB).toEqual(catsC)
      expect(catsA.find((c) => c.id === 'c-drinks')).toMatchObject({
        name: 'Artisan Drinks',
        description: 'Hot and cold specialty beverages',
      })
    } finally {
      clientA.engine.dispose()
      clientB.engine.dispose()
      clientC.engine.dispose()
      await backend.close()
    }
  })

  it('converges stock allocation, peer transfer, and decrement across independent client stacks', async () => {
    const { initializeBackendBootstrap } = await import('@/services/container')
    const backend = await startBackendServer({ port: 0, replicaId: 'stock-hub' })
    const seed = buildSeed(1)
    const serverProduct = { ...seed.products[0], id: 'p-coffee', stock: 4 }
    const seedClient = new BackendApiClient(`http://127.0.0.1:${backend.port}`)
    await seedClient.pushVersionedOperations([
      {
        schemaVersion: 2,
        operationId: 'seed-stock-product',
        replicaId: 'stock-hub',
        version: { logicalTime: 1, replicaId: 'stock-hub', operationId: 'seed-stock-product' },
        kind: 'product.restore',
        productId: serverProduct.id,
        product: serverProduct,
      },
    ])

    const storageA = createMemoryStorage()
    const storageB = createMemoryStorage()
    const clientA = new BackendApiClient(`http://127.0.0.1:${backend.port}`)
    const clientB = new BackendApiClient(`http://127.0.0.1:${backend.port}`)
    const engineA = new SyncEngine({
      storage: storageA,
      replicaId: 'client-stock-a',
      deviceId: 'dev-stock-a',
      connectMs: 0,
      syncMs: 0,
      isAutoSyncEnabled: () => false,
      backendClient: clientA,
    })
    const engineB = new SyncEngine({
      storage: storageB,
      replicaId: 'client-stock-b',
      deviceId: 'dev-stock-b',
      connectMs: 0,
      syncMs: 0,
      isAutoSyncEnabled: () => false,
      backendClient: clientB,
    })
    const repoA = new MockRepository(engineA, storageA, { ...seed, products: [serverProduct] }, { latencyMs: 0, now: () => 1 })
    const repoB = new MockRepository(engineB, storageB, { ...seed, products: [serverProduct] }, { latencyMs: 0, now: () => 1 })

    const syncClient = async (engine: SyncEngine) => {
      engine.syncNow()
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`sync timed out for ${engine.replicaId}`)), 1500)
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

    try {
      // Client A bootstraps first and is allocated all 4 stock rights; Client B bootstraps second and gets 0
      await initializeBackendBootstrap(clientA, engineA, repoA)
      await initializeBackendBootstrap(clientB, engineB, repoB)
      expect(repoA.getAvailableStockRights('p-coffee', 'client-stock-a')).toBe(4)
      expect(repoB.getAvailableStockRights('p-coffee', 'client-stock-b')).toBe(0)

      // Client B cannot decrement before receiving transferred rights
      await expect(
        repoB.adjustStock({ productId: 'p-coffee', type: 'remove', quantity: 1, reason: 'sale', notes: '' }),
      ).rejects.toThrow('no escrow rights')

      // Client A decrements 1 unit and transfers 2 rights to Client B
      await repoA.adjustStock({ productId: 'p-coffee', type: 'remove', quantity: 1, reason: 'sale', notes: 'A sale' })
      await repoA.transferStockRights('p-coffee', 'client-stock-b', 2, 'tx-a-to-b')
      expect(repoA.getAvailableStockRights('p-coffee', 'client-stock-a')).toBe(1)

      await syncClient(engineA)
      await syncClient(engineB)

      // Client B now has 2 available rights and total stock is 3
      expect((await repoB.getProduct('p-coffee')).stock).toBe(3)
      expect(repoB.getAvailableStockRights('p-coffee', 'client-stock-b')).toBe(2)

      // Client B decrements 2 units using its transferred rights and syncs back
      await repoB.adjustStock({ productId: 'p-coffee', type: 'remove', quantity: 2, reason: 'sale', notes: 'B sale' })
      await syncClient(engineB)
      await syncClient(engineA)

      expect((await repoA.getProduct('p-coffee')).stock).toBe(1)
      expect((await repoB.getProduct('p-coffee')).stock).toBe(1)
      expect(repoA.getAvailableStockRights('p-coffee', 'client-stock-a')).toBe(1)
      expect(repoB.getAvailableStockRights('p-coffee', 'client-stock-b')).toBe(0)
    } finally {
      engineA.dispose()
      engineB.dispose()
      await backend.close()
    }
  })

  it('converges when SyncEngine receives out-of-order and duplicate operation pages across client and server restarts', async () => {
    const backend = await startBackendServer({ port: 0, replicaId: 'reorder-hub' })
    const seed = buildSeed(1)
    const baseClient = new BackendApiClient(`http://127.0.0.1:${backend.port}`)

    // Push 3 operations to the server: create category, update category description, delete category
    const opCreate: VersionedRetailOperation = {
      schemaVersion: 2,
      operationId: 'http-cat-create',
      replicaId: 'origin-a',
      version: { logicalTime: 1, replicaId: 'origin-a', operationId: 'http-cat-create' },
      kind: 'category.patch',
      categoryId: 'c-temp',
      changes: { name: 'Temporary Category', nameAr: '', description: 'Initial' },
    }
    const opPatch: VersionedRetailOperation = {
      schemaVersion: 2,
      operationId: 'http-cat-patch',
      replicaId: 'origin-b',
      version: { logicalTime: 2, replicaId: 'origin-b', operationId: 'http-cat-patch' },
      kind: 'category.patch',
      categoryId: 'c-temp',
      changes: { description: 'Updated before delete' },
    }
    const opDelete: VersionedRetailOperation = {
      schemaVersion: 2,
      operationId: 'http-cat-delete',
      replicaId: 'origin-a',
      version: { logicalTime: 3, replicaId: 'origin-a', operationId: 'http-cat-delete' },
      kind: 'category.delete',
      categoryId: 'c-temp',
    }
    await baseClient.pushVersionedOperations([opCreate, opPatch, opDelete])

    // Client 1 pulls in normal order; Client 2 receives reordered + duplicated entries from pullVersionedOperations
    const storage1 = createMemoryStorage()
    const storage2 = createMemoryStorage()
    const reorderedClient = new BackendApiClient(`http://127.0.0.1:${backend.port}`)
    const originalPull = reorderedClient.pullVersionedOperations.bind(reorderedClient)
    reorderedClient.pullVersionedOperations = async (after, limit) => {
      const page = await originalPull(after, limit)
      if (page.operations.length === 3) {
        return {
          ...page,
          // Deliver create (v=1), then delete (v=3), then stale patch (v=2), plus duplicates
          operations: [page.operations[0], page.operations[2], page.operations[1], page.operations[2], page.operations[1]],
        }
      }
      return page
    }

    const engine1 = new SyncEngine({
      storage: storage1,
      replicaId: 'normal-order-client',
      deviceId: 'dev-1',
      connectMs: 0,
      syncMs: 0,
      isAutoSyncEnabled: () => false,
      backendClient: baseClient,
    })
    const engine2 = new SyncEngine({
      storage: storage2,
      replicaId: 'reordered-client',
      deviceId: 'dev-2',
      connectMs: 0,
      syncMs: 0,
      isAutoSyncEnabled: () => false,
      backendClient: reorderedClient,
    })
    const repo1 = new MockRepository(engine1, storage1, seed, { latencyMs: 0, now: () => 1 })
    const repo2 = new MockRepository(engine2, storage2, seed, { latencyMs: 0, now: () => 1 })

    try {
      for (const eng of [engine1, engine2]) {
        eng.syncNow()
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('pull sync timed out')), 1500)
          const check = () => {
            if (eng.getSnapshot().phase === 'idle') {
              clearTimeout(timeout)
              resolve()
            }
          }
          eng.subscribe(check)
          check()
        })
      }

      expect((await repo1.getCategories()).some((c) => c.id === 'c-temp')).toBe(false)
      expect((await repo2.getCategories()).some((c) => c.id === 'c-temp')).toBe(false)
      expect(await repo1.getCategories()).toEqual(await repo2.getCategories())
    } finally {
      engine1.dispose()
      engine2.dispose()
      await backend.close()
    }
  })
})
