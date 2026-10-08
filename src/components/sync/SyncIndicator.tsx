import { Link } from 'react-router'
import { CircleAlert, CircleCheck, CircleHelp, Clock, LoaderCircle, RefreshCw, WifiOff, type LucideIcon } from 'lucide-react'
import type { SyncIndicatorState } from '@/domain/sync'
import { cn } from '@/lib/cn'
import { plural, relativeTime } from '@/lib/format'
import { Tooltip } from '@/components/ui/Tooltip'
import { toneClasses, type Tone } from '@/components/ui/Badge'
import { useNow } from '@/hooks/useNow'
import { useSyncSnapshot, deriveIndicatorState } from '@/hooks/useSync'

interface StateConfig {
  icon: LucideIcon
  tone: Tone
  label: (pending: number) => string
  detail: (pending: number, lastSyncAt: number | null, now: number) => string
  spin?: boolean
}

const last = (at: number | null, now: number) => (at ? `Last synchronized ${relativeTime(at, now)}.` : 'No synchronization yet.')

export const syncStateConfig: Record<SyncIndicatorState, StateConfig> = {
  synchronized: {
    icon: CircleCheck,
    tone: 'success',
    label: () => 'Synchronized',
    detail: (_, at, now) => `All changes are on every connected device. ${last(at, now)}`,
  },
  pending: {
    icon: Clock,
    tone: 'info',
    label: (n) => `${plural(n, 'change')} pending`,
    detail: () => 'Saved on this device. They will be sent shortly.',
  },
  syncing: {
    icon: RefreshCw,
    tone: 'info',
    label: () => 'Synchronizing',
    detail: (n) => `Exchanging changes with other devices${n ? ` (${plural(n, 'change')} to send)` : ''}.`,
    spin: true,
  },
  offline: {
    icon: WifiOff,
    tone: 'offline',
    label: (n) => (n > 0 ? `Offline · ${plural(n, 'change')} pending` : 'Offline'),
    detail: (n) => `You can keep working. ${n > 0 ? `${plural(n, 'change')} will be sent` : 'Changes will be sent'} when the connection returns.`,
  },
  connecting: {
    icon: LoaderCircle,
    tone: 'warning',
    label: () => 'Connecting',
    detail: () => 'Re-establishing the connection to other devices.',
    spin: true,
  },
  error: {
    icon: CircleAlert,
    tone: 'error',
    label: (n) => (n > 0 ? `Sync failed · ${plural(n, 'change')} pending` : 'Sync failed'),
    detail: () => 'Synchronization could not be completed. Your local changes remain pending.',
  },
  unknown: {
    icon: CircleHelp,
    tone: 'neutral',
    label: () => 'Status unknown',
    detail: () => 'This device has not synchronized yet.',
  },
}

interface SyncIndicatorViewProps {
  state: SyncIndicatorState
  pending?: number
  lastSyncAt?: number | null
  /** Hide the text label on narrow layouts; the accessible text stays. */
  compactOnMobile?: boolean
  asLink?: boolean
  className?: string
}

export function SyncIndicatorView({ state, pending = 0, lastSyncAt = null, compactOnMobile, asLink, className }: SyncIndicatorViewProps) {
  const now = useNow()
  const cfg = syncStateConfig[state]
  const Icon = cfg.icon
  const label = cfg.label(pending)
  const detail = cfg.detail(pending, lastSyncAt, now)
  const classes = cn(
    'type-label inline-flex h-8 items-center gap-1.5 rounded-full px-3 whitespace-nowrap max-sm:min-h-10',
    toneClasses[cfg.tone],
    asLink && 'transition-[filter] duration-150 hover:brightness-95',
    className,
  )
  const body = (
    <>
      <Icon aria-hidden className={cn('size-4', cfg.spin && 'animate-spin')} />
      <span className={cn(compactOnMobile && 'max-sm:sr-only')}>{label}</span>
    </>
  )
  return (
    <Tooltip content={detail}>
      <span role="status" className="inline-flex">
        {asLink ? (
          <Link to="/sync" className={classes} aria-label={`${label}. ${detail} Open synchronization.`}>
            {body}
          </Link>
        ) : (
          <span className={classes}>
            {body}
            <span className="sr-only">. {detail}</span>
          </span>
        )}
      </span>
    </Tooltip>
  )
}

export function SyncIndicator(props: Pick<SyncIndicatorViewProps, 'compactOnMobile' | 'asLink' | 'className'>) {
  const snap = useSyncSnapshot()
  return <SyncIndicatorView state={deriveIndicatorState(snap)} pending={snap.pending.length} lastSyncAt={snap.lastSyncAt} {...props} />
}
