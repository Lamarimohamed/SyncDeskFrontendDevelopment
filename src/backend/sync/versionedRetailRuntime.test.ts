import { describe, expect, it } from 'vitest'
import type { Product } from '@/domain/types'
import type { VersionedProductField, VersionedRetailOperation } from '@/domain/retailSync'
import { VersionedRetailRuntime } from './versionedRetailRuntime'

const product: Product = {
  id: 'p-coffee',
  name: 'Coffee',
  nameAr: 'قهوة',
  description: 'Original',
  descriptionAr: '',
  price: 100,
  categoryId: 'c-drinks',
  availability: 'available',
  stock: 10,
  lowStockThreshold: 2,
  updatedAt: 1,
}

const patch = (
  operationId: string,
  replicaId: string,
  logicalTime: number,
  changes: Partial<VersionedProductField>,
): VersionedRetailOperation => ({
  schemaVersion: 2,
  operationId,
  replicaId,
  version: { logicalTime, replicaId, operationId },
  kind: 'product.patch',
  productId: product.id,
  changes,
})

const catalogProduct = (runtime: VersionedRetailRuntime): Product =>
  runtime.catalog().products.find((item) => item.id === product.id)!

describe('VersionedRetailRuntime field-level semantics', () => {
  it('preserves concurrent edits to different fields', () => {
    const name = patch('a-name', 'replica-a', 1, { name: 'Premium Coffee' })
    const price = patch('b-price', 'replica-b', 1, { price: 120 })
    const runtime = new VersionedRetailRuntime({ products: [product], categories: [] })

    runtime.apply(price)
    runtime.apply(name)

    expect(catalogProduct(runtime)).toMatchObject({ name: 'Premium Coffee', price: 120 })
  })

  it('resolves same-field conflicts independent of delivery order', () => {
    const left = patch('a-name', 'replica-a', 1, { name: 'A' })
    const right = patch('b-name', 'replica-b', 1, { name: 'B' })
    const first = new VersionedRetailRuntime({ products: [product], categories: [] })
    const second = new VersionedRetailRuntime({ products: [product], categories: [] })

    first.apply(left)
    first.apply(right)
    second.apply(right)
    second.apply(left)

    expect(catalogProduct(first).name).toBe('B')
    expect(catalogProduct(second)).toEqual(catalogProduct(first))
  })

  it('allows a causally later same-field edit to win', () => {
    const earlier = patch('a-name', 'replica-a', 1, { name: 'A' })
    const later = patch('b-name', 'replica-b', 2, { name: 'B' })
    const runtime = new VersionedRetailRuntime({ products: [product], categories: [] })

    runtime.apply(later)
    runtime.apply(earlier)

    expect(catalogProduct(runtime).name).toBe('B')
  })

  it('is idempotent for duplicate delivery', () => {
    const operation = patch('a-price', 'replica-a', 1, { price: 120 })
    const runtime = new VersionedRetailRuntime({ products: [product], categories: [] })

    expect(runtime.apply(operation)).toBe('applied')
    expect(runtime.apply(operation)).toBe('duplicate')
    expect(catalogProduct(runtime).price).toBe(120)
  })

  it('keeps delete dominant over stale updates until a newer restore', () => {
    const deleted: VersionedRetailOperation = {
      schemaVersion: 2,
      operationId: 'delete',
      replicaId: 'replica-a',
      version: { logicalTime: 3, replicaId: 'replica-a', operationId: 'delete' },
      kind: 'product.delete',
      productId: product.id,
    }
    const staleUpdate = patch('stale-price', 'replica-b', 4, { price: 140 })
    const restoredProduct = { ...product, name: 'Restored Coffee' }
    const restored: VersionedRetailOperation = {
      schemaVersion: 2,
      operationId: 'restore',
      replicaId: 'replica-a',
      version: { logicalTime: 5, replicaId: 'replica-a', operationId: 'restore' },
      kind: 'product.restore',
      productId: product.id,
      product: restoredProduct,
    }
    const runtime = new VersionedRetailRuntime({ products: [product], categories: [] })

    runtime.apply(deleted)
    runtime.apply(staleUpdate)
    expect(runtime.catalog().products).toHaveLength(0)
    runtime.apply(restored)
    runtime.apply(staleUpdate)

    expect(catalogProduct(runtime)).toEqual(restoredProduct)
  })

  it('replays the complete operation history idempotently with metadata intact', () => {
    const operations: VersionedRetailOperation[] = [
      {
        schemaVersion: 2,
        operationId: 'restore-replay',
        replicaId: 'replica-a',
        version: { logicalTime: 1, replicaId: 'replica-a', operationId: 'restore-replay' },
        kind: 'product.restore',
        productId: product.id,
        product: { ...product, name: 'Restored' },
      },
      patch('patch-replay', 'replica-b', 2, { price: 125 }),
      {
        schemaVersion: 2,
        operationId: 'delete-replay',
        replicaId: 'replica-a',
        version: { logicalTime: 3, replicaId: 'replica-a', operationId: 'delete-replay' },
        kind: 'product.delete',
        productId: product.id,
      },
      {
        schemaVersion: 2,
        operationId: 'restore-again',
        replicaId: 'replica-b',
        version: { logicalTime: 4, replicaId: 'replica-b', operationId: 'restore-again' },
        kind: 'product.restore',
        productId: product.id,
        product: { ...product, name: 'Recovered', price: 130 },
      },
      {
        schemaVersion: 2,
        operationId: 'category-create',
        replicaId: 'replica-a',
        version: { logicalTime: 5, replicaId: 'replica-a', operationId: 'category-create' },
        kind: 'category.patch',
        categoryId: 'c-drinks',
        changes: { name: 'Drinks', nameAr: 'مشروبات', description: 'Beverages' },
      },
      {
        schemaVersion: 2,
        operationId: 'inventory-replay',
        replicaId: 'replica-b',
        version: { logicalTime: 6, replicaId: 'replica-b', operationId: 'inventory-replay' },
        kind: 'inventory.adjust',
        productId: product.id,
        delta: 2,
      },
      {
        schemaVersion: 2,
        operationId: 'category-delete',
        replicaId: 'replica-a',
        version: { logicalTime: 7, replicaId: 'replica-a', operationId: 'category-delete' },
        kind: 'category.delete',
        categoryId: 'c-drinks',
      },
      {
        schemaVersion: 2,
        operationId: 'delete-final',
        replicaId: 'replica-b',
        version: { logicalTime: 8, replicaId: 'replica-b', operationId: 'delete-final' },
        kind: 'product.delete',
        productId: product.id,
      },
    ]
    const uninterrupted = new VersionedRetailRuntime({ products: [product], categories: [] })
    for (const operation of operations) uninterrupted.apply(operation)

    const replayed = new VersionedRetailRuntime({ products: [product], categories: [] })
    for (const operation of [...operations, ...operations]) replayed.apply(operation)

    expect(replayed.snapshot()).toEqual(uninterrupted.snapshot())
    expect(replayed.catalog()).toEqual(uninterrupted.catalog())
  })
})
