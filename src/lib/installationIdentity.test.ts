import { describe, expect, it } from 'vitest'
import { createMemoryStorage, type KeyValueStorage } from './storage'
import {
  installationIdentityStorageKey,
  InstallationIdentityError,
  loadOrCreateInstallationIdentity,
} from './installationIdentity'
import { SyncEngine } from '@/services/sync/SyncEngine'

const uuidSource = (...values: string[]) => {
  let index = 0
  return () => values[index++]
}

describe('persistent browser installation identity', () => {
  it('creates and persists device and replica IDs', () => {
    const storage = createMemoryStorage()
    const identity = loadOrCreateInstallationIdentity(storage, uuidSource('device-a', 'replica-a'))

    expect(identity).toEqual({ deviceId: 'device-device-a', replicaId: 'replica-replica-a' })
    expect(storage.getItem(installationIdentityStorageKey)).toContain('device-device-a')
  })

  it('returns the same identity on repeated initialization', () => {
    const storage = createMemoryStorage()
    const first = loadOrCreateInstallationIdentity(storage, uuidSource('first-device', 'first-replica'))
    const second = loadOrCreateInstallationIdentity(storage, uuidSource('new-device', 'new-replica'))

    expect(second).toEqual(first)
  })

  it('creates different identities for independent storage environments', () => {
    const first = loadOrCreateInstallationIdentity(createMemoryStorage(), uuidSource('a-device', 'a-replica'))
    const second = loadOrCreateInstallationIdentity(createMemoryStorage(), uuidSource('b-device', 'b-replica'))

    expect(second).not.toEqual(first)
  })

  it('rejects corrupt persisted identity without replacing it', () => {
    const storage = createMemoryStorage()
    storage.setItem(installationIdentityStorageKey, '{not-json')

    expect(() => loadOrCreateInstallationIdentity(storage, uuidSource('unused-device', 'unused-replica')))
      .toThrow(InstallationIdentityError)
    expect(storage.getItem(installationIdentityStorageKey)).toBe('{not-json')
  })

  it('reports storage failure instead of creating an ephemeral identity', () => {
    const storage: KeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded')
      },
      removeItem: () => {},
    }

    expect(() => loadOrCreateInstallationIdentity(storage, uuidSource('device', 'replica')))
      .toThrow(/could not be persisted/)
  })

  it('uses the persistent identity for versions and retains pending attribution after reload', () => {
    const storage = createMemoryStorage()
    const first = new SyncEngine({ storage, isAutoSyncEnabled: () => false })
    const change = first.enqueue({
      kind: 'product.update',
      entityType: 'product',
      entityId: 'p-1',
      entityLabel: 'Product',
      summary: 'Updated product',
      crdt: 'LWW Register',
      discardable: false,
      retailOperation: {
        operationId: 'legacy-op',
        kind: 'product.patch',
        productId: 'p-1',
        changes: { name: 'Updated' },
      },
    })
    first.goOffline()
    const second = new SyncEngine({ storage, isAutoSyncEnabled: () => false })

    expect(second.replicaId).toBe(first.replicaId)
    expect(second.deviceId).toBe(first.deviceId)
    expect(second.getSnapshot().pending[0].versionedOperation?.replicaId).toBe(first.replicaId)
    expect(change.versionedOperation?.replicaId).toBe(first.replicaId)
    second.goOffline()
    expect(second.replicaId).toBe(first.replicaId)
  })
})
