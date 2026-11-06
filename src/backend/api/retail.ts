import { ReplicaRuntime, type ReplicaSnapshot } from '../crdt/replica'
import type { ReplicaStoreLike } from './server'
import type { Category, Product } from '../../domain/types'
import type { RetailCatalog, RetailOperation, RetailOperationResult } from '../../domain/retailSync'

interface PersistedRetail {
  snapshot: ReplicaSnapshot<string>
  catalog: RetailCatalog
  appliedOperationIds: string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const validProduct = (value: unknown): value is Product =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.name === 'string' &&
  typeof value.nameAr === 'string' &&
  typeof value.description === 'string' &&
  typeof value.descriptionAr === 'string' &&
  value.name.trim().length > 0 &&
  value.name.length <= 60 &&
  value.description.length <= 240 &&
  typeof value.price === 'number' &&
  Number.isInteger(value.price) &&
  value.price > 0 &&
  value.price <= 1_000_000 &&
  typeof value.categoryId === 'string' &&
  (value.availability === 'available' || value.availability === 'unavailable') &&
  typeof value.stock === 'number' &&
  Number.isInteger(value.stock) &&
  value.stock >= 0 &&
  value.stock <= 100_000 &&
  typeof value.lowStockThreshold === 'number' &&
  Number.isInteger(value.lowStockThreshold) &&
  value.lowStockThreshold >= 0 &&
  Number.isFinite(value.updatedAt)

const validCategory = (value: unknown): value is Category =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.name === 'string' &&
  typeof value.nameAr === 'string' &&
  typeof value.description === 'string' &&
  value.name.trim().length > 0 &&
  value.name.length <= 40 &&
  Number.isFinite(value.updatedAt)

export const validateRetailOperation = (value: unknown): RetailOperation => {
  if (!isRecord(value) || typeof value.operationId !== 'string' || !value.operationId) {
    throw new Error('Invalid retail operation')
  }
  if (value.kind === 'product.upsert' && validProduct(value.product)) return value as RetailOperation
  if (value.kind === 'category.upsert' && validCategory(value.category)) return value as RetailOperation
  if (value.kind === 'product.delete' && typeof value.productId === 'string' && value.productId) return value as RetailOperation
  if (value.kind === 'category.delete' && typeof value.categoryId === 'string' && value.categoryId) return value as RetailOperation
  throw new Error('Invalid retail operation')
}

export class RetailDomainRuntime {
  private readonly appliedOperationIds: Set<string>

  constructor(
    readonly replica: ReplicaRuntime<string>,
    private catalog: RetailCatalog,
    appliedOperationIds: readonly string[] = [],
  ) {
    this.appliedOperationIds = new Set(appliedOperationIds)
  }

  apply(operation: RetailOperation): RetailOperationResult {
    if (this.appliedOperationIds.has(operation.operationId)) {
      return { operationId: operation.operationId, status: 'duplicate' }
    }
    if (operation.kind === 'product.upsert') {
      this.catalog = {
        ...this.catalog,
        products: [operation.product, ...this.catalog.products.filter((product) => product.id !== operation.product.id)],
      }
    } else if (operation.kind === 'product.patch') {
      this.catalog = {
        ...this.catalog,
        products: this.catalog.products.map((product) =>
          product.id === operation.productId ? { ...product, ...operation.changes } : product,
        ),
      }
    } else if (operation.kind === 'product.delete') {
      this.catalog = { ...this.catalog, products: this.catalog.products.filter((product) => product.id !== operation.productId) }
    } else if (operation.kind === 'category.upsert') {
      this.catalog = {
        ...this.catalog,
        categories: [operation.category, ...this.catalog.categories.filter((category) => category.id !== operation.category.id)],
      }
    } else if (operation.kind === 'inventory.adjust') {
      this.catalog = {
        ...this.catalog,
        products: this.catalog.products.map((product) =>
          product.id === operation.productId
            ? { ...product, stock: Math.max(0, product.stock + operation.delta) }
            : product,
        ),
      }
    } else if (operation.kind === 'category.delete') {
      this.catalog = { ...this.catalog, categories: this.catalog.categories.filter((category) => category.id !== operation.categoryId) }
    }
    this.replica.add(`retail:${operation.operationId}`)
    this.replica.incrementCounter()
    this.appliedOperationIds.add(operation.operationId)
    return { operationId: operation.operationId, status: 'applied' }
  }

  snapshot(): PersistedRetail {
    return {
      snapshot: this.replica.snapshot(),
      catalog: structuredClone(this.catalog),
      appliedOperationIds: [...this.appliedOperationIds].sort(),
    }
  }

  getCatalog(): RetailCatalog {
    return structuredClone(this.catalog)
  }

  appliedIds(): string[] {
    return [...this.appliedOperationIds].sort()
  }
}

export const loadRetailRuntime = (replicaId: string, store: ReplicaStoreLike): RetailDomainRuntime => {
  const saved = store.load(`${replicaId}:retail`)
  if (!saved) return new RetailDomainRuntime(new ReplicaRuntime<string>(`${replicaId}:retail`), { products: [], categories: [] })
  const state = saved.state as Partial<PersistedRetail>
  if (!state.snapshot || !state.catalog || !Array.isArray(state.appliedOperationIds)) throw new Error('Invalid persisted retail state')
  return new RetailDomainRuntime(ReplicaRuntime.fromJSON(state.snapshot), state.catalog, state.appliedOperationIds)
}
