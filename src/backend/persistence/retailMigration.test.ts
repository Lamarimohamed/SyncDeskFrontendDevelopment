import { describe, expect, it } from 'vitest'
import { ReplicaRuntime } from '../crdt/replica'
import type { RetailOperation } from '../../domain/retailSync'
import {
  migrateAndCommitV1RetailState,
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
