import { describe, expect, it, vi } from 'vitest'
import { buildSeed } from '@/data/seed'
import { createMemoryStorage } from '@/lib/storage'
import { MockRepository } from '@/repositories/MockRepository'
import { SyncEngine } from '@/services/sync/SyncEngine'
import { BackendApiClient, BackendApiError } from './backendApi'
import { startBackendServer } from '@/backend/api/server'

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
})
