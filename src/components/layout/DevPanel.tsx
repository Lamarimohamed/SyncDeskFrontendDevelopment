import { useState } from 'react'
import { ChevronUp, FlaskConical } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useSyncSnapshot } from '@/hooks/useSync'
import { usePreferences } from '@/hooks/usePreferences'
import { syncService } from '@/services/container'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/cn'

export function DevPanel() {
  const [prefs] = usePreferences()
  const [open, setOpen] = useState(false)
  const snap = useSyncSnapshot()
  const toast = useToast()
  if (!prefs.showDevControls) return null
  const offline = snap.connectivity === 'offline'
  const busy = snap.connectivity === 'connecting' || snap.phase === 'syncing'

  const run = (fn: () => Promise<unknown> | unknown, message: string) => async () => {
    await fn()
    toast.show({ title: message, tone: 'neutral' })
  }

  return (
    <section
      aria-label="Demo controls"
      className="fixed end-4 bottom-20 z-20 w-72 max-w-[calc(100vw-2rem)] rounded-card border border-line-strong bg-surface shadow-pop md:bottom-4"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls="dev-panel-body"
        onClick={() => setOpen((v) => !v)}
        className="type-label flex w-full items-center gap-2 rounded-card px-3 py-2.5 text-fg"
      >
        <FlaskConical aria-hidden className="size-4 text-muted" />
        <span className="flex-1 text-start">Demo controls</span>
        <span className="type-caption rounded-control bg-subtle px-1.5 text-muted">Simulation</span>
        <ChevronUp aria-hidden className={cn('size-4 text-muted transition-transform', open ? '' : 'rotate-180')} />
      </button>
      {open ? (
        <div id="dev-panel-body" className="grid grid-cols-2 gap-2 border-t border-line p-3">
          <Button size="sm" onClick={offline ? () => syncService.goOnline() : () => syncService.goOffline()}>
            {offline ? 'Go Online' : 'Go Offline'}
          </Button>
          <Button size="sm" disabled={offline || busy} onClick={() => syncService.syncNow()}>
            Sync Now
          </Button>
          <Button size="sm" onClick={run(() => syncService.createPendingChange(), 'Pending change created')}>
            Create Pending Change
          </Button>
          <Button size="sm" onClick={run(() => syncService.simulateConflict(), 'Remote edit queued for next sync')}>
            Simulate Conflict
          </Button>
          <Button size="sm" onClick={run(() => syncService.simulateSyncError(), 'Next sync will fail')}>
            Simulate Sync Error
          </Button>
          <Button size="sm" disabled={snap.pending.length === 0} onClick={run(() => syncService.clearPending(), 'Pending queue cleared')}>
            Clear Pending
          </Button>
          <Button size="sm" className="col-span-2" disabled={busy} onClick={() => syncService.reconnect()}>
            Simulate Reconnection
          </Button>
          <p className="type-caption col-span-2 text-muted">Local controls for the demo. Nothing here touches a real network.</p>
        </div>
      ) : null}
    </section>
  )
}
