import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Input, Select } from '@/components/ui/Input'
import { ListSkeleton, TableSkeleton } from '@/components/ui/Skeleton'
import { StockBadge } from '@/components/ui/StatusBadge'
import { Table, TableWrap, TD, TH, THead, TR, type SortDirection } from '@/components/ui/Table'
import { useToast } from '@/components/ui/Toast'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useRepositoryQuery } from '@/hooks/useRepositoryQuery'
import { useSyncSnapshot } from '@/hooks/useSync'
import { useUrlState } from '@/hooks/useUrlState'
import type { StockRow } from '@/domain/types'
import { formatDateTime, plural } from '@/lib/format'
import { repository } from '@/services/container'
import { AdjustStockDrawer } from './AdjustStockDrawer'

const DEFAULTS = { q: '', level: 'all', sort: 'name-asc' }

function sortRows(rows: StockRow[], sort: string) {
  const [key, dir] = sort.split('-')
  const m = dir === 'desc' ? -1 : 1
  return [...rows].sort((a, b) =>
    key === 'stock' ? m * (a.product.stock - b.product.stock) : m * a.product.name.localeCompare(b.product.name),
  )
}

export function StockPage() {
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { connectivity } = useSyncSnapshot()
  const drawerOpen = pathname.endsWith('/adjust')
  const preselect = params.get('product') ?? undefined

  const { values, set, clear, isDefault } = useUrlState(DEFAULTS)
  const stock = useRepositoryQuery(() => repository.getStock())
  const history = useRepositoryQuery(() => repository.getStockHistory())

  const [search, setSearch] = useState(values.q)
  const debounced = useDebouncedValue(search, 250)
  useEffect(() => {
    if (debounced.trim() !== values.q) set({ q: debounced.trim() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  const rows = useMemo(() => {
    const q = values.q.toLowerCase()
    const list = (stock.data ?? []).filter(
      ({ product: p }) =>
        (!q || p.name.toLowerCase().includes(q) || p.nameAr.toLowerCase().includes(q) || p.categoryName.toLowerCase().includes(q)) &&
        (values.level === 'all' || p.stockLevel === values.level),
    )
    return sortRows(list, values.sort)
  }, [stock.data, values])

  const names = useMemo(() => new Map((stock.data ?? []).map((r) => [r.product.id, r.product.name])), [stock.data])

  function clearAll() {
    setSearch('')
    clear()
  }
  function toggleSort(key: 'name' | 'stock') {
    const [k, d] = values.sort.split('-')
    set({ sort: `${key}-${k === key && d === 'asc' ? 'desc' : 'asc'}` })
  }
  const [sk, sd] = values.sort.split('-') as [string, SortDirection]
  const closeDrawer = () => navigate('/stock')
  const adjustTo = (id: string) => `/stock/adjust?product=${id}`

  const total = stock.data?.length ?? 0

  return (
    <>
      <PageHeader
        title="Stock"
        description="Current quantities on this device. Adjustments are merged additively across devices."
        actions={
          <Button variant="primary" icon={<SlidersHorizontal aria-hidden className="size-4" />} onClick={() => navigate('/stock/adjust')}>
            Adjust stock
          </Button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          {stock.status === 'loading' ? (
            <TableSkeleton rows={8} columns={5} label="Loading stock" />
          ) : stock.status === 'error' ? (
            <ErrorState
              title="Stock could not be loaded"
              description={stock.error?.message}
              reassurance="Nothing was lost. Your data on this device is unchanged."
              onRetry={stock.reload}
            />
          ) : total === 0 ? (
            <EmptyState
              icon={SlidersHorizontal}
              title="No products to track"
              description="Stock is tracked per product. Add a product first, then adjust its quantity here."
              actions={<Link to="/products/new" className="type-button text-primary-text hover:underline">Create a product</Link>}
            />
          ) : (
            <>
              <form role="search" aria-label="Filter stock" onSubmit={(e) => e.preventDefault()} className="space-y-3 p-4">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))]">
                  <label className="block">
                    <span className="sr-only">Search stock</span>
                    <Input
                      type="search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search by product or category"
                      start={<Search aria-hidden className="size-4" />}
                    />
                  </label>
                  <label className="block">
                    <span className="sr-only">Stock level</span>
                    <Select value={values.level} onChange={(e) => set({ level: e.target.value })}>
                      <option value="all">All levels</option>
                      <option value="low">Low stock</option>
                      <option value="out">Out of stock</option>
                      <option value="negative">Needs reconciliation</option>
                    </Select>
                  </label>
                  <label className="block">
                    <span className="sr-only">Sort by</span>
                    <Select value={values.sort} onChange={(e) => set({ sort: e.target.value })}>
                      <option value="name-asc">Sort: Name A to Z</option>
                      <option value="name-desc">Sort: Name Z to A</option>
                      <option value="stock-asc">Sort: Stock low to high</option>
                      <option value="stock-desc">Sort: Stock high to low</option>
                    </Select>
                  </label>
                </div>
                {!isDefault || search ? (
                  <Button size="sm" variant="ghost" icon={<X aria-hidden className="size-4" />} onClick={clearAll}>
                    Clear filters
                  </Button>
                ) : null}
              </form>
              <p className="sr-only" role="status" aria-live="polite">{plural(rows.length, 'product')} shown</p>

              {rows.length === 0 ? (
                <div className="border-t border-line">
                  <EmptyState
                    compact
                    icon={SlidersHorizontal}
                    title="No products match these filters"
                    description={values.level === 'negative' ? 'No product currently needs reconciliation.' : 'Try a different search term or stock level.'}
                    actions={<Button onClick={clearAll}>Clear filters</Button>}
                  />
                </div>
              ) : (
                <div className="border-t border-line">
                  <TableWrap className="hidden md:block">
                    <Table caption="Stock levels">
                      <THead>
                        <tr>
                          <TH sortable sorted={sk === 'name' ? sd : null} onSort={() => toggleSort('name')}>Product</TH>
                          <TH align="end" sortable sorted={sk === 'stock' ? sd : null} onSort={() => toggleSort('stock')}>Stock</TH>
                          <TH>Level</TH>
                          <TH>Last adjustment</TH>
                          <TH align="end"><span className="sr-only">Actions</span></TH>
                        </tr>
                      </THead>
                      <tbody>
                        {rows.map(({ product: p, lastAdjustment }) => (
                          <TR key={p.id}>
                            <TD>
                              <Link to={`/products/${p.id}`} className="type-label text-fg hover:underline">{p.name}</Link>
                              <span className="type-caption block text-muted">{p.categoryName}</span>
                            </TD>
                            <TD align="end" className="tabular font-medium">{p.stock}</TD>
                            <TD><StockBadge level={p.stockLevel} /></TD>
                            <TD className="type-body-sm text-fg2">
                              {lastAdjustment ? (
                                <>
                                  <span className="tabular">{lastAdjustment.delta > 0 ? '+' : ''}{lastAdjustment.delta}</span>
                                  <span className="block text-muted">{formatDateTime(lastAdjustment.createdAt)}</span>
                                </>
                              ) : (
                                <span className="text-muted">None recorded</span>
                              )}
                            </TD>
                            <TD align="end">
                              <Button size="sm" onClick={() => navigate(adjustTo(p.id))} aria-label={`Adjust stock for ${p.name}`}>Adjust</Button>
                            </TD>
                          </TR>
                        ))}
                      </tbody>
                    </Table>
                  </TableWrap>
                  <ul className="divide-y divide-line md:hidden" aria-label="Stock levels">
                    {rows.map(({ product: p }) => (
                      <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1 space-y-1">
                          <Link to={`/products/${p.id}`} className="type-label block text-fg hover:underline">{p.name}</Link>
                          <p className="type-body-sm text-fg2">
                            <span className="tabular font-medium text-fg">{p.stock}</span> in stock
                          </p>
                          <StockBadge level={p.stockLevel} />
                        </div>
                        <Button size="sm" onClick={() => navigate(adjustTo(p.id))} aria-label={`Adjust stock for ${p.name}`}>Adjust</Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </Card>

        <Card className="h-fit min-w-0">
          <CardHeader title="Recent movements" description="Newest adjustments on this device." />
          {history.status === 'loading' ? (
            <ListSkeleton rows={5} label="Loading movements" />
          ) : history.status === 'error' ? (
            <ErrorState title="Movements could not be loaded" onRetry={history.reload} />
          ) : (history.data ?? []).length === 0 ? (
            <EmptyState compact title="No movements yet" description="Stock adjustments will be listed here." />
          ) : (
            <ul className="divide-y divide-line">
              {(history.data ?? []).slice(0, 8).map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="type-body truncate text-fg">{names.get(h.productId) ?? 'Deleted product'}</p>
                    <p className="type-caption text-muted capitalize">
                      {h.reason} · {formatDateTime(h.createdAt)}
                    </p>
                  </div>
                  <div className="text-end">
                    <p className={`type-body tabular font-medium ${h.delta < 0 ? 'text-error-fg' : 'text-fg'}`}>
                      {h.delta > 0 ? '+' : ''}{h.delta}
                    </p>
                    <p className="type-caption tabular text-muted">now {h.resultingStock}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <AdjustStockDrawer
        open={drawerOpen && stock.status === 'success'}
        products={(stock.data ?? []).map((r) => r.product)}
        initialProductId={preselect}
        onClose={closeDrawer}
        onSaved={(adj, product) => {
          const after = adj.resultingStock
          toast.show({
            title: 'Saved locally',
            description: `${product.name}: ${product.stock} to ${after}. ${
              connectivity === 'offline' ? 'Will synchronize when this device reconnects.' : 'Synchronization is pending.'
            }${after < 0 ? ' Flagged as needing reconciliation.' : ''}`,
            tone: 'success',
          })
          closeDrawer()
        }}
      />
    </>
  )
}
