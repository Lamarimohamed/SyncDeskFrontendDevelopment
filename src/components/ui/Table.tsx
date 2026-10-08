import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/cn'

export function TableWrap({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('scroll-thin overflow-x-auto', className)}>{children}</div>
}

export function Table({ caption, className, children }: { caption: string; className?: string; children: ReactNode }) {
  return (
    <table className={cn('w-full text-start', className)}>
      <caption className="sr-only">{caption}</caption>
      {children}
    </table>
  )
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="border-b border-line bg-subtle/60">{children}</thead>
}

export function TR({ className, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('border-b border-line transition-colors duration-150 last:border-b-0 hover:bg-subtle/60', className)} {...rest} />
}

export type SortDirection = 'asc' | 'desc'

interface THProps extends Omit<ThHTMLAttributes<HTMLTableCellElement>, 'align'> {
  align?: 'start' | 'end'
  sortable?: boolean
  sorted?: SortDirection | null
  onSort?: () => void
}

export function TH({ align = 'start', sortable, sorted, onSort, className, children, ...rest }: THProps) {
  const ariaSort = sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : sortable ? 'none' : undefined
  const Icon = sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ChevronsUpDown
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={cn('type-table-head h-10 px-4 font-medium whitespace-nowrap text-muted', align === 'end' ? 'text-end' : 'text-start', className)}
      {...rest}
    >
      {sortable ? (
        <button
          type="button"
          onClick={onSort}
          className={cn(
            '-mx-1.5 inline-flex items-center gap-1 rounded-control px-1.5 py-1 transition-colors duration-150 hover:text-fg',
            sorted && 'text-fg',
          )}
        >
          {children}
          <Icon aria-hidden className={cn('size-3.5', !sorted && 'opacity-50')} />
        </button>
      ) : (
        children
      )}
    </th>
  )
}

export function TD({ align = 'start', className, ...rest }: Omit<TdHTMLAttributes<HTMLTableCellElement>, 'align'> & { align?: 'start' | 'end' }) {
  return <td className={cn('type-body px-4 py-3 align-middle', align === 'end' ? 'text-end' : 'text-start', className)} {...rest} />
}
