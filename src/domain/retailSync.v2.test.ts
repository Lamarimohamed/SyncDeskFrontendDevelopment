import { describe, expect, it } from 'vitest'
import {
  compareRetailVersions,
  validateVersionedRetailOperation,
  type RetailVersion,
} from './retailSync'
import { retailVersionOrderingVectors } from './retailSync.testVectors'

const version = (
  operationId: string,
  replicaId: string,
  logicalTime: number,
): RetailVersion => ({ operationId, replicaId, logicalTime })

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

const operation = (changes: Record<string, unknown> = {}): Record<string, unknown> => ({
  schemaVersion: 2,
  operationId: 'op-1',
  replicaId: 'replica-a',
  version: version('op-1', 'replica-a', 10),
  kind: 'product.patch',
  productId: 'p1',
  changes: { name: 'Coffee' },
  ...changes,
})

describe('versioned retail operation primitives', () => {
  it('validates category deletion as a distinct operation', () => {
    expect(() =>
      validateVersionedRetailOperation({
        schemaVersion: 2,
        operationId: 'category-delete',
        replicaId: 'replica-a',
        version: version('category-delete', 'replica-a', 1),
        kind: 'category.delete',
        categoryId: 'c1',
      }),
    ).not.toThrow()
  })

  it('rejects malformed category operations', () => {
    expect(() =>
      validateVersionedRetailOperation({
        schemaVersion: 2,
        operationId: 'bad-category',
        replicaId: 'replica-a',
        version: version('bad-category', 'replica-a', 1),
        kind: 'category.patch',
        categoryId: '',
        changes: { name: '' },
      }),
    ).toThrow()
    expect(() =>
      validateVersionedRetailOperation({
        schemaVersion: 2,
        operationId: 'unsupported-category',
        replicaId: 'replica-a',
        version: version('unsupported-category', 'replica-a', 1),
        kind: 'category.rename',
        categoryId: 'c1',
      }),
    ).toThrow()
  })
  it('compares versions by logical time, then UTF-8 replica and operation bytes', () => {
    expect(compareRetailVersions(version('b', 'a', 2), version('a', 'z', 1))).toBeGreaterThan(0)
    expect(compareRetailVersions(version('a', 'replica-b', 2), version('a', 'replica-a', 2))).toBeGreaterThan(0)
    expect(compareRetailVersions(version('operation-z', 'replica-a', 2), version('operation-a', 'replica-a', 2))).toBeGreaterThan(0)
    expect(compareRetailVersions(version('same', 'same', 1), version('same', 'same', 1))).toBe(0)
  })

  it.each(retailVersionOrderingVectors)(
    'orders $name deterministically',
    ({ left, right, expected }) => {
      expect(Math.sign(compareRetailVersions(left, right))).toBe(expected)
      expect(Math.sign(compareRetailVersions(right, left))).toBe(-expected)
    },
  )

  it('validates product and category field patches without changing the payload', () => {
    const productPatch = validateVersionedRetailOperation(operation({}))
    expect(productPatch).toEqual(operation({}))

    const categoryPatch = validateVersionedRetailOperation({
      schemaVersion: 2,
      operationId: 'category-1',
      replicaId: 'replica-a',
      version: version('category-1', 'replica-a', 10),
      kind: 'category.patch',
      categoryId: 'c1',
      changes: { name: 'Hot drinks', description: 'Served hot' },
    })
    expect(categoryPatch.kind).toBe('category.patch')
  })

  it('validates restore and inventory operations', () => {
    expect(
      validateVersionedRetailOperation({
        schemaVersion: 2,
        operationId: 'restore-1',
        replicaId: 'replica-a',
        version: version('restore-1', 'replica-a', 10),
        kind: 'product.restore',
        productId: 'p1',
        product: { ...product, id: 'p1' },
      }),
    ).toMatchObject({ kind: 'product.restore', productId: 'p1' })

    expect(
      validateVersionedRetailOperation({
        schemaVersion: 2,
        operationId: 'inventory-1',
        replicaId: 'replica-a',
        version: version('inventory-1', 'replica-a', 10),
        kind: 'inventory.adjust',
        productId: 'p1',
        delta: -2,
      }),
    ).toMatchObject({ kind: 'inventory.adjust', delta: -2 })
  })

  it.each([
    ['wrong schema version', operation({ schemaVersion: 1 })],
    ['empty patch', operation({ changes: {} })],
    ['unknown patch field', operation({ changes: { stock: 1 } })],
    ['identity mismatch', operation({ version: version('other', 'replica-a', 10) })],
    ['invalid logical time', operation({ version: version('op-1', 'replica-a', -1) })],
    ['invalid product value', operation({ changes: { price: 0 } })],
    ['zero inventory delta', operation({ kind: 'inventory.adjust', delta: 0 })],
  ])('rejects %s', (_reason, candidate) => {
    expect(() => validateVersionedRetailOperation(candidate)).toThrow(
      'Invalid versioned retail operation:',
    )
  })

  it('rejects restore identity mismatch and extra fields', () => {
    expect(() =>
      validateVersionedRetailOperation({
        schemaVersion: 2,
        operationId: 'restore-1',
        replicaId: 'replica-a',
        version: version('restore-1', 'replica-a', 10),
        kind: 'product.restore',
        productId: 'different-product',
        product,
      }),
    ).toThrow('productId does not match')

    expect(() =>
      validateVersionedRetailOperation({
        ...operation({}),
        kind: 'product.delete',
        unexpected: true,
      }),
    ).toThrow('contains unknown fields')

    expect(() =>
      validateVersionedRetailOperation({
        schemaVersion: 2,
        operationId: 'inventory-1',
        replicaId: 'replica-a',
        version: version('inventory-1', 'replica-a', 10),
        kind: 'inventory.adjust',
        productId: 'p1',
        delta: 1,
        unexpected: true,
      }),
    ).toThrow('contains unknown fields')

    expect(() =>
      validateVersionedRetailOperation({
        schemaVersion: 2,
        operationId: 'restore-1',
        replicaId: 'replica-a',
        version: version('restore-1', 'replica-a', 10),
        kind: 'product.restore',
        productId: 'p1',
        product,
        unexpected: true,
      }),
    ).toThrow('contains unknown fields')
  })
})
