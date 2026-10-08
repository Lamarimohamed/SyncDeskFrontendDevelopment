import { CircleCheck, Clock, CircleAlert } from 'lucide-react'
import { usePendingFor, useSyncSnapshot } from '@/hooks/useSync'
import { cn } from '@/lib/cn'

/**
 * Distinguishes "saved on this device" from "confirmed by the network".
 * Shown after a record has been written locally.
 */
export function SaveStatus({ entityId, className }: { entityId: string | undefined; className?: string }) {
  const ops = usePendingFor(entityId)
  const { connectivity } = useSyncSnapshot()
  if (ops.length === 0) {
    return (
      <p role="status" className={cn('type-body-sm flex items-center gap-1.5 text-success-fg', className)}>
        <CircleCheck aria-hidden className="size-4" />
        Synchronized
      </p>
    )
  }
  if (ops.some((o) => o.status === 'failed')) {
    return (
      <p role="status" className={cn('type-body-sm flex items-center gap-1.5 text-error-fg', className)}>
        <CircleAlert aria-hidden className="size-4" />
        Saved locally · synchronization failed
      </p>
    )
  }
  return (
    <p role="status" className={cn('type-body-sm flex items-center gap-1.5 text-info-fg', className)}>
      <Clock aria-hidden className="size-4" />
      Saved locally · {connectivity === 'offline' ? 'waiting for connection' : 'pending synchronization'}
    </p>
  )
}
