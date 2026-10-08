import { useState } from 'react'
import { CheckCircle2, Eye, RotateCcw, Trash2, WifiOff } from 'lucide-react'
import type { ChangeStatus, PendingChange } from '@/domain/sync'
import { Badge } from '@/components/ui/Badge'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Drawer } from '@/components/ui/Overlay'
import { EmptyState } from '@/components/ui/EmptyState'
import { Tooltip } from '@/components/ui/Tooltip'
import { SyncIndicatorView } from '@/components/sync/SyncIndicator'
import { deriveIndicatorState, useSyncSnapshot } from '@/hooks/useSync'
import { usePreferences } from '@/hooks/usePreferences'
import { useNow } from '@/hooks/useNow'
import { formatBytes, formatDateTime, formatTime, plural, relativeTime } from '@/lib/format'
import { syncService } from '@/services/container'
import { SyncPageFrame } from './SyncTabs'

const statusBadge: Record<ChangeStatus, { tone: 'info' | 'primary' | 'error'; label: string }> = {
  pending: { tone: 'info', label: 'Queued' },
  syncing: { tone: 'primary', label: 'Syncing' },
  failed: { tone: 'error', label: 'Failed' },
}

function Change({ c }: { c: PendingChange }) {
  return c.from !== undefined || c.to !== undefined ? (
    <span className="tabular">
      {c.from ?? '—'} <span aria-label="to">→</span> {c.to ?? '—'}
    </span>
  ) : (
    <span className="text-muted">—</span>
  )
}

export function SyncPendingPage() {
  const snap = useSyncSnapshot()
  const [prefs] = usePreferences()
  const now = useNow(15_000)
  const online = snap.connectivity === 'online'
  const [inspectId, setInspectId] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<PendingChange | null>(null)
  const [clearOpen, setClearOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inspected = snap.pending.find((p) => p.id === inspectId) ?? null

  async function confirmRemove() {
    if (!removeTarget) return
    setBusy(true)
    setError(null)
    try {
      await syncService.discardChange(removeTarget.id)
      setRemoveTarget(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The change could not be removed.')
    } finally {
      setBusy(false)
    }
  }

  function removeControl(c: PendingChange) {
    if (c.discardable) {
      return (
        <Button size="sm" variant="ghost" icon={<Trash2 aria-hidden className="size-4" />} disabled={c.status === 'syncing'} onClick={() => setRemoveTarget(c)}>
          Remove
        </Button>
      )
    }
    return (
      <Tooltip content="This change cannot be removed on its own because other data depends on it. It will be sent on the next sync.">
        <span tabIndex={0} className="type-caption text-muted">
          Can't be removed
        </span>
      </Tooltip>
    )
  }

  function retryControl(c: PendingChange) {
    if (c.status !== 'failed') return null
    return (
      <Tooltip content="Reconnect to retry." disabled={online}>
        <Button size="sm" icon={<RotateCcw aria-hidden className="size-4" />} disabled={!online} onClick={() => syncService.retryChange(c.id)}>
          Retry
        </Button>
      </Tooltip>
    )
  }

  return (
    <SyncPageFrame
      title="Pending changes"
      description="Edits saved on this device that other devices have not received yet."
      actions={
        snap.pending.length > 0 ? (
          <Button variant="secondary" icon={<Trash2 aria-hidden className="size-4" />} onClick={() => setClearOpen(true)}>
            Clear all pending
          </Button>
        ) : undefined
      }
    >
      {!online ? (
        <Banner
          tone="offline"
          title={snap.connectivity === 'connecting' ? 'Reconnecting' : 'You are offline'}
          className="mb-4"
        >
          {snap.pending.length > 0
            ? 'Your pending changes are safe on this device. They will be sent when the connection returns.'
            : 'New changes will be saved on this device and sent when the connection returns.'}
        </Banner>
      ) : null}

      {snap.pending.length === 0 ? (
        <Card>
          <EmptyState
            icon={CheckCircle2}
            title="Nothing waiting to sync"
            description="Every change made on this device has been sent."
            next={snap.lastSyncAt ? `Last synchronized ${relativeTime(snap.lastSyncAt, now)}.` : undefined}
            actions={<SyncIndicatorView state={deriveIndicatorState(snap)} pending={0} lastSyncAt={snap.lastSyncAt} />}
          />
        </Card>
      ) : (
        <Card>
          <div className="type-body-sm border-b border-line px-4 py-3 text-fg2 sm:px-5">
            {plural(snap.pending.length, 'change')} waiting. Business data is saved locally; it counts as synchronized only after another device has received it.
          </div>
          <ul className="divide-y divide-line" aria-label="Pending changes">
            {snap.pending.map((c) => {
              const sb = statusBadge[c.status]
              return (
                <li key={c.id} className="flex flex-col gap-3 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="type-label text-fg">{c.entityLabel}</p>
                      <Badge tone={sb.tone}>{sb.label}</Badge>
                      {c.attempts > 0 ? <Badge>{plural(c.attempts, 'attempt')}</Badge> : null}
                      {prefs.technicalMode ? <Badge tone="neutral">{c.crdt}</Badge> : null}
                    </div>
                    <p className="type-body text-fg2">{c.summary}</p>
                    <p className="type-body-sm text-muted">
                      {c.field ? <>Field: {c.field}. </> : null}
                      <Change c={c} />
                      <span className="tabular"> · created {formatTime(c.createdAt)}</span>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="ghost" icon={<Eye aria-hidden className="size-4" />} onClick={() => setInspectId(c.id)}>
                      Inspect
                    </Button>
                    {retryControl(c)}
                    {removeControl(c)}
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {!online && snap.pending.some((p) => p.status === 'failed') ? (
        <p className="type-body-sm mt-3 flex items-center gap-2 text-muted">
          <WifiOff aria-hidden className="size-4" /> Retry becomes available when this device is online.
        </p>
      ) : null}

      <Drawer
        open={inspected !== null}
        onClose={() => setInspectId(null)}
        title="Change details"
        description={inspected?.entityLabel}
        footer={<Button onClick={() => setInspectId(null)}>Close</Button>}
      >
        {inspected ? (
          <dl className="type-body space-y-3">
            {(
              [
                ['Summary', inspected.summary],
                ['Entity', `${inspected.entityType} · ${inspected.entityLabel}`],
                ['Field', inspected.field ?? 'Not applicable'],
                ['Operation', inspected.kind],
                ['CRDT operation type', inspected.crdt],
                ['Status', statusBadge[inspected.status].label],
                ['Attempts', String(inspected.attempts)],
                ['Created', formatDateTime(inspected.createdAt)],
                ['Operation size', `${formatBytes(inspected.sizeBytes)} (Simulation metric)`],
                ['Can be removed', inspected.discardable ? 'Yes, the local edit would be reverted' : 'No'],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <dt className="type-caption text-muted">{k}</dt>
                <dd className="text-fg">{v}</dd>
              </div>
            ))}
            <div>
              <dt className="type-caption text-muted">Change</dt>
              <dd className="text-fg"><Change c={inspected} /></dd>
            </div>
            <div>
              <dt className="type-caption text-muted">Change id</dt>
              <dd className="font-mono text-xs break-all text-fg">{inspected.id}</dd>
            </div>
          </dl>
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={removeTarget !== null}
        title="Remove this pending change?"
        confirmLabel="Remove and revert"
        loading={busy}
        error={error}
        onConfirm={confirmRemove}
        onCancel={() => {
          setRemoveTarget(null)
          setError(null)
        }}
      >
        <p>
          The edit "{removeTarget?.summary}" will be reverted on this device and will never be sent to other devices.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={clearOpen}
        title="Clear all pending changes?"
        confirmLabel="Clear queue"
        onConfirm={() => {
          syncService.clearPending()
          setClearOpen(false)
        }}
        onCancel={() => setClearOpen(false)}
      >
        <p>
          This empties the queue of {plural(snap.pending.length, 'change')}. They will not be sent to other devices.
          The edits themselves are not reverted on this device, so this device may differ from the others until the data is edited again.
        </p>
        <p className="text-muted">Intended for development and recovery, not routine use.</p>
      </ConfirmDialog>
    </SyncPageFrame>
  )
}
