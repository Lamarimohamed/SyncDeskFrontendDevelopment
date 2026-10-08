import { cn } from '@/lib/cn'

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-skeleton rounded-control bg-line', className)} />
}

/** Geometry matches DataTable rows: 48px rows, same column count. */
export function TableSkeleton({ rows = 6, columns = 6, label = 'Loading' }: { rows?: number; columns?: number; label?: string }) {
  return (
    <div role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex h-14 items-center gap-6 border-b border-line px-4 last:border-b-0">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className={cn('h-4', c === 0 ? 'w-40 flex-none' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function ListSkeleton({ rows = 5, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="divide-y divide-line">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="size-6 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function MetricSkeleton() {
  return (
    <div className="rounded-card border border-line bg-surface p-4" aria-hidden>
      <Skeleton className="h-4 w-20" />
      <Skeleton className="mt-2 h-8 w-14" />
      <Skeleton className="mt-2 h-3 w-28" />
    </div>
  )
}
