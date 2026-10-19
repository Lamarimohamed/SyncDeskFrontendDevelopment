import { describe, expect, it } from 'vitest'
import { ReplicaRuntime } from '../crdt/replica'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  FileReplicaStore,
  ReplicaRevisionConflictError,
  ReplicaStore,
} from './ReplicaStore'
import type { RetailOperation } from '../../domain/retailSync'
import {
  adaptPersistedRetailV1Record,
  createRetailMigrationTarget,
  migrateAndCommitV1RetailState,
  migrateLoadedRetailState,
  migrateV1RetailState,
  validatePersistedRetailV2,
  type AtomicMigrationTarget,
  type PersistedRetailV2Record,
  type V1RetailState,
} from './retailMigration'

const product = {
  id: 'p1',
  name: 'Tea',
  nameAr: 'شاي',
  description: 'Green tea',
  descriptionAr: 'شاي أخضر',
  price: 10,
  categoryId: 'c1',
  availability: 'available' as const,
  stock: 10,
  lowStockThreshold: 2,
  updatedAt: 1767225600000,
}

const category = {
  id: 'c1',
  name: 'Drinks',
  nameAr: 'مشروبات',
  description: 'Beverages',
  updatedAt: 1767225600000,
}

const v1State = (): V1RetailState => ({
  snapshot: new ReplicaRuntime<string>('replica-a').snapshot(),
  catalog: { products: [product], categories: [category] },
  appliedOperationIds: ['legacy-op-1'],
  pendingOperations: [
    {
      operationId: 'pending-1',
      kind: 'product.delete',
      productId: 'p1',
    } satisfies RetailOperation,
  ],
})

class MemoryMigrationTarget implements AtomicMigrationTarget {
  constructor(private current: V1RetailState | PersistedRetailV2Record) {}

  load(): V1RetailState | PersistedRetailV2Record {
    return structuredClone(this.current)
  }

  replace(record: PersistedRetailV2Record): void {
    this.current = structuredClone(record)
  }

  value(): V1RetailState | PersistedRetailV2Record {
    return structuredClone(this.current)
  }
}

describe('V1 to V2 retail persistence migration', () => {
  it('adapts a production-shaped V1 retail record without treating generic state as retail state', () => {
    const store = new ReplicaStore()
    const saved = store.save('replica-a:retail', {
      snapshot: new ReplicaRuntime<string>('replica-a:retail').snapshot(),
      catalog: v1State().catalog,
      appliedOperationIds: v1State().appliedOperationIds,
    })

    expect(adaptPersistedRetailV1Record(saved)).toMatchObject({
      snapshot: (saved.state as { snapshot: unknown }).snapshot,
      catalog: v1State().catalog,
      appliedOperationIds: ['legacy-op-1'],
    })

    expect(() =>
      adaptPersistedRetailV1Record(
        store.save('replica-a', {
          snapshot: new ReplicaRuntime<string>('replica-a').snapshot(),
          appliedMessageIds: ['message-1'],
        }),
      ),
    ).toThrow('Invalid retail persistence state: V1 catalog is invalid')
  })

  it('migrates through the revision-aware production store adapter', () => {
    const store = new ReplicaStore()
    store.save('replica-a:retail', {
      snapshot: new ReplicaRuntime<string>('replica-a:retail').snapshot(),
      catalog: v1State().catalog,
      appliedOperationIds: v1State().appliedOperationIds,
    })

    const target = createRetailMigrationTarget(store, 'replica-a')
    const migrated = migrateLoadedRetailState(target, 123)

    expect(migrated.state.catalog).toEqual(v1State().catalog)
    expect(migrated.state.genericSnapshot.replicaId).toBe('replica-a:retail')
    expect(store.load('replica-a:retail')).toMatchObject({
      schemaVersion: 2,
      state: migrated.state,
    })
  })

  it('persists the migrated record through a file-backed store and reloads it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'syncdesk-retail-migration-'))
    const path = join(directory, 'replicas.json')

    try {
      const store = new FileReplicaStore(path)
      store.save('replica-a:retail', {
        snapshot: new ReplicaRuntime<string>('replica-a:retail').snapshot(),
        catalog: v1State().catalog,
        appliedOperationIds: v1State().appliedOperationIds,
      })

      const migrated = migrateLoadedRetailState(
        createRetailMigrationTarget(store, 'replica-a'),
        123,
      )
      const reloaded = new FileReplicaStore(path)
      const restarted = migrateLoadedRetailState(
        createRetailMigrationTarget(reloaded, 'replica-a'),
        999,
      )

      expect(restarted).toEqual(migrated)
      expect(reloaded.load('replica-a:retail')?.schemaVersion).toBe(2)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('returns a committed V2 record unchanged after restart-style reload', () => {
    const store = new ReplicaStore()
    store.save('replica-a:retail', {
      snapshot: new ReplicaRuntime<string>('replica-a:retail').snapshot(),
      catalog: v1State().catalog,
      appliedOperationIds: v1State().appliedOperationIds,
    })
    const target = createRetailMigrationTarget(store, 'replica-a')
    const first = migrateLoadedRetailState(target, 123)
    const second = migrateLoadedRetailState(target, 999)

    expect(second).toEqual(first)
    expect(store.loadWithRevision('replica-a:retail')?.revision).toBe(2)
  })

  it('rejects stale replacement attempts without overwriting newer retail state', () => {
    const store = new ReplicaStore()
    store.save('replica-a:retail', {
      snapshot: new ReplicaRuntime<string>('replica-a:retail').snapshot(),
      catalog: v1State().catalog,
      appliedOperationIds: v1State().appliedOperationIds,
    })
    const target = createRetailMigrationTarget(store, 'replica-a')
    const first = target.load()
    const second = target.load()

    if (!first || !second || 'schemaVersion' in first.value || 'schemaVersion' in second.value)
      throw new Error('Expected two V1 retail snapshots')

    const migrated = migrateV1RetailState(first.value, 123)
    target.replace(migrated, first.revision)

    expect(() => target.replace(migrated, second.revision)).toThrow(
      ReplicaRevisionConflictError,
    )
    expect(store.load('replica-a:retail')?.schemaVersion).toBe(2)
  })

  it('does not let competing file-backed migrations overwrite one another', () => {
    const directory = mkdtempSync(join(tmpdir(), 'syncdesk-retail-competing-'))
    const path = join(directory, 'replicas.json')

    try {
      const initial = new FileReplicaStore(path)
      initial.save('replica-a:retail', {
        snapshot: new ReplicaRuntime<string>('replica-a:retail').snapshot(),
        catalog: v1State().catalog,
        appliedOperationIds: v1State().appliedOperationIds,
      })

      const firstTarget = createRetailMigrationTarget(
        new FileReplicaStore(path),
        'replica-a',
      )
      const secondTarget = createRetailMigrationTarget(
        new FileReplicaStore(path),
        'replica-a',
      )
      const first = firstTarget.load()
      const second = secondTarget.load()

      if (!first || !second || 'schemaVersion' in first.value || 'schemaVersion' in second.value)
        throw new Error('Expected two V1 retail snapshots')

      const firstV1 = first.value
      const secondV1 = second.value
      firstTarget.replace(migrateV1RetailState(firstV1, 123), first.revision)

      expect(() =>
        secondTarget.replace(migrateV1RetailState(secondV1, 999), second.revision),
      ).toThrow(ReplicaRevisionConflictError)
      expect(new FileReplicaStore(path).load('replica-a:retail')?.schemaVersion).toBe(2)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('loads V1 state without inventing tombstones', () => {
    const migrated = migrateV1RetailState(v1State(), 123)

    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.state.catalog.products).toEqual([product])
    expect(migrated.state.products.p1.tombstone).toBeUndefined()
    expect(migrated.state.compatibilityPendingOperations).toHaveLength(1)
    expect(migrated.state.appliedOperations['legacy-op-1']).toEqual({
      payloadHash: null,
      source: 'v1',
    })
  })

  it('produces deterministic synthetic versions and repeated migration output', () => {
    const first = migrateV1RetailState(v1State(), 123)
    const second = migrateV1RetailState(v1State(), 123)

    expect(first).toEqual(second)
    expect(first.state.products.p1.fieldVersions.name).toEqual({
      logicalTime: 0,
      replicaId: 'replica-a',
      operationId: 'migration:v1:p1:name',
    })
  })

  it('preserves V1 state when an injected commit fails', () => {
    const target = new MemoryMigrationTarget(v1State())
    const before = target.value()
    const failingTarget: AtomicMigrationTarget = {
      load: () => target.load(),
      replace: () => {
        throw new Error('injected migration failure')
      },
    }

    expect(() => migrateAndCommitV1RetailState(v1State(), failingTarget, 123)).toThrow(
      'injected migration failure',
    )
    expect(target.value()).toEqual(before)
  })

  it('does not repeat migration after an already committed V2 record', () => {
    const target = new MemoryMigrationTarget(v1State())
    const first = migrateAndCommitV1RetailState(v1State(), target, 123)
    const second = migrateAndCommitV1RetailState(v1State(), target, 999)

    expect(second).toEqual(first)
    expect((target.value() as PersistedRetailV2Record).updatedAt).toBe(123)
  })

  it.each([
    ['wrong schema', { ...migrateV1RetailState(v1State()), schemaVersion: 1 }],
    [
      'identity mismatch',
      {
        ...migrateV1RetailState(v1State()),
        replicaId: 'other',
      },
    ],
    [
      'invalid clock',
      {
        ...migrateV1RetailState(v1State()),
        state: {
          ...migrateV1RetailState(v1State()).state,
          clock: { wallClock: -1, logicalCounter: 0, nodeId: 'replica-a' },
        },
      },
    ],
    [
      'incomplete marker',
      {
        ...migrateV1RetailState(v1State()),
        state: {
          ...migrateV1RetailState(v1State()).state,
          migration: { sourceSchemaVersion: 1, migrationId: 'x', complete: false },
        },
      },
    ],
  ])('rejects malformed V2 metadata: %s', (_reason, candidate) => {
    expect(() => validatePersistedRetailV2(candidate as PersistedRetailV2Record)).toThrow(
      'Invalid retail persistence state:',
    )
  })
})
