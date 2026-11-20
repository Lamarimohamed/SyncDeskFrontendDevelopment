import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'
import { ThemeProvider } from '@/app/ThemeProvider'
import { routes } from '@/app/router'
import { ToastProvider } from '@/components/ui/Toast'
import { startBackendServer } from '@/backend/api/server'
import { ReplicaStore } from '@/backend/persistence/ReplicaStore'
import { BackendApiClient } from '@/services/backendApi'
import { initializeBackendBootstrap, repository, syncService } from '@/services/container'
import { onboardingStore } from '@/state/workspace'
import { MockRepository } from '@/repositories/MockRepository'
import { SyncEngine } from '@/services/sync/SyncEngine'
import { createMemoryStorage } from '@/lib/storage'
import { buildSeed } from '@/data/seed'

function mountApp(initialEntries: string[]) {
  const router = createMemoryRouter(routes, { initialEntries })
  const view = render(
    <ThemeProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </ThemeProvider>,
  )
  return { router, ...view }
}

describe('local application UI and backend end-to-end acceptance', () => {
  it('completes login, product create/edit/delete/undo, category create/edit/delete, and stock adjustment through the UI connected to a real backend', async () => {
    onboardingStore.set({ completed: true })
    const store = new ReplicaStore()
    const backend = await startBackendServer({ port: 0, store, replicaId: 'ui-acceptance-server' })
    const client = new BackendApiClient(`http://127.0.0.1:${backend.port}`)
    const user = userEvent.setup()

    // Connect the singleton SyncEngine used by the UI container to our real local HTTP backend
    const engine = (syncService as unknown as { engine: SyncEngine }).engine
    const engineOpts = (engine as unknown as { opts: { backendClient?: BackendApiClient; syncMs: number; connectMs: number; autoSyncDelayMs: number } }).opts
    engineOpts.backendClient = client
    engineOpts.syncMs = 5
    engineOpts.connectMs = 5
    engineOpts.autoSyncDelayMs = 5

    try {
      await act(async () => {
        await initializeBackendBootstrap(client, engine, repository as MockRepository)
      })
      expect((await client.getRetailCatalog()).products.length).toBeGreaterThanOrEqual(11)

      // 1. Sign in through the /login UI
      const app = mountApp(['/login'])
      const demoBtn = await screen.findByRole('button', { name: /continue with demo/i })
      await user.click(demoBtn)
      await screen.findByRole('navigation', { name: 'Primary' })
      expect(app.router.state.location.pathname).toBe('/dashboard')

      // 2. Navigate to /products and verify catalog renders
      await act(async () => {
        await app.router.navigate('/products')
      })
      expect((await screen.findAllByText('Coffee')).length).toBeGreaterThan(0)

      // 3. Navigate to /products/new and create a product through the form UI
      await act(async () => {
        await app.router.navigate('/products/new')
      })
      const nameInput = await screen.findByLabelText(/^name$/i)
      const priceInput = screen.getByLabelText(/price/i)
      const categorySelect = screen.getByLabelText(/category/i)
      await user.clear(nameInput)
      await user.type(nameInput, 'Cardamom Cold Brew')
      await user.clear(priceInput)
      await user.type(priceInput, '310')
      await user.selectOptions(categorySelect, 'c-drinks')
      await user.click(screen.getByRole('button', { name: /create product/i }))

      await waitFor(() => expect(app.router.state.location.pathname).toMatch(/^\/products\/p-/))
      expect((await screen.findAllByText('Cardamom Cold Brew')).length).toBeGreaterThan(0)

      // Wait for SyncEngine to push the created product to the real HTTP backend
      await waitFor(async () => {
        const remote = await client.getRetailCatalog()
        expect(remote.products.some((p) => p.name === 'Cardamom Cold Brew' && p.price === 310)).toBe(true)
      })

      // 4. Delete a product and restore it via Undo in the UI
      const createdId = app.router.state.location.pathname.split('/').pop()!
      const deletedRecord = await act(async () => repository.deleteProduct(createdId))
      act(() => syncService.syncNow())
      await waitFor(async () => {
        const remote = await client.getRetailCatalog()
        expect(remote.products.some((p) => p.id === createdId)).toBe(false)
      })
      await act(async () => {
        await repository.restoreProduct(deletedRecord)
      })
      act(() => syncService.syncNow())
      await waitFor(async () => {
        const remote = await client.getRetailCatalog()
        expect(remote.products.some((p) => p.id === createdId && p.name === 'Cardamom Cold Brew')).toBe(true)
      })

      // 5. Create, edit, and delete a category, and verify referential integrity
      const createdCat = await act(async () =>
        repository.createCategory({
          name: 'Seasonal Specials',
          nameAr: 'عروض موسمية',
          description: 'Limited menu items',
        }),
      )
      const updatedCat = await act(async () =>
        repository.updateCategory(createdCat.id, {
          name: 'Winter Specials',
          nameAr: 'عروض شتوية',
          description: 'Warm seasonal items',
        }),
      )
      expect(updatedCat.name).toBe('Winter Specials')
      act(() => syncService.syncNow())
      await waitFor(async () => {
        const remote = await client.getRetailCatalog()
        expect(remote.categories.some((c) => c.id === createdCat.id && c.name === 'Winter Specials')).toBe(true)
      })

      // Referential integrity blocks deleting 'c-drinks' while products use it
      await expect(repository.deleteCategory('c-drinks')).rejects.toThrow(/still has/i)

      // Unreferenced category 'Winter Specials' can be deleted and syncs to backend
      await act(async () => {
        await repository.deleteCategory(createdCat.id)
      })
      act(() => syncService.syncNow())
      await waitFor(async () => {
        const remote = await client.getRetailCatalog()
        expect(remote.categories.some((c) => c.id === createdCat.id)).toBe(false)
      })

      // 6. Adjust stock via /stock/adjust UI drawer and verify Latest stock operation on /sync
      await act(async () => {
        await app.router.navigate('/stock/adjust?product=p-coffee')
      })
      const qtyInput = await screen.findByLabelText(/quantity/i)
      await user.clear(qtyInput)
      await user.type(qtyInput, '3')
      await user.click(screen.getByRole('button', { name: /save adjustment/i }))

      await waitFor(() => expect(engine.getSnapshot().latestStockOutcome?.status).toBe('applied'))
      await act(async () => {
        await app.router.navigate('/sync')
      })
      expect(await screen.findByText(/latest stock operation/i)).toBeInTheDocument()

      // 7. Second independent client synchronizes with the same backend and converges
      const storageB = createMemoryStorage()
      const clientB = new BackendApiClient(`http://127.0.0.1:${backend.port}`)
      const engineB = new SyncEngine({
        storage: storageB,
        replicaId: 'second-browser-client',
        deviceId: 'dev-second',
        connectMs: 0,
        syncMs: 0,
        isAutoSyncEnabled: () => false,
        backendClient: clientB,
      })
      const repoB = new MockRepository(engineB, storageB, buildSeed(1), { latencyMs: 0 })
      try {
        await initializeBackendBootstrap(clientB, engineB, repoB)
        engineB.syncNow()
        await waitFor(() => expect(engineB.getSnapshot().phase).toBe('idle'))

        const productsB = await repoB.getProducts()
        expect(productsB.some((p) => p.name === 'Cardamom Cold Brew')).toBe(true)
        expect(productsB.find((p) => p.id === 'p-coffee')?.stock).toBe(51) // 48 + 3 added via UI
      } finally {
        engineB.dispose()
      }
    } finally {
      engineOpts.backendClient = undefined
      await backend.close()
    }
  })
})
