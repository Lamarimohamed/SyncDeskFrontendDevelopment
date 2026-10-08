import { useState } from 'react'
import { MonitorSmartphone } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { DeviceCard } from '@/components/devices/DeviceCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import { useRepositoryQuery } from '@/hooks/useRepositoryQuery'
import { useNow } from '@/hooks/useNow'
import { repository } from '@/services/container'
import { cn } from '@/lib/cn'

type Filter = 'all' | 'online' | 'offline' | 'other'
const filters: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'online', label: 'Online' },
  { id: 'offline', label: 'Offline' },
  { id: 'other', label: 'Other' },
]

export function DevicesPage() {
  const q = useRepositoryQuery(() => repository.getDevices())
  const now = useNow(30_000)
  const [filter, setFilter] = useState<Filter>('all')

  const all = q.data ?? []
  const shown = all.filter((d) =>
    filter === 'all'
      ? true
      : filter === 'online'
        ? d.status === 'online' || d.status === 'syncing'
        : filter === 'offline'
          ? d.status === 'offline'
          : d.status === 'unknown' || d.status === 'evicted',
  )

  return (
    <div>
      <PageHeader
        title="Devices"
        description="Devices in this workspace. This demo simulates the other devices; only this one is a real replica."
      />
      {q.status === 'loading' ? (
        <div role="status" aria-label="Loading devices" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <span className="sr-only">Loading devices</span>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44 rounded-card" />
          ))}
        </div>
      ) : q.status === 'error' ? (
        <ErrorState title="Devices could not be loaded" reassurance="Your local data is not affected." onRetry={q.reload} />
      ) : all.length === 0 ? (
        <EmptyState icon={MonitorSmartphone} title="No devices yet" description="Devices appear here once they join this workspace." />
      ) : (
        <>
          <div role="group" aria-label="Filter devices" className="mb-4 flex flex-wrap gap-2">
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  'type-label h-9 rounded-full border px-3 transition-colors duration-150 max-sm:min-h-10',
                  filter === f.id ? 'border-primary bg-primary-soft text-primary-text' : 'border-line bg-surface text-fg2 hover:bg-subtle',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <EmptyState compact title="No devices match" description="No device has this status right now." />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((d) => (
                <DeviceCard key={d.id} device={d} now={now} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
