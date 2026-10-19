import type { HlcTimestamp } from '../crdt/clock'
import type { ReplicaSnapshot } from '../crdt/replica'
import type {
  ReplicaRecord,
  RevisionedReplicaStore,
} from './ReplicaStore'
import type {
  RetailCatalog,
  RetailOperation,
  RetailVersion,
  VersionedRetailOperation,
} from '../../domain/retailSync'
import type { Category, Product } from '../../domain/types'

export interface V1RetailState {
  snapshot: ReplicaSnapshot<string>
  catalog: RetailCatalog
  appliedOperationIds: string[]
  pendingOperations?: RetailOperation[]
}

export interface PersistedField<T> {
  value: T
  version: RetailVersion
}

export interface PersistedProductV2 {
  fields: Product
  fieldVersions: Record<string, RetailVersion>
  tombstone?: RetailVersion
  restoredVersion?: RetailVersion
}

export interface PersistedCategoryV2 {
  fields: Category
  fieldVersions: Record<string, RetailVersion>
}

export interface AppliedOperationRecord {
  payloadHash: string | null
  source: 'v1' | 'v2'
}

export interface PersistedRetailV2 {
  schemaVersion: 2
  replicaId: string
  clock: HlcTimestamp
  genericSnapshot: ReplicaSnapshot<string>
  catalog: RetailCatalog
  products: Record<string, PersistedProductV2>
  categories: Record<string, PersistedCategoryV2>
  appliedOperations: Record<string, AppliedOperationRecord>
  pendingOperations: VersionedRetailOperation[]
  compatibilityPendingOperations: RetailOperation[]
  migration: {
    sourceSchemaVersion: 1
    migrationId: string
    complete: true
  }
}

export interface PersistedRetailV2Record {
  replicaId: string
  state: PersistedRetailV2
  schemaVersion: 2
  updatedAt: number
}

export interface AtomicMigrationTarget {
  load(): PersistedRetailV2Record | V1RetailState
  replace(record: PersistedRetailV2Record): void
}

export interface LoadedRetailMigrationState {
  revision: number
  value: PersistedRetailV2Record | V1RetailState
}

export interface RetailMigrationTarget {
  load(): LoadedRetailMigrationState | undefined
  replace(record: PersistedRetailV2Record, expectedRevision: number): void
}

const clone = <T>(value: T): T => structuredClone(value)

const invalid = (message: string): never => {
  throw new Error(`Invalid retail persistence state: ${message}`)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256

const isClock = (value: unknown): value is HlcTimestamp =>
  (() => {
    if (!isRecord(value)) return false
    const wallClock = value.wallClock
    const logicalCounter = value.logicalCounter
    const nodeId = value.nodeId
    return (
      Number.isSafeInteger(wallClock) &&
      typeof wallClock === 'number' &&
      wallClock >= 0 &&
      Number.isSafeInteger(logicalCounter) &&
      typeof logicalCounter === 'number' &&
      logicalCounter >= 0 &&
      typeof nodeId === 'string' &&
      nodeId.length > 0
    )
  })()

const migrationVersion = (
  replicaId: string,
  entityId: string,
  field: string,
): RetailVersion => ({
  logicalTime: 0,
  replicaId,
  operationId: `migration:v1:${entityId}:${field}`,
})

const productFieldNames = [
  'name',
  'nameAr',
  'description',
  'descriptionAr',
  'price',
  'categoryId',
  'availability',
  'stock',
  'lowStockThreshold',
  'updatedAt',
] as const

const categoryFieldNames = ['name', 'nameAr', 'description', 'updatedAt'] as const

const migrateProduct = (product: Product, replicaId: string): PersistedProductV2 => ({
  fields: clone(product),
  fieldVersions: Object.fromEntries(
    productFieldNames
      .filter((field) => field !== 'stock' && field !== 'updatedAt')
      .map((field) => [field, migrationVersion(replicaId, product.id, field)]),
  ),
})

const migrateCategory = (category: Category, replicaId: string): PersistedCategoryV2 => ({
  fields: clone(category),
  fieldVersions: Object.fromEntries(
    categoryFieldNames
      .filter((field) => field !== 'updatedAt')
      .map((field) => [field, migrationVersion(replicaId, category.id, field)]),
  ),
})

const validateV1 = (value: V1RetailState): void => {
  if (!value || !isRecord(value)) invalid('V1 state must be an object')
  if (!value.snapshot || !isRecord(value.snapshot)) invalid('V1 snapshot is missing')
  if (!isIdentifier(value.snapshot.replicaId)) invalid('V1 replica identity is invalid')
  if (!isClock(value.snapshot.clock)) invalid('V1 clock is invalid')
  if (!value.catalog || !Array.isArray(value.catalog.products) || !Array.isArray(value.catalog.categories))
    invalid('V1 catalog is invalid')
  if (!Array.isArray(value.appliedOperationIds) || value.appliedOperationIds.some((id) => !isIdentifier(id)))
    invalid('V1 applied operation IDs are invalid')
  if (value.pendingOperations && !Array.isArray(value.pendingOperations))
    invalid('V1 pending operations are invalid')
}

const isV2Record = (
  value: PersistedRetailV2Record | V1RetailState,
): value is PersistedRetailV2Record => 'schemaVersion' in value && value.schemaVersion === 2

const validateV2 = (value: PersistedRetailV2Record): void => {
  if (!value || value.schemaVersion !== 2) invalid('V2 schema version is invalid')
  if (!isIdentifier(value.replicaId)) invalid('V2 replica identity is invalid')
  if (!isRecord(value.state) || value.state.schemaVersion !== 2)
    invalid('V2 state schema version is invalid')
  if (value.state.replicaId !== value.replicaId) invalid('V2 replica identity mismatch')
  if (!isRecord(value.state.genericSnapshot))
    invalid('V2 generic snapshot is missing')
  if (!isIdentifier(value.state.genericSnapshot.replicaId))
    invalid('V2 generic snapshot identity is invalid')
  if (!isClock(value.state.clock)) invalid('V2 clock is invalid')
  if (value.state.clock.nodeId !== value.state.genericSnapshot.replicaId)
    invalid('V2 clock identity mismatch')
  if (!isRecord(value.state.migration))
    invalid('V2 migration marker is missing')
  if (value.state.migration.complete !== true) invalid('V2 migration is incomplete')
}

export const adaptPersistedRetailV1Record = (
  record: ReplicaRecord,
): V1RetailState => {
  if (record.schemaVersion !== 1)
    invalid('expected a schema-version 1 retail record')

  const state = record.state
  if (!isRecord(state))
    invalid('V1 retail record state must be an object')
  const stateRecord = state as Record<string, unknown>

  const candidate: V1RetailState = {
    snapshot: stateRecord.snapshot as ReplicaSnapshot<string>,
    catalog: stateRecord.catalog as RetailCatalog,
    appliedOperationIds: stateRecord.appliedOperationIds as string[],
    pendingOperations: stateRecord.pendingOperations as RetailOperation[] | undefined,
  }

  validateV1(candidate)
  return clone(candidate)
}

const adaptPersistedRetailV2Record = (
  record: ReplicaRecord,
): PersistedRetailV2Record => {
  if (record.schemaVersion !== 2)
    invalid('expected a schema-version 2 retail record')

  const candidate: PersistedRetailV2Record = {
    replicaId: record.replicaId,
    state: record.state as PersistedRetailV2,
    schemaVersion: 2,
    updatedAt: record.updatedAt,
  }

  validateV2(candidate)
  return clone(candidate)
}

export const createRetailMigrationTarget = (
  store: RevisionedReplicaStore,
  replicaId: string,
): RetailMigrationTarget => {
  const key = `${replicaId}:retail`

  return {
    load: () => {
      const loaded = store.loadWithRevision(key)
      if (!loaded) return undefined

      const value =
        loaded.record.schemaVersion === 1
          ? adaptPersistedRetailV1Record(loaded.record)
          : adaptPersistedRetailV2Record(loaded.record)

      return { revision: loaded.revision, value }
    },
    replace: (record, expectedRevision) => {
      validateV2(record)
      store.replaceIfRevision(key, expectedRevision, {
        replicaId: record.replicaId,
        state: record.state,
        schemaVersion: 2,
        updatedAt: record.updatedAt,
      })
    },
  }
}

export const migrateV1RetailState = (
  input: V1RetailState,
  updatedAt = 0,
): PersistedRetailV2Record => {
  validateV1(input)
  const replicaId = input.snapshot.replicaId
  const appliedOperations = Object.fromEntries(
    input.appliedOperationIds.map((operationId) => [
      operationId,
      { payloadHash: null, source: 'v1' as const },
    ]),
  )
  const state: PersistedRetailV2 = {
    schemaVersion: 2,
    replicaId,
    clock: clone(input.snapshot.clock),
    genericSnapshot: clone(input.snapshot),
    catalog: clone(input.catalog),
    products: Object.fromEntries(
      input.catalog.products.map((product) => [product.id, migrateProduct(product, replicaId)]),
    ),
    categories: Object.fromEntries(
      input.catalog.categories.map((category) => [category.id, migrateCategory(category, replicaId)]),
    ),
    appliedOperations,
    pendingOperations: [],
    compatibilityPendingOperations: clone(input.pendingOperations ?? []),
    migration: {
      sourceSchemaVersion: 1,
      migrationId: `migration:v1:${replicaId}`,
      complete: true,
    },
  }
  const record: PersistedRetailV2Record = {
    replicaId,
    state,
    schemaVersion: 2,
    updatedAt,
  }
  validateV2(record)
  return record
}

export const migrateAndCommitV1RetailState = (
  input: V1RetailState,
  target: AtomicMigrationTarget,
  updatedAt = 0,
): PersistedRetailV2Record => {
  const current = target.load()
  if ('schemaVersion' in current && current.schemaVersion === 2) {
    validateV2(current)
    return clone(current)
  }
  const migrated = migrateV1RetailState(input, updatedAt)
  target.replace(clone(migrated))
  return migrated
}

export const migrateLoadedRetailState = (
  target: RetailMigrationTarget,
  updatedAt = 0,
): PersistedRetailV2Record => {
  const loaded = target.load()

  if (!loaded) throw new Error('Invalid retail persistence state: retail record does not exist')

  if (isV2Record(loaded.value)) {
    validateV2(loaded.value)
    return clone(loaded.value)
  }

  const migrated = migrateV1RetailState(loaded.value, updatedAt)
  target.replace(clone(migrated), loaded.revision)
  return migrated
}

export const validatePersistedRetailV2 = (value: PersistedRetailV2Record): void =>
  validateV2(value)
