import { afterEach, describe, expect, it } from 'vitest'
import { createHarness } from '@/test/harness'
import { buildSeed } from '@/data/seed'
import { createMemoryStorage } from '@/lib/storage'
import { MockRepository } from './MockRepository'
import { SyncEngine } from '@/services/sync/SyncEngine'
import { ValidationError, type ProductInput } from '@/domain/types'
import type { RetailCatalog } from '@/domain/retailSync'

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

  it('hydrates the authoritative backend catalog without overwriting pending local edits', async () => {
    h = createHarness()
    const localPending = await h.repo.updateProduct('p-tea', { ...base, name: 'Local pending tea', categoryId: 'c-drinks' })
    const remote: RetailCatalog = {
      products: [
        { ...localPending, name: 'Remote stale tea' },
        { ...localPending, id: 'p-remote', name: 'Remote product' },
      ],
      categories: [{ id: 'c-remote', name: 'Remote', nameAr: '', description: '', updatedAt: 2 }],
    }

    await h.repo.hydrateCatalog(remote)
    await h.repo.hydrateCatalog(remote)

    const products = await h.repo.getProducts()
    expect(products.find((product) => product.id === 'p-tea')?.name).toBe('Local pending tea')
    expect(products.find((product) => product.id === 'p-remote')?.name).toBe('Remote product')
    expect(products.some((product) => product.id === 'p-water')).toBe(false)
    expect(products.filter((product) => product.id === 'p-remote')).toHaveLength(1)

    const categories = await h.repo.getCategories()
    expect(categories.map((category) => category.id)).toEqual(['c-remote'])
  })

  it('preserves pending local creates and stock edits during remote deletion and hydration', async () => {
    h = createHarness()
    const created = await h.repo.createProduct({ ...base, name: 'Pending local product', categoryId: 'c-drinks' })
    await h.repo.adjustStock({ productId: 'p-tea', type: 'add', quantity: 2, reason: 'restock', notes: '' })
    const pendingIds = new Set(h.sync.getSnapshot().pending.map((change) => change.entityId))

    await h.repo.hydrateCatalog({ products: [], categories: [] })

    const products = await h.repo.getProducts()
    expect(products.some((product) => product.id === created.id)).toBe(true)
    expect(products.find((product) => product.id === 'p-tea')?.stock).toBe(36)
    expect(h.sync.getSnapshot().pending.map((change) => change.entityId)).toEqual(expect.arrayContaining([...pendingIds]))
  })

  it('accepts an empty backend catalog as authoritative when there are no pending edits', async () => {
    h = createHarness()
    await h.repo.hydrateCatalog({ products: [], categories: [] })
    expect(await h.repo.getProducts()).toEqual([])
    expect(await h.repo.getCategories()).toEqual([])
  })

  it('keeps hydrated catalog data stable after local repository restart', async () => {
    const storage = createMemoryStorage()
    const seed = buildSeed(1)
    const catalog: RetailCatalog = {
      products: [{ ...seed.products[0], name: 'Persisted remote product' }],
      categories: [seed.categories[0]],
    }
    const firstEngine = new SyncEngine({ storage, isAutoSyncEnabled: () => false })
    const firstRepo = new MockRepository(firstEngine, storage, seed, { latencyMs: 0 })
    await firstRepo.hydrateCatalog(catalog)
    firstEngine.dispose()

    const secondEngine = new SyncEngine({ storage, isAutoSyncEnabled: () => false })
    const secondRepo = new MockRepository(secondEngine, storage, seed, { latencyMs: 0 })
    await secondRepo.hydrateCatalog(catalog)
    expect((await secondRepo.getProducts()).map((product) => product.id)).toEqual([seed.products[0].id])
    expect((await secondRepo.getProducts())[0].name).toBe('Persisted remote product')
    secondEngine.dispose()
  })
})
