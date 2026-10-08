import { afterEach, describe, expect, it } from 'vitest'
import { createHarness } from '@/test/harness'
import { deriveIndicatorState } from '@/hooks/useSync'
import type { ProductInput } from '@/domain/types'

const asInput = (p: Awaited<ReturnType<ReturnType<typeof createHarness>['repo']['getProduct']>>, price: number): ProductInput => ({
  name: p.name,
  nameAr: p.nameAr,
  description: p.description,
  descriptionAr: p.descriptionAr,
  price,
  categoryId: p.categoryId,
  availability: p.availability,
  stock: p.stock,
  lowStockThreshold: p.lowStockThreshold,
})

let h: ReturnType<typeof createHarness>
afterEach(() => h?.dispose())

describe('offline-first flow', () => {
  it('starts synchronized with nothing pending', () => {
    h = createHarness()
    const s = h.sync.getSnapshot()
    expect(s.connectivity).toBe('online')
    expect(s.pending).toHaveLength(0)
    expect(deriveIndicatorState(s)).toBe('synchronized')
  })

  it('queues an offline edit as pending and marks the record "saved locally"', async () => {
    h = createHarness()
    await h.sync.goOffline()
    const coffee = await h.repo.getProduct('p-coffee')
    await h.repo.updateProduct('p-coffee', asInput(coffee, 130))

    const s = h.sync.getSnapshot()
    expect(deriveIndicatorState(s)).toBe('offline')
    expect(s.pending).toHaveLength(1)
    expect(s.pending[0]).toMatchObject({ entityId: 'p-coffee', field: 'price', from: '120 DA', to: '130 DA' })
    expect((await h.repo.getProduct('p-coffee')).syncState).not.toBe('synced')
  })

  it('reconnects through connecting and syncing to synchronized with 0 pending', async () => {
    h = createHarness()
    await h.sync.goOffline()
    const coffee = await h.repo.getProduct('p-coffee')
    await h.repo.updateProduct('p-coffee', asInput(coffee, 130))

    const seen: string[] = []
    h.sync.subscribe(() => {
      const st = deriveIndicatorState(h.sync.getSnapshot())
      if (seen[seen.length - 1] !== st) seen.push(st)
    })
    await h.sync.goOnline()
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`did not converge: ${seen.join(',')}`)), 2000)
      const check = () => {
        if (deriveIndicatorState(h.sync.getSnapshot()) === 'synchronized') {
          clearTimeout(t)
          resolve()
        }
      }
      h.sync.subscribe(check)
      check()
    })

    expect(seen).toContain('connecting')
    expect(seen).toContain('syncing')
    expect(h.sync.getSnapshot().pending).toHaveLength(0)
    expect((await h.repo.getProduct('p-coffee')).syncState).toBe('synced')
  })

  it('resolves a concurrent price edit with last-writer-wins and says so in the log', async () => {
    h = createHarness()
    await h.sync.goOffline()
    const coffee = await h.repo.getProduct('p-coffee')
    await h.repo.updateProduct('p-coffee', asInput(coffee, 130))
    await h.sync.simulateConflict()
    await h.sync.goOnline()
    await new Promise((r) => setTimeout(r, 300))
    const s = h.sync.getSnapshot()
    expect(s.pending).toHaveLength(0)
    expect(s.conflicts.length).toBeGreaterThan(0)
    expect(JSON.stringify(s.conflicts[0])).not.toMatch(/both preserved/i)
  })

  it('moves to the error phase on a simulated failure and keeps the change', async () => {
    h = createHarness()
    await h.sync.createPendingChange()
    h.sync.simulateSyncError()
    await h.sync.syncNow()
    await new Promise((r) => setTimeout(r, 100))
    const s = h.sync.getSnapshot()
    expect(deriveIndicatorState(s)).toBe('error')
    expect(s.pending.length).toBeGreaterThan(0)
  })
})
