import { useParams } from 'react-router'
import { MonitorX } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Banner } from '@/components/ui/Banner'
import { ButtonLink } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { DeviceStatusBadge } from '@/components/ui/StatusBadge'
import { ActivityItem } from '@/components/sync/ActivityItem'
import { useRepositoryQuery } from '@/hooks/useRepositoryQuery'
import { useSyncSnapshot } from '@/hooks/useSync'
import { useNow } from '@/hooks/useNow'
import { repository } from '@/services/container'
import { NotFoundError } from '@/repositories/MockRepository'
import { formatBytes, formatDateTime, plural, relativeTime } from '@/lib/format'
import { ProvenanceTag } from '@/pages/sync/SyncTabs'

export function DeviceDetailPage() {
  const { deviceId = '' } = useParams()
  const q = useRepositoryQuery(() => repository.getDevice(deviceId), [deviceId])
  const snap = useSyncSnapshot()
  const now = useNow(30_000)
  const crumbs = [{ label: 'Devices', to: '/devices' }, { label: q.data?.name ?? 'Device' }]

  if (q.status === 'loading') {
    return (
      <div>
        <PageHeader title="Device" breadcrumbs={crumbs} />
        <div role="status" aria-label="Loading device" className="space-y-4">
          <span className="sr-only">Loading device</span>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-48 rounded-card" />
        </div>
      </div>
    )
  }

  if (q.status === 'error') {
    const notFound = q.error instanceof NotFoundError
    return (
      <div>
        <PageHeader title={notFound ? 'Device not found' : 'Device'} breadcrumbs={crumbs} />
        <Card>
          {notFound ? (
            <EmptyState
              icon={MonitorX}
              title="Device not found"
              description="This device does not exist in the workspace, or it was removed."
              actions={<ButtonLink to="/devices">Back to devices</ButtonLink>}
            />
          ) : (
            <ErrorState title="This device could not be loaded" reassurance="Your local data is not affected." onRetry={q.reload} />
          )}
        </Card>
      </div>
    )
  }

  const d = q.data!
  const sizeKind = d.isThisDevice ? 'real' : 'simulated'
  const events = snap.activity.filter((e) => e.deviceId === d.id).sort((a, b) => b.at - a.at).slice(0, 15)

  const rows: [string, React.ReactNode][] = [
    ['Role', d.role],
    ['Platform', d.platform],
    ['Replica id', <span key="r" className="font-mono text-xs">{d.replicaId}</span>],
    ['Last seen', d.lastSeenAt ? `${relativeTime(d.lastSeenAt, now)} (${formatDateTime(d.lastSeenAt)})` : 'Never'],
    ['Last sync', d.lastSyncAt ? `${relativeTime(d.lastSyncAt, now)} (${formatDateTime(d.lastSyncAt)})` : 'Never'],
    ['Pending changes', plural(d.pendingChanges, 'change')],
  ]

  return (
    <div>
      <PageHeader
        title={d.name}
        breadcrumbs={crumbs}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <DeviceStatusBadge status={d.status} />
            {d.isThisDevice ? <Badge tone="primary">This device</Badge> : null}
          </div>
        }
      />
      <div className="space-y-6">
        {d.status === 'evicted' ? (
          <Banner tone="warning" title="This device was evicted">
            An evicted device has been removed from the workspace and no longer exchanges changes. Anything it still held locally will not be merged.
          </Banner>
        ) : null}
        {!d.isThisDevice ? (
          <Banner tone="info">This is a simulated peer. Its status and figures are seeded demo values, not measurements.</Banner>
        ) : null}

        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <dl className="type-body grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
              {rows.map(([k, v]) => (
                <div key={k}>
                  <dt className="type-body-sm text-muted">{k}</dt>
                  <dd className="text-fg">{v}</dd>
                </div>
              ))}
              <div>
                <dt className="type-body-sm text-muted">State size</dt>
                <dd className="tabular text-fg">
                  {formatBytes(d.stateSizeBytes)} <ProvenanceTag kind={sizeKind} />
                </dd>
              </div>
              <div>
                <dt className="type-body-sm text-muted">Metadata size</dt>
                <dd className="tabular text-fg">
                  {formatBytes(d.metadataBytes)} <ProvenanceTag kind="simulated" />
                </dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Recent activity" description="Events recorded for this device." />
          {events.length === 0 ? (
            <EmptyState
              compact
              title="No recorded activity"
              description={d.isThisDevice ? 'Activity on this device will appear here.' : 'Simulated peers do not record activity in this demo.'}
            />
          ) : (
            <ol className="p-4 sm:p-5" aria-label="Recent activity">
              {events.map((e, i) => (
                <ActivityItem key={e.id} event={e} time="clock" last={i === events.length - 1} />
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  )
}
