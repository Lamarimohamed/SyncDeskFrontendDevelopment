import { Eye, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { Dropdown, type MenuItem } from '@/components/ui/Dropdown'
import { AvailabilityBadge, EntitySyncBadge, StockBadge } from '@/components/ui/StatusBadge'
import { Table, TableWrap, TD, TH, THead, TR, type SortDirection } from '@/components/ui/Table'
import { Link } from 'react-router'
import { formatDA } from '@/lib/format'
import type { ProductRecord } from '@/domain/types'

interface Props {
  products: ProductRecord[]
  sort: string
  onSort: (key: 'name' | 'price' | 'stock') => void
  onDelete: (product: ProductRecord) => void
}

function menuFor(p: ProductRecord, onDelete: (p: ProductRecord) => void): MenuItem[] {
  return [
    { label: 'View details', icon: Eye, to: `/products/${p.id}` },
    { label: 'Edit', icon: Pencil, to: `/products/${p.id}/edit` },
    'separator',
    { label: 'Delete', icon: Trash2, tone: 'danger', onSelect: () => onDelete(p) },
  ]
}

function RowActions({ product, onDelete }: { product: ProductRecord; onDelete: (p: ProductRecord) => void }) {
  return (
    <Dropdown
      label={`Actions for ${product.name}`}
      items={menuFor(product, onDelete)}
      triggerClassName="inline-flex size-9 items-center justify-center rounded-control text-fg2 hover:bg-subtle hover:text-fg max-sm:size-11"
      trigger={<MoreHorizontal aria-hidden className="size-4" />}
    />
  )
}

export function ProductsTable({ products, sort, onSort, onDelete }: Props) {
  const [key, dir] = sort.split('-') as [string, SortDirection]
  const sorted = (k: string): SortDirection | null => (key === k ? dir : null)
  return (
    <>
      <TableWrap className="hidden md:block">
        <Table caption="Products">
          <THead>
            <tr>
              <TH sortable sorted={sorted('name')} onSort={() => onSort('name')}>Product</TH>
              <TH>Category</TH>
              <TH align="end" sortable sorted={sorted('price')} onSort={() => onSort('price')}>Price</TH>
              <TH align="end" sortable sorted={sorted('stock')} onSort={() => onSort('stock')}>Stock</TH>
              <TH>Status</TH>
              <TH>Sync</TH>
              <TH align="end"><span className="sr-only">Actions</span></TH>
            </tr>
          </THead>
          <tbody>
            {products.map((p) => (
              <TR key={p.id}>
                <TD className="max-w-64">
                  <Link to={`/products/${p.id}`} className="type-label block truncate text-fg hover:underline">
                    {p.name}
                  </Link>
                  <span dir="rtl" lang="ar" className="type-caption block truncate text-muted">{p.nameAr}</span>
                </TD>
                <TD className="text-fg2">{p.categoryName}</TD>
                <TD align="end" className="tabular whitespace-nowrap">{formatDA(p.price)}</TD>
                <TD align="end" className="tabular">{p.stock}</TD>
                <TD>
                  <div className="flex flex-wrap gap-1">
                    <StockBadge level={p.stockLevel} />
                    {p.availability === 'unavailable' ? <AvailabilityBadge value={p.availability} /> : null}
                  </div>
                </TD>
                <TD><EntitySyncBadge state={p.syncState} /></TD>
                <TD align="end"><RowActions product={p} onDelete={onDelete} /></TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      <ul className="divide-y divide-line md:hidden" aria-label="Products">
        {products.map((p) => (
          <li key={p.id} className="flex items-start gap-2 px-4 py-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Link to={`/products/${p.id}`} className="type-label block text-fg hover:underline">
                {p.name}
              </Link>
              <p className="type-body-sm text-fg2">
                {p.categoryName} · <span className="tabular">{formatDA(p.price)}</span>
              </p>
              <p className="type-body-sm text-fg2">
                Stock <span className="tabular font-medium text-fg">{p.stock}</span>
              </p>
              <div className="flex flex-wrap gap-1">
                <StockBadge level={p.stockLevel} />
                {p.availability === 'unavailable' ? <AvailabilityBadge value={p.availability} /> : null}
                <EntitySyncBadge state={p.syncState} />
              </div>
            </div>
            <RowActions product={p} onDelete={onDelete} />
          </li>
        ))}
      </ul>
    </>
  )
}
