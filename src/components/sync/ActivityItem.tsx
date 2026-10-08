import {
  ArrowLeftRight,
  CircleAlert,
  CircleCheck,
  GitMerge,
  Inbox,
  MonitorSmartphone,
  PencilLine,
  RefreshCw,
  TriangleAlert,
  WifiOff,
  Wifi,
  ListPlus,
  Info,
  type LucideIcon,
} from 'lucide-react'
import type { ActivityEvent, ActivityKind } from '@/domain/sync'
import { formatTime, relativeTime } from '@/lib/format'
import { cn } from '@/lib/cn'

const icons: Record<ActivityKind, { icon: LucideIcon; className: string }> = {
  'connection-lost': { icon: WifiOff, className: 'text-offline' },
  'connection-restored': { icon: Wifi, className: 'text-success' },
  'change-created': { icon: PencilLine, className: 'text-info' },
  'change-queued': { icon: ListPlus, className: 'text-info' },
  'sync-started': { icon: RefreshCw, className: 'text-info' },
  'state-received': { icon: Inbox, className: 'text-info' },
  'merge-completed': { icon: GitMerge, className: 'text-info' },
  converged: { icon: CircleCheck, className: 'text-success' },
  'sync-failed': { icon: CircleAlert, className: 'text-error' },
  conflict: { icon: TriangleAlert, className: 'text-warning' },
  'remote-applied': { icon: ArrowLeftRight, className: 'text-info' },
  device: { icon: MonitorSmartphone, className: 'text-muted' },
  info: { icon: Info, className: 'text-muted' },
}


interface ActivityItemProps {
  event: ActivityEvent
  /** 'clock' shows HH:mm:ss for timelines, 'relative' shows "2 minutes ago". */
  time?: 'clock' | 'relative'
  now?: number
  last?: boolean
}

export function ActivityItem({ event, time = 'relative', now, last }: ActivityItemProps) {
  const { icon: Icon, className } = icons[event.kind]
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {!last ? <span aria-hidden className="absolute start-[11px] top-6 bottom-0 w-px bg-line" /> : null}
      <span className="relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface ring-4 ring-surface">
        <Icon aria-hidden className={cn('size-4', className)} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="type-body text-fg">{event.title}</p>
        {event.detail ? <p className="type-body-sm text-muted">{event.detail}</p> : null}
      </div>
      <time dateTime={new Date(event.at).toISOString()} className="type-caption tabular shrink-0 pt-1 text-muted">
        {time === 'clock' ? formatTime(event.at) : relativeTime(event.at, now)}
      </time>
    </li>
  )
}
