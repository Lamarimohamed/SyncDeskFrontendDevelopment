import { Link } from 'react-router'
import { Boxes, Plus, RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, MetricCard } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { ListSkeleton, MetricSkeleton } from '@/components/ui/Skeleton'
import { StockBadge } from '@/components/ui/StatusBadge'
import { ActivityItem } from '@/components/sync/ActivityItem'
import { SyncIndicatorView } from '@/components/sync/SyncIndicator'
import { useAuth } from '@/hooks/useAuth'
import { useNow } from '@/hooks/useNow'
import { useRepositoryQuery } from '@/hooks/useRepositoryQuery'
import { deriveIndicatorState, useSyncSnapshot } from '@/hooks/useSync'
import { repository, syncService } from '@/services/container'
import { relativeTime, plural } from '@/lib/format'
import { Spinner } from '@/components/ui/Spinner'

export function DashboardPage() {
  const { user } = useAuth()
  const snap = useSyncSnapshot()
  const now = useNow()
  const products = useRepositoryQuery(() => repository.getProducts())
  const state = deriveIndicatorState(snap)
  const n = snap.pending.length
  const offline = snap.connectivity === 'offline'
  const busy = snap.connectivity === 'connecting' || snap.phase === 'syncing'
  const first = user?.name.split(' ')[0]

  const list = products.data ?? []
  const low = list.filter((p) => p.stockLevel !== 'ok' && p.availability !== 'unavailable')
  const attention = [...low].sort((a, b) => a.stock - b.stock).slice(0, 5)

  return (
    <>
      <PageHeader
        title={first ? `Hello, ${first}` : 'Dashboard'}
        documentTitle="Dashboard"
        description="What is on this device right now, and whether it has reached the other replicas."
        actions={
          <>
            <ButtonLink to="/stock/adjust">
              <Boxes aria-hidden className="size-4" />
              Adjust stock
            </ButtonLink>
            <ButtonLink to="/products/new" variant="primary">
              <Plus aria-hidden className="size-4" />
              New product
            </ButtonLink>
          </>
        }
      />

      <section aria-labelledby="conn-title" className="mb-6 flex flex-col gap-4 rounded-card border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="min-w-0">
          <h2 id="conn-title" className="type-label text-fg2">
            Synchronization
          </h2>
          <div className="mt-2">
            <SyncIndicatorView state={state} pending={n} lastSyncAt={snap.lastSyncAt} />
          </div>
          <p className="type-body-sm mt-2 max-w-xl text-fg2">
            {offline
              ? 'This device is offline. Changes are saved locally and will be sent when the connection returns.'
              : snap.phase === 'error'
                ? `The last attempt failed${snap.lastError ? `: ${snap.lastError}` : ''}. Your changes are still saved locally.`
                : n > 0
                  ? `${n} ${plural(n, 'change')} saved locally and waiting to be synchronized.`
                  : snap.lastSyncAt
                    ? `All local changes have been synchronized. Last sync ${relativeTime(snap.lastSyncAt, now)}.`
                    : 'No synchronization has happened yet on this device.'}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {offline ? (
            <Button onClick={() => syncService.goOnline()}>Go online</Button>
          ) : (
            <Button onClick={() => syncService.syncNow()} disabled={busy} loading={busy}>
              {busy ? null : <RefreshCw aria-hidden className="size-4" />}
              Sync now
            </Button>
          )}
          <ButtonLink to="/sync" variant="ghost">
            Details
          </ButtonLink>
        </div>
      </section>

      <section aria-label="Key figures" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {products.status === 'loading' ? (
          <>
            <MetricSkeleton />
            <MetricSkeleton />
            <MetricSkeleton />
            <MetricSkeleton />
          </>
        ) : (
          <>
            <MetricCard label="Products" value={list.length} hint={`${list.filter((p) => p.availability === 'available').length} available`} to="/products" actionLabel="View products" />
            <MetricCard
              label="Needs restocking"
              value={low.length}
              hint={low.length ? 'Low, out of stock or negative' : 'Nothing below threshold'}
              to="/stock"
              actionLabel="Open stock"
              tone={low.length ? 'warning' : 'default'}
            />
            <MetricCard label="Pending changes" value={n} hint={n ? 'Saved locally' : 'Nothing waiting'} to="/sync/pending" actionLabel="Review pending" tone={n ? 'info' : 'default'} />
            <MetricCard label="Last sync" value={snap.lastSyncAt ? relativeTime(snap.lastSyncAt, now) : 'Never'} hint="This replica" to="/sync/activity" actionLabel="Open activity" />
          </>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Recent activity" description="Local changes, connection events and merges" action={<Link to="/sync/activity" className="type-body-sm text-primary-text hover:underline">View all</Link>} />
          <CardBody>
            {snap.activity.length === 0 ? (
              <EmptyState compact title="No activity yet" description="Edit a product or adjust stock and it will show up here." />
            ) : (
              <ol className="space-y-0">
                {snap.activity.slice(0, 7).map((e) => (
                  <ActivityItem key={e.id} event={e} time="relative" />
                ))}
              </ol>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Low stock" description="Lowest first" />
          <CardBody className="p-0 sm:p-0">
            {products.status === 'loading' ? (
              <div className="p-4"><ListSkeleton rows={4} label="Loading stock" /></div>
            ) : products.status === 'error' ? (
              <ErrorState title="Could not read products" description="The local replica did not respond." onRetry={products.reload} />
            ) : attention.length === 0 ? (
              <EmptyState compact title="Stock looks fine" description="No product is at or below its threshold." />
            ) : (
              <ul className="divide-y divide-line">
                {attention.map((p) => (
                  <li key={p.id}>
                    <Link to={`/products/${p.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-subtle sm:px-5">
                      <span className="min-w-0 flex-1">
                        <span className="type-label block truncate text-fg">{p.name}</span>
                        <span className="type-caption text-muted">
                          <span className="tabular">{p.stock}</span> left · threshold <span className="tabular">{p.lowStockThreshold}</span>
                        </span>
                      </span>
                      <StockBadge level={p.stockLevel} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {products.status === 'loading' ? <Spinner className="sr-only" /> : null}
          </CardBody>
        </Card>
      </div>
    </>
  )
}
