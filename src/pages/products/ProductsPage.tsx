import { useEffect, useMemo, useState } from 'react'
import { Package, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Pagination } from '@/components/ui/Pagination'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useRepositoryQuery } from '@/hooks/useRepositoryQuery'
import { useUrlState } from '@/hooks/useUrlState'
import type { ProductRecord } from '@/domain/types'
import { plural } from '@/lib/format'
import { repository } from '@/services/container'
import { ProductFilters } from './ProductFilters'
import { ProductsTable } from './ProductsTable'

const PAGE_SIZE = 10
const DEFAULTS = { q: '', category: 'all', availability: 'all', stock: 'all', sort: 'updated-desc', page: '1' }

function sortProducts(list: ProductRecord[], sort: string): ProductRecord[] {
  const [key, dir] = sort.split('-')
  const m = dir === 'desc' ? -1 : 1
  return [...list].sort((a, b) => {
    switch (key) {
      case 'name':
        return m * a.name.localeCompare(b.name)
      case 'price':
        return m * (a.price - b.price)
      case 'stock':
        return m * (a.stock - b.stock)
      default:
        return m * (a.updatedAt - b.updatedAt)
    }
  })
}

export function ProductsPage() {
  const toast = useToast()
  const { values, set, clear, isDefault } = useUrlState(DEFAULTS)
  const products = useRepositoryQuery(() => repository.getProducts())
  const categories = useRepositoryQuery(() => repository.getCategories())

  const [search, setSearch] = useState(values.q)
  const debounced = useDebouncedValue(search, 250)
  useEffect(() => {
    if (debounced.trim() !== values.q) set({ q: debounced.trim(), page: '1' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  const [toDelete, setToDelete] = useState<ProductRecord | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = values.q.toLowerCase()
    const list = (products.data ?? []).filter((p) => {
      if (q && ![p.name, p.nameAr, p.description, p.categoryName].some((s) => s.toLowerCase().includes(q))) return false
      if (values.category !== 'all' && p.categoryId !== values.category) return false
      if (values.availability !== 'all' && p.availability !== values.availability) return false
      if (values.stock !== 'all' && p.stockLevel !== values.stock) return false
      return true
    })
    return sortProducts(list, values.sort)
  }, [products.data, values])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const page = Math.min(Math.max(1, Number.parseInt(values.page, 10) || 1), pageCount)
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function clearAll() {
    setSearch('')
    clear()
  }

  function toggleSort(key: 'name' | 'price' | 'stock') {
    const [k, d] = values.sort.split('-')
    set({ sort: `${key}-${k === key && d === 'asc' ? 'desc' : 'asc'}`, page: '1' })
  }

  async function confirmDelete() {
    if (!toDelete) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const removed = await repository.deleteProduct(toDelete.id)
      setToDelete(null)
      toast.show({
        title: `Deleted "${removed.name}"`,
        description: 'Saved locally. It will synchronize when a connection is available.',
        tone: 'success',
        action: {
          label: 'Undo',
          onAction: () => {
            repository.restoreProduct(removed).then(
              () => toast.show({ title: `Restored "${removed.name}"`, tone: 'success' }),
              (e: unknown) =>
                toast.show({ title: 'Could not restore the product', description: e instanceof Error ? e.message : undefined, tone: 'error' }),
            )
          },
        },
      })
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'The product could not be deleted.')
    } finally {
      setDeleting(false)
    }
  }

  const total = products.data?.length ?? 0

  return (
    <>
      <PageHeader
        title="Products"
        description="Your catalog on this device. Changes are saved locally first and synchronized when connected."
        actions={
          <ButtonLink variant="primary" to="/products/new" icon={<Plus aria-hidden className="size-4" />}>
            New product
          </ButtonLink>
        }
      />
      <Card>
        {products.status === 'error' ? (
          <ErrorState
            title="Products could not be loaded"
            description={products.error?.message}
            reassurance="Nothing was lost. Your data on this device is unchanged."
            onRetry={products.reload}
          />
        ) : products.status === 'loading' ? (
          <TableSkeleton rows={8} columns={6} label="Loading products" />
        ) : total === 0 ? (
          <EmptyState
            icon={Package}
            title="No products yet"
            description="Add your first product to start tracking prices and stock on this device."
            next="It is saved locally right away and synchronized when a connection is available."
            actions={
              <ButtonLink variant="primary" to="/products/new" icon={<Plus aria-hidden className="size-4" />}>
                New product
              </ButtonLink>
            }
          />
        ) : (
          <>
            <ProductFilters
              search={search}
              onSearch={setSearch}
              values={values}
              categories={categories.data ?? []}
              onChange={(patch) => set({ ...patch, page: '1' })}
              onClear={clearAll}
              canClear={!isDefault || search !== ''}
            />
            <p className="sr-only" role="status" aria-live="polite">
              {plural(filtered.length, 'product')} match
            </p>
            {filtered.length === 0 ? (
              <div className="border-t border-line">
                <EmptyState
                  compact
                  icon={Package}
                  title="No products match these filters"
                  description="Try a different search term or remove a filter."
                  actions={<Button onClick={clearAll}>Clear filters</Button>}
                />
              </div>
            ) : (
              <div className="border-t border-line">
                <ProductsTable products={visible} sort={values.sort} onSort={toggleSort} onDelete={(p) => { setDeleteError(null); setToDelete(p) }} />
                <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} noun="products" onPageChange={(n) => set({ page: String(n) })} />
              </div>
            )}
          </>
        )}
      </Card>

      <ConfirmDialog
        open={toDelete !== null}
        title={toDelete ? `Delete "${toDelete.name}"?` : 'Delete product?'}
        description="The product is removed from this device now and the deletion synchronizes later. You can undo right after."
        confirmLabel="Delete product"
        loading={deleting}
        error={deleteError}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </>
  )
}
