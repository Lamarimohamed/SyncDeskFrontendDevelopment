import { request } from 'node:http'
import { describe, expect, it } from 'vitest'
import type { VersionedRetailOperation } from '@/domain/retailSync'
import { createMemoryStorage } from '@/lib/storage'
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
})
