import { describe, expect, it } from 'vitest'
import { adjustmentDelta, stockLevel, validateAdjustment, validateProduct } from './rules'

const valid = {
  name: 'Coffee',
  nameAr: 'قهوة',
  description: '',
  descriptionAr: '',
  price: 120,
  categoryId: 'c-drinks',
  availability: 'available' as const,
  stock: 10,
  lowStockThreshold: 5,
}

describe('product validation', () => {
  it('accepts a complete product', () => {
    expect(validateProduct(valid)).toEqual({})
  })
  it('rejects an empty name and a negative price', () => {
    const e = validateProduct({ ...valid, name: ' ', price: -1 })
    expect(e.name).toBeTruthy()
    expect(e.price).toBeTruthy()
  })
})

describe('stock rules', () => {
  it('classifies stock levels including negative', () => {
    expect(stockLevel(20, 10)).toBe('ok')
    expect(stockLevel(10, 10)).toBe('low')
    expect(stockLevel(0, 10)).toBe('out')
    expect(stockLevel(-3, 10)).toBe('negative')
  })
  it('derives deltas per adjustment type', () => {
    expect(adjustmentDelta('add', 5, 10)).toBe(5)
    expect(adjustmentDelta('remove', 5, 10)).toBe(-5)
    expect(adjustmentDelta('correct', 7, 10)).toBe(-3)
  })
  it('requires a positive quantity for add/remove', () => {
    expect(validateAdjustment({ productId: 'p', type: 'add', quantity: 0, reason: 'restock', notes: '' }).quantity).toBeTruthy()
  })
})
