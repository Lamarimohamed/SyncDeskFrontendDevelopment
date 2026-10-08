import { afterEach, describe, expect, it } from 'vitest'
import { createHarness } from '@/test/harness'
import { ValidationError, type ProductInput } from '@/domain/types'

const base: ProductInput = {
  name: 'Mint lemonade',
  nameAr: 'ليموناضة بالنعناع',
  description: 'Fresh.',
  descriptionAr: '',
  price: 180,
  categoryId: 'c-drinks',
  availability: 'available',
  stock: 12,
  lowStockThreshold: 5,
}

let h: ReturnType<typeof createHarness>
afterEach(() => h?.dispose())

describe('MockRepository products', () => {
  it('creates, updates and deletes a product, queueing local changes', async () => {
    h = createHarness()
    await h.sync.goOffline()
    const created = await h.repo.createProduct(base)
    expect((await h.repo.getProducts()).some((p) => p.id === created.id)).toBe(true)

    const updated = await h.repo.updateProduct(created.id, { ...base, name: 'Lemonade' })
    expect(updated.name).toBe('Lemonade')

    await h.repo.deleteProduct(created.id)
    expect((await h.repo.getProducts()).some((p) => p.id === created.id)).toBe(false)
    expect(h.sync.getSnapshot().pending.length).toBeGreaterThan(0)
  })

  it('restores a deleted product (undo)', async () => {
    h = createHarness()
    const before = (await h.repo.getProducts()).length
    const removed = await h.repo.deleteProduct('p-tea')
    expect((await h.repo.getProducts()).length).toBe(before - 1)
    await h.repo.restoreProduct(removed)
    expect((await h.repo.getProducts()).length).toBe(before)
  })

  it('rejects invalid input with field errors', async () => {
    h = createHarness()
    const err = await h.repo.createProduct({ ...base, name: '', price: -5 }).catch((e) => e)
    expect(err).toBeInstanceOf(ValidationError)
    expect(err.fieldErrors.name).toBeTruthy()
  })

  it('refuses to delete a category that still has products', async () => {
    h = createHarness()
    await expect(h.repo.deleteCategory('c-drinks')).rejects.toBeInstanceOf(ValidationError)
  })

  it('allows stock to go negative and reports the level honestly', async () => {
    h = createHarness()
    await h.repo.adjustStock({ productId: 'p-water', type: 'remove', quantity: 5, reason: 'sale', notes: '' })
    const water = await h.repo.getProduct('p-water')
    expect(water.stock).toBe(-5)
    expect(water.stockLevel).toBe('negative')
  })
})
