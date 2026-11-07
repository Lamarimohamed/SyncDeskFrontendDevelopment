import { request } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFileBackedStore, startBackendServer } from '../api/server'

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

describe('file-backed backend recovery', () => {
  it('recovers catalog, tombstones, stock state, registrations, and operation identity', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'syncdesk-recovery-'))
    const path = join(directory, 'backend.json')
    const restore = {
      schemaVersion: 2,
      operationId: 'recovery-restore',
      replicaId: 'replica-a',
      version: { logicalTime: 1, replicaId: 'replica-a', operationId: 'recovery-restore' },
      kind: 'product.restore',
      productId: 'p-recovery',
      product: {
        id: 'p-recovery',
        name: 'Recovery',
        nameAr: '',
        description: '',
        descriptionAr: '',
        price: 10,
        categoryId: 'c',
        availability: 'available',
        stock: 2,
        lowStockThreshold: 1,
        updatedAt: 1,
      },
    }
    const deletion = {
      schemaVersion: 2,
      operationId: 'recovery-delete',
      replicaId: 'replica-a',
      version: { logicalTime: 2, replicaId: 'replica-a', operationId: 'recovery-delete' },
      kind: 'product.delete',
      productId: 'p-recovery',
    }
    try {
      const first = await startBackendServer({ port: 0, store: createFileBackedStore(path), replicaId: 'recovery-server' })
      await httpRequest(first.port, 'POST', '/v1/sync/operations', { operations: [restore, deletion] })
      await httpRequest(first.port, 'POST', '/v1/bootstrap', { replicaId: 'browser-a' })
      await first.close()

      const restarted = await startBackendServer({ port: 0, store: createFileBackedStore(path), replicaId: 'recovery-server' })
      try {
        const bootstrap = await httpRequest(restarted.port, 'GET', '/v1/bootstrap')
        const catalog = await httpRequest(restarted.port, 'GET', '/v1/sync/catalog')
        const replay = await httpRequest(restarted.port, 'POST', '/v1/sync/operations', { operations: [deletion] })
        expect(bootstrap.body.backendReplicaId).toBe('recovery-server')
        expect(bootstrap.body.initialization.registeredReplicaCount).toBe(1)
        expect(catalog.body.catalog.products).toEqual([])
        expect(catalog.body.appliedOperationIds).toEqual(['recovery-delete', 'recovery-restore'])
        expect(replay.body.results[0].status).toBe('duplicate')
      } finally {
        await restarted.close()
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
