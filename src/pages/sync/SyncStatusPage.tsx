import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { RefreshCw, WifiOff, Wifi } from 'lucide-react'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/ErrorState'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { DeviceStatusBadge } from '@/components/ui/StatusBadge'
import { SyncIndicatorView, syncStateConfig } from '@/components/sync/SyncIndicator'
import { deriveIndicatorState, useSyncSnapshot } from '@/hooks/useSync'
import { useRepositoryQuery } from '@/hooks/useRepositoryQuery'
import { usePreferences } from '@/hooks/usePreferences'
import { useNow } from '@/hooks/useNow'
import { formatBytes, formatDateTime, plural, relativeTime } from '@/lib/format'
import { repository, syncService } from '@/services/container'
import { ProvenanceTag, SyncPageFrame } from './SyncTabs'
import type { MetricProvenance } from '@/domain/sync'

function Metric({ label, value, provenance, note }: { label: string; value: ReactNode; provenance: MetricProvenance; note?: string }) {
  return (
    <div className="space-y-1">
      <dt className="type-body-sm text-fg2">{label}</dt>
      <dd className="type-metric tabular text-fg">{value}</dd>
      <dd className="flex flex-wrap items-center gap-2">
        <ProvenanceTag kind={provenance} />
        {note ? <span className="type-caption text-muted">{note}</span> : null}
      </dd>
    </div>
  )
}

function Mono({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line py-2 last:border-b-0">
      <dt className="type-body-sm text-muted">{label}</dt>
      <dd className="font-mono text-xs break-all text-fg">{children}</dd>
    </div>
  )
}

export function SyncStatusPage() {
  const snap = useSyncSnapshot()
  const [prefs] = usePreferences()
  const now = useNow(15_000)
  const devices = useRepositoryQuery(() => repository.getDevices())
  const stats = useRepositoryQuery(() => repository.getReplicaStats())

  const state = deriveIndicatorState(snap)
  const pendingCount = snap.pending.length
  const offline = snap.connectivity === 'offline'
  const connecting = snap.connectivity === 'connecting'
  const busy = snap.phase === 'syncing' || connecting
  const peers = devices.data?.filter((d) => !d.isThisDevice) ?? []
  const technical = prefs.technicalMode

  return (
    <SyncPageFrame
      title="Synchronization"
      description="Whether the data on this device matches the other devices, and what is still waiting to be sent."
    >
      {snap.phase === 'error' ? (
        <Banner
          tone="error"
          title="Synchronization failed"
          className="mb-4"
          action={
            <Button size="sm" onClick={syncService.syncNow} disabled={offline || busy}>
              Retry
            </Button>
          }
        >
          {snap.lastError ?? 'The last attempt did not complete.'} Your local changes are still saved on this device.
        </Banner>
      ) : null}

      <div className="space-y-6">
        <Card>
          <CardBody className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-3">
              <SyncIndicatorView state={state} pending={pendingCount} lastSyncAt={snap.lastSyncAt} />
              <p className="type-body max-w-xl text-fg2">{syncStateConfig[state].detail(pendingCount, snap.lastSyncAt, now)}</p>
              <p className="type-body-sm max-w-xl text-muted">
                Saved locally means the change is on this device. Synchronized means other devices have received it. Network state ({snap.connectivity}) is separate from both.
              </p>
              <dl className="type-body-sm grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-3">
                <div>
                  <dt className="text-muted">Last sync</dt>
                  <dd className="text-fg">{snap.lastSyncAt ? relativeTime(snap.lastSyncAt, now) : 'Never'}</dd>
                </div>
                <div>
                  <dt className="text-muted">Pending</dt>
                  <dd className="text-fg">
                    <Link to="/sync/pending" className="underline-offset-2 hover:underline">
                      {plural(pendingCount, 'change')}
                    </Link>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">This replica</dt>
                  <dd className="font-mono text-xs text-fg">{snap.replicaId}</dd>
                </div>
              </dl>
            </div>
            <div className="flex flex-wrap gap-2 lg:flex-col lg:items-stretch">
              <Button
                variant="primary"
                icon={<RefreshCw aria-hidden className="size-4" />}
                onClick={syncService.syncNow}
                disabled={offline || busy}
                loading={snap.phase === 'syncing'}
              >
                Sync now
              </Button>
              {offline ? (
                <Button icon={<Wifi aria-hidden className="size-4" />} onClick={syncService.goOnline}>
                  Go online
                </Button>
              ) : (
                <Button icon={<WifiOff aria-hidden className="size-4" />} onClick={syncService.goOffline} disabled={connecting}>
                  Go offline
                </Button>
              )}
            </div>
          </CardBody>
          {offline ? (
            <p className="type-body-sm border-t border-line px-4 py-3 text-fg2 sm:px-5">
              Offline: Sync now is unavailable. You can keep working and changes stay on this device.
            </p>
          ) : null}
        </Card>

        <Card>
          <CardHeader title="Other devices" description="Peers in this workspace. Their status is simulated in this demo." />
          {devices.status === 'loading' ? (
            <ListSkeleton rows={3} label="Loading devices" />
          ) : devices.status === 'error' ? (
            <ErrorState
              title="Devices could not be loaded"
              reassurance="Your local data is not affected."
              onRetry={devices.reload}
            />
          ) : peers.length === 0 ? (
            <EmptyState compact title="No other devices" description="Devices that join this workspace will be listed here." />
          ) : (
            <ul className="divide-y divide-line">
              {peers.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <Link to={`/devices/${d.id}`} className="type-label text-fg hover:underline">
                      {d.name}
                    </Link>
                    <p className="type-body-sm text-muted">
                      {d.lastSyncAt ? `Last sync ${relativeTime(d.lastSyncAt, now)}` : 'Never synchronized'} · {plural(d.pendingChanges, 'pending change')}
                    </p>
                  </div>
                  <DeviceStatusBadge status={d.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Metrics" description="Each figure says where it comes from." />
          <CardBody>
            <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              <Metric
                label="Local state size"
                provenance={stats.status === 'success' ? 'real' : 'unavailable'}
                value={stats.data ? formatBytes(stats.data.stateSizeBytes) : stats.status === 'loading' ? '…' : 'Not available'}
                note="Serialized in this browser"
              />
              <Metric label="Bytes sent" provenance="simulated" value={formatBytes(snap.counters.bytesSent)} note="Simulated transport" />
              <Metric label="Bytes received" provenance="simulated" value={formatBytes(snap.counters.bytesReceived)} note="Simulated transport" />
              <Metric label="Merges" provenance="simulated" value={snap.counters.mergeCount} />
              <Metric label="Conflicts resolved" provenance="simulated" value={snap.counters.conflictCount} />
              <Metric label="Convergence time" provenance="unavailable" value="Awaiting experiment data" />
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Conflicts"
            description="Last-writer-wins applies to price: the later change wins and the other value is overwritten, not kept."
          />
          {snap.conflicts.length === 0 ? (
            <EmptyState compact title="No conflicts" description="A conflict is recorded when two devices change the same price before they synchronize." />
          ) : (
            <ul className="divide-y divide-line">
              {[...snap.conflicts].sort((a, b) => b.at - a.at).map((c) => (
                <li key={c.id} className="space-y-3 px-4 py-4 sm:px-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="type-label text-fg">
                      {c.entityLabel} <span className="text-muted">· {c.field}</span>
                    </p>
                    <time dateTime={new Date(c.at).toISOString()} className="type-caption tabular text-muted">
                      {formatDateTime(c.at)}
                    </time>
                  </div>
                  <dl className="type-body-sm grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <dt className="text-muted">Local (this device)</dt>
                      <dd className="tabular text-fg">{c.local}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Remote ({c.remoteDevice})</dt>
                      <dd className="tabular text-fg">{c.remote}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Result</dt>
                      <dd className="tabular font-medium text-fg">
                        {c.result} <Badge tone="info">{c.winner === 'local' ? 'Local won' : 'Remote won'}</Badge>
                      </dd>
                    </div>
                  </dl>
                  <p className="type-body-sm text-muted">Rule: {c.rule}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="How synchronization works here" />
          <CardBody className="type-body space-y-3 text-fg2">
            <p>Each device keeps its own local replica, so you can keep working without a connection.</p>
            <ul className="list-disc space-y-1 ps-5">
              <li>Edits are written locally first and added to an operation queue.</li>
              <li>Price is a last-writer-wins register: if two devices change it, the later change wins and the other value is overwritten.</li>
              <li>Stock is an additive counter: adjustments from every device are summed.</li>
              <li>Deletes leave a tombstone so they are not undone by a device that has not seen them yet.</li>
            </ul>
            <p className="text-muted">The transport between devices is simulated in this demo. Peer devices are not real machines.</p>
          </CardBody>
        </Card>

        <details open={prefs.diagnosticsOpenByDefault || undefined} className="rounded-card border border-line bg-surface">
          <summary className="type-h3 cursor-pointer rounded-card px-4 py-3 text-fg sm:px-5">Advanced diagnostics</summary>
          <div className="border-t border-line px-4 py-3 sm:px-5">
            <dl>
              <Mono label="Replica id">{snap.replicaId}</Mono>
              <Mono label="State size (Real)">
                {stats.data ? `${stats.data.stateSizeBytes} B` : stats.status === 'loading' ? 'Loading' : 'Not available'}
              </Mono>
              <Mono label="Metadata size (Simulation metric)">
                {stats.data ? `${stats.data.metadataBytes} B` : stats.status === 'loading' ? 'Loading' : 'Not available'}
              </Mono>
              <Mono label="Tombstones">{stats.data ? stats.data.tombstones : 'Not available'}</Mono>
              <Mono label="Bytes sent / received (Simulation metric)">
                {snap.counters.bytesSent} B / {snap.counters.bytesReceived} B
              </Mono>
              <Mono label="Merges / conflicts (Simulation metric)">
                {snap.counters.mergeCount} / {snap.counters.conflictCount}
              </Mono>
              <Mono label="Last merge">{snap.counters.lastMergeAt ? formatDateTime(snap.counters.lastMergeAt) : 'None yet'}</Mono>
              <Mono label="Remote changes waiting">{snap.remoteWaiting}</Mono>
              <Mono label="Last error">{snap.lastError ?? 'None'}</Mono>
            </dl>
            {technical ? (
              <div className="mt-4">
                <h3 className="type-label mb-2 text-fg">Queued operations</h3>
                {snap.pending.length === 0 ? (
                  <p className="type-body-sm text-muted">Queue is empty.</p>
                ) : (
                  <ul className="space-y-1 font-mono text-xs text-fg2">
                    {snap.pending.map((p) => (
                      <li key={p.id} className="break-all">
                        {p.kind} · {p.crdt} · {p.status} · {p.sizeBytes} B (Simulation) · attempts {p.attempts}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="type-caption mt-3 text-muted">Turn on technical mode in Settings to see the CRDT type of each queued operation.</p>
            )}
          </div>
        </details>
      </div>
    </SyncPageFrame>
  )
}
