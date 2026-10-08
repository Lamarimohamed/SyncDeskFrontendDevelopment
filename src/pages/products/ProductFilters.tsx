import { Search, X } from 'lucide-react'
import { Input, Select } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import type { CategoryRecord } from '@/domain/types'

export const SORT_OPTIONS = [
  { value: 'updated-desc', label: 'Recently updated' },
  { value: 'name-asc', label: 'Name A to Z' },
  { value: 'name-desc', label: 'Name Z to A' },
  { value: 'price-asc', label: 'Price low to high' },
  { value: 'price-desc', label: 'Price high to low' },
  { value: 'stock-asc', label: 'Stock low to high' },
  { value: 'stock-desc', label: 'Stock high to low' },
] as const

export interface ProductFilterValues {
  q: string
  category: string
  availability: string
  stock: string
  sort: string
}

interface Props {
  search: string
  onSearch: (value: string) => void
  values: ProductFilterValues
  categories: CategoryRecord[]
  onChange: (patch: Partial<ProductFilterValues>) => void
  onClear: () => void
  canClear: boolean
}

export function ProductFilters({ search, onSearch, values, categories, onChange, onClear, canClear }: Props) {
  return (
    <form role="search" aria-label="Filter products" onSubmit={(e) => e.preventDefault()} className="space-y-3 p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]">
        <label className="block sm:col-span-2 lg:col-span-1">
          <span className="sr-only">Search products</span>
          <Input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search by name or description"
            start={<Search aria-hidden className="size-4" />}
          />
        </label>
        <label className="block">
          <span className="sr-only">Category</span>
          <Select value={values.category} onChange={(e) => onChange({ category: e.target.value })}>
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="sr-only">Availability</span>
          <Select value={values.availability} onChange={(e) => onChange({ availability: e.target.value })}>
            <option value="all">Any availability</option>
            <option value="available">Available</option>
            <option value="unavailable">Unavailable</option>
          </Select>
        </label>
        <label className="block">
          <span className="sr-only">Stock level</span>
          <Select value={values.stock} onChange={(e) => onChange({ stock: e.target.value })}>
            <option value="all">Any stock level</option>
            <option value="ok">In stock</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
            <option value="negative">Needs reconciliation</option>
          </Select>
        </label>
        <label className="block">
          <span className="sr-only">Sort by</span>
          <Select value={values.sort} onChange={(e) => onChange({ sort: e.target.value })}>
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                Sort: {o.label}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {canClear ? (
        <Button size="sm" variant="ghost" icon={<X aria-hidden className="size-4" />} onClick={onClear}>
          Clear filters
        </Button>
      ) : null}
    </form>
  )
}
