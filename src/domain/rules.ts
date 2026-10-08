import type { AdjustmentType, ProductInput, StockAdjustmentInput, StockLevel } from './types'

export const PRODUCT_LIMITS = { name: 60, description: 240, maxPrice: 1_000_000, maxStock: 100_000 } as const

export function stockLevel(stock: number, threshold: number): StockLevel {
  if (stock < 0) return 'negative'
  if (stock === 0) return 'out'
  if (stock <= threshold) return 'low'
  return 'ok'
}

export type FieldErrors<K extends string = string> = Partial<Record<K, string>>

export function validateProduct(input: ProductInput): FieldErrors<keyof ProductInput> {
  const e: FieldErrors<keyof ProductInput> = {}
  if (!input.name.trim()) e.name = 'Enter a product name.'
  else if (input.name.length > PRODUCT_LIMITS.name) e.name = `Keep the name under ${PRODUCT_LIMITS.name} characters.`
  if (input.description.length > PRODUCT_LIMITS.description)
    e.description = `Keep the description under ${PRODUCT_LIMITS.description} characters.`
  if (!Number.isFinite(input.price) || input.price <= 0) e.price = 'Enter a price greater than 0 DA.'
  else if (!Number.isInteger(input.price)) e.price = 'Prices are whole dinars (no decimals).'
  else if (input.price > PRODUCT_LIMITS.maxPrice) e.price = 'That price looks too high. Check the amount.'
  if (!input.categoryId) e.categoryId = 'Choose a category.'
  if (!Number.isInteger(input.stock)) e.stock = 'Stock must be a whole number.'
  else if (input.stock < 0) e.stock = 'Stock cannot be set below 0 from here.'
  else if (input.stock > PRODUCT_LIMITS.maxStock) e.stock = 'That quantity looks too high.'
  if (!Number.isInteger(input.lowStockThreshold) || input.lowStockThreshold < 0)
    e.lowStockThreshold = 'Enter 0 or a positive whole number.'
  return e
}

export function validateCategoryName(name: string): string | undefined {
  if (!name.trim()) return 'Enter a category name.'
  if (name.length > 40) return 'Keep the name under 40 characters.'
  return undefined
}

export function adjustmentDelta(type: AdjustmentType, quantity: number, currentStock: number): number {
  if (type === 'add') return quantity
  if (type === 'remove') return -quantity
  return quantity - currentStock
}

export function validateAdjustment(input: StockAdjustmentInput): FieldErrors<keyof StockAdjustmentInput> {
  const e: FieldErrors<keyof StockAdjustmentInput> = {}
  if (!Number.isInteger(input.quantity)) e.quantity = 'Enter a whole number.'
  else if (input.type !== 'correct' && input.quantity <= 0) e.quantity = 'Enter a quantity greater than 0.'
  else if (input.type === 'correct' && input.quantity < 0) e.quantity = 'The counted stock cannot be negative.'
  else if (input.quantity > PRODUCT_LIMITS.maxStock) e.quantity = 'That quantity looks too high.'
  if (input.type === 'correct' && input.reason !== 'correction') e.reason = 'Corrections use the "Correction" reason.'
  return e
}
