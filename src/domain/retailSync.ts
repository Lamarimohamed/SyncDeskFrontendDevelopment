import type { Category, Product } from './types'
import type { StockOperation } from './stock'

export interface RetailVersion {
  logicalTime: number
  replicaId: string
  operationId: string
}

export type VersionedProductField = Pick<
  Product,
  | 'name'
  | 'nameAr'
  | 'description'
  | 'descriptionAr'
  | 'price'
  | 'availability'
  | 'lowStockThreshold'
  | 'categoryId'
>

export type VersionedCategoryField = Pick<Category, 'name' | 'nameAr' | 'description'>

export type VersionedRetailOperation =
  | {
      schemaVersion: 2
      operationId: string
      replicaId: string
      version: RetailVersion
      kind: 'product.patch'
      productId: string
      changes: Partial<VersionedProductField>
    }
  | {
      schemaVersion: 2
      operationId: string
      replicaId: string
      version: RetailVersion
      kind: 'product.delete'
      productId: string
    }
  | {
      schemaVersion: 2
      operationId: string
      replicaId: string
      version: RetailVersion
      kind: 'product.restore'
      productId: string
      product: Product
    }
  | {
      schemaVersion: 2
      operationId: string
      replicaId: string
      version: RetailVersion
      kind: 'category.patch'
      categoryId: string
      changes: Partial<VersionedCategoryField>
    }
  | {
      schemaVersion: 2
      operationId: string
      replicaId: string
      version: RetailVersion
      kind: 'category.delete'
      categoryId: string
    }
  | {
      schemaVersion: 2
      operationId: string
      replicaId: string
      version: RetailVersion
      kind: 'inventory.adjust'
      productId: string
      delta: number
    }
  | StockOperation

const MAX_IDENTIFIER_LENGTH = 256
const MAX_LOGICAL_TIME = Number.MAX_SAFE_INTEGER

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(value).every((key) => allowed.includes(key))

const isIdentifier = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= MAX_IDENTIFIER_LENGTH

const isLogicalTime = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= MAX_LOGICAL_TIME

const compareBytes = (left: Uint8Array, right: Uint8Array): number => {
  const length = Math.min(left.length, right.length)

  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1
  }

  return left.length === right.length ? 0 : left.length < right.length ? -1 : 1
}

const compareIdentifiers = (left: string, right: string): number =>
  compareBytes(new TextEncoder().encode(left), new TextEncoder().encode(right))

export const compareRetailUtf8 = compareIdentifiers

export const compareRetailVersions = (
  left: RetailVersion,
  right: RetailVersion,
): number =>
  left.logicalTime - right.logicalTime ||
  compareIdentifiers(left.replicaId, right.replicaId) ||
  compareIdentifiers(left.operationId, right.operationId)

const isVersion = (value: unknown): value is RetailVersion =>
  isRecord(value) &&
  hasOnlyKeys(value, ['logicalTime', 'replicaId', 'operationId']) &&
  isLogicalTime(value.logicalTime) &&
  isIdentifier(value.replicaId) &&
  isIdentifier(value.operationId)

const isNonEmptyString = (value: unknown, maxLength: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength

const isProductFieldValue = (
  field: keyof VersionedProductField,
  value: unknown,
): boolean => {
  if (field === 'name') return isNonEmptyString(value, 60)
  if (field === 'nameAr') return typeof value === 'string' && value.length <= 60
  if (field === 'description' || field === 'descriptionAr')
    return typeof value === 'string' && value.length <= 240
  if (field === 'price')
    return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 1_000_000
  if (field === 'availability')
    return value === 'available' || value === 'unavailable'
  if (field === 'lowStockThreshold')
    return typeof value === 'number' && Number.isInteger(value) && value >= 0
  return isNonEmptyString(value, MAX_IDENTIFIER_LENGTH)
}

const isCategoryFieldValue = (
  field: keyof VersionedCategoryField,
  value: unknown,
): boolean => {
  if (field === 'name') return isNonEmptyString(value, 40)
  if (field === 'nameAr') return typeof value === 'string' && value.length <= 40
  return typeof value === 'string' && value.length <= 240
}

const isProduct = (value: unknown): value is Product =>
  isRecord(value) &&
  hasOnlyKeys(value, [
    'id',
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
  ]) &&
  isIdentifier(value.id) &&
  isProductFieldValue('name', value.name) &&
  isProductFieldValue('nameAr', value.nameAr) &&
  isProductFieldValue('description', value.description) &&
  isProductFieldValue('descriptionAr', value.descriptionAr) &&
  isProductFieldValue('price', value.price) &&
  isProductFieldValue('categoryId', value.categoryId) &&
  isProductFieldValue('availability', value.availability) &&
  typeof value.stock === 'number' &&
  Number.isInteger(value.stock) &&
  value.stock >= 0 &&
  value.stock <= 100_000 &&
  isProductFieldValue('lowStockThreshold', value.lowStockThreshold) &&
  typeof value.updatedAt === 'number' &&
  Number.isFinite(value.updatedAt)

const invalidOperation = (message: string): never => {
  throw new Error(`Invalid versioned retail operation: ${message}`)
}

const validateEnvelope = (value: Record<string, unknown>): RetailVersion => {
  if (value.schemaVersion !== 2) invalidOperation('schemaVersion must be 2')
  if (!isIdentifier(value.operationId)) invalidOperation('operationId is invalid')
  if (!isIdentifier(value.replicaId)) invalidOperation('replicaId is invalid')
  const operationId = value.operationId
  const replicaId = value.replicaId
  const version = value.version
  if (!isVersion(version)) return invalidOperation('version is invalid')
  if (version.operationId !== operationId)
    invalidOperation('version operationId does not match operationId')
  if (version.replicaId !== replicaId)
    invalidOperation('version replicaId does not match replicaId')
  return version
}

const validateProductPatch = (value: unknown): Partial<VersionedProductField> => {
  if (!isRecord(value)) return invalidOperation('product changes must be an object')
  const changes: Record<string, unknown> = value
  const fields = [
    'name',
    'nameAr',
    'description',
    'descriptionAr',
    'price',
    'availability',
    'lowStockThreshold',
    'categoryId',
  ] as const
  if (!hasOnlyKeys(changes, fields) || Object.keys(changes).length === 0)
    invalidOperation('product changes must contain at least one known field')
  for (const field of Object.keys(changes) as Array<keyof VersionedProductField>) {
    if (!isProductFieldValue(field, changes[field]))
      invalidOperation(`product field ${field} is invalid`)
  }
  return changes as Partial<VersionedProductField>
}

const validateCategoryPatch = (value: unknown): Partial<VersionedCategoryField> => {
  if (!isRecord(value)) return invalidOperation('category changes must be an object')
  const changes: Record<string, unknown> = value
  const fields = ['name', 'nameAr', 'description'] as const
  if (!hasOnlyKeys(changes, fields) || Object.keys(changes).length === 0)
    invalidOperation('category changes must contain at least one known field')
  for (const field of Object.keys(changes) as Array<keyof VersionedCategoryField>) {
    if (!isCategoryFieldValue(field, changes[field]))
      invalidOperation(`category field ${field} is invalid`)
  }
  return changes as Partial<VersionedCategoryField>
}

export const validateVersionedRetailOperation = (
  value: unknown,
): VersionedRetailOperation => {
  if (!isRecord(value)) return invalidOperation('operation must be an object')
  const operation = value
  validateEnvelope(operation)
  const operationId = operation.operationId
  const replicaId = operation.replicaId
  const version = operation.version
  if (!isIdentifier(operationId) || !isIdentifier(replicaId) || !isVersion(version))
    return invalidOperation('operation envelope is invalid')

  if (operation.kind === 'product.patch') {
    if (!isIdentifier(operation.productId))
      return invalidOperation('productId is invalid')
    const productId = operation.productId
    return {
      schemaVersion: 2,
      operationId,
      replicaId,
      version,
      kind: operation.kind,
      productId,
      changes: validateProductPatch(operation.changes),
    }
  }

  if (operation.kind === 'product.delete') {
    if (!isIdentifier(operation.productId)) return invalidOperation('productId is invalid')
    if (!hasOnlyKeys(operation, ['schemaVersion', 'operationId', 'replicaId', 'version', 'kind', 'productId']))
      invalidOperation('product.delete contains unknown fields')
    return operation as unknown as VersionedRetailOperation
  }

  if (operation.kind === 'product.restore') {
    const productId = operation.productId
    const restoredProduct = operation.product
    if (
      !hasOnlyKeys(operation, [
        'schemaVersion',
        'operationId',
        'replicaId',
        'version',
        'kind',
        'productId',
        'product',
      ])
    )
      return invalidOperation('product.restore contains unknown fields')
    if (!isIdentifier(productId) || !isProduct(restoredProduct))
      return invalidOperation('product.restore payload is invalid')
    if (restoredProduct.id !== productId)
      return invalidOperation('product.restore productId does not match product.id')
    return operation as unknown as VersionedRetailOperation
  }

  if (operation.kind === 'category.patch') {
    if (!isIdentifier(operation.categoryId))
      return invalidOperation('categoryId is invalid')
    const categoryId = operation.categoryId
    return {
      schemaVersion: 2,
      operationId,
      replicaId,
      version,
      kind: operation.kind,
      categoryId,
      changes: validateCategoryPatch(operation.changes),
    }
  }

  if (operation.kind === 'category.delete') {
    if (!isIdentifier(operation.categoryId)) return invalidOperation('categoryId is invalid')
    if (!hasOnlyKeys(operation, ['schemaVersion', 'operationId', 'replicaId', 'version', 'kind', 'categoryId']))
      invalidOperation('category.delete contains unknown fields')
    return operation as unknown as VersionedRetailOperation
  }

  if (operation.kind === 'inventory.adjust') {
    if (!isIdentifier(operation.productId))
      return invalidOperation('productId is invalid')
    if (
      !hasOnlyKeys(operation, [
        'schemaVersion',
        'operationId',
        'replicaId',
        'version',
        'kind',
        'productId',
        'delta',
      ])
    )
      return invalidOperation('inventory.adjust contains unknown fields')
    if (
      typeof operation.delta !== 'number' ||
      !Number.isSafeInteger(operation.delta) ||
      operation.delta === 0
    )
      return invalidOperation('inventory delta must be a non-zero safe integer')
    return operation as unknown as VersionedRetailOperation
  }

  if (
    operation.kind === 'inventory.restock' ||
    operation.kind === 'inventory.decrement'
  ) {
    if (!hasOnlyKeys(operation, ['schemaVersion', 'operationId', 'replicaId', 'version', 'kind', 'productId', 'tokenIds']))
      return invalidOperation(`${operation.kind} contains unknown fields`)
    if (!isIdentifier(operation.productId) || !Array.isArray(operation.tokenIds) || operation.tokenIds.length === 0 || !operation.tokenIds.every(isIdentifier))
      return invalidOperation(`${operation.kind} tokenIds are invalid`)
    return operation as unknown as VersionedRetailOperation
  }

  if (operation.kind === 'inventory.transfer') {
    if (!hasOnlyKeys(operation, [
      'schemaVersion', 'operationId', 'replicaId', 'version', 'kind',
      'productId', 'transferId', 'fromReplicaId', 'toReplicaId', 'tokenIds',
    ]))
      return invalidOperation('inventory.transfer contains unknown fields')
    if (
      !isIdentifier(operation.transferId) ||
      !isIdentifier(operation.productId) ||
      !isIdentifier(operation.fromReplicaId) ||
      !isIdentifier(operation.toReplicaId) ||
      operation.fromReplicaId === operation.toReplicaId ||
      !Array.isArray(operation.tokenIds) ||
      operation.tokenIds.length === 0 ||
      !operation.tokenIds.every(isIdentifier)
    )
      return invalidOperation('inventory.transfer payload is invalid')
    return operation as unknown as VersionedRetailOperation
  }

  return invalidOperation('kind is invalid')
}

export type RetailOperation =
  | {
      operationId: string
      kind: 'product.upsert'
      product: Product
    }
  | {
      operationId: string
      kind: 'product.patch'
      productId: string
      changes: Partial<VersionedProductField>
    }
  | {
      operationId: string
      kind: 'product.delete'
      productId: string
    }
  | {
      operationId: string
      kind: 'category.upsert'
      category: Category
    }
  | {
      operationId: string
      kind: 'category.delete'
      categoryId: string
    }
  | {
      operationId: string
      kind: 'inventory.adjust'
      productId: string
      delta: number
    }
  | {
      operationId: string
      kind: 'inventory.restock' | 'inventory.decrement'
      productId: string
      tokenIds: string[]
    }
  | {
      operationId: string
      kind: 'inventory.transfer'
      productId: string
      transferId: string
      fromReplicaId: string
      toReplicaId: string
      tokenIds: string[]
    }

export interface RetailCatalog {
  products: Product[]
  categories: Category[]
}

export interface RetailOperationResult {
  operationId: string
  status: 'applied' | 'duplicate'
}
