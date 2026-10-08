import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { IconButton } from './Button'

interface PaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  noun?: string
}

export function Pagination({ page, pageSize, total, onPageChange, noun = 'items' }: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
      <p className="type-body-sm text-fg2" aria-live="polite">
        Showing {from}–{to} of {total} {noun}
      </p>
      <div className="flex items-center gap-1">
        <IconButton label="Previous page" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft aria-hidden className="size-4 rtl:rotate-180" />
        </IconButton>
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`Page ${n}`}
            aria-current={n === page ? 'page' : undefined}
            onClick={() => onPageChange(n)}
            className={cn(
              'type-label size-8 rounded-control transition-colors duration-150',
              n === page ? 'bg-primary-soft text-primary-text' : 'text-fg2 hover:bg-subtle',
            )}
          >
            {n}
          </button>
        ))}
        <IconButton label="Next page" size="sm" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
          <ChevronRight aria-hidden className="size-4 rtl:rotate-180" />
        </IconButton>
      </div>
    </nav>
  )
}
