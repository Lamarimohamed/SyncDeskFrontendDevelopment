import { Link } from 'react-router'
import { Monitor, Smartphone, Tablet, ScanLine, Laptop } from 'lucide-react'
import type { Device } from '@/domain/types'
import { DeviceStatusBadge } from '@/components/ui/StatusBadge'
import { Badge } from '@/components/ui/Badge'
import { plural, relativeTime } from '@/lib/format'

const roleIcon = {
  'Primary POS': Tablet,
  'Kitchen display': Monitor,
  'Manager mobile': Smartphone,
  'Back office': Laptop,
  'Stock scanner': ScanLine,
} as const

export function DeviceCard({ device, now }: { device: Device; now: number }) {
  const Icon = roleIcon[device.role]
  return (
    <li>
      <Link
        to={`/devices/${device.id}`}
        className="flex h-full flex-col gap-3 rounded-card border border-line bg-surface p-4 transition-colors duration-150 hover:border-line-strong hover:bg-subtle/60"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-subtle text-fg2">
              <Icon aria-hidden className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="type-h3 truncate text-fg">{device.name}</p>
              <p className="type-body-sm text-muted">{device.role}</p>
            </div>
          </div>
          <DeviceStatusBadge status={device.status} />
        </div>
        <dl className="type-body-sm grid grid-cols-2 gap-x-4 gap-y-2">
          <div>
            <dt className="text-muted">Replica</dt>
            <dd className="font-mono text-xs text-fg">{device.replicaId}</dd>
          </div>
          <div>
            <dt className="text-muted">Pending</dt>
            <dd className="text-fg">{plural(device.pendingChanges, 'change')}</dd>
          </div>
          <div>
            <dt className="text-muted">Last seen</dt>
            <dd className="text-fg">{device.lastSeenAt ? relativeTime(device.lastSeenAt, now) : 'Never'}</dd>
          </div>
          <div>
            <dt className="text-muted">Last sync</dt>
            <dd className="text-fg">{device.lastSyncAt ? relativeTime(device.lastSyncAt, now) : 'Never'}</dd>
          </div>
        </dl>
        {device.isThisDevice ? <Badge tone="primary" className="self-start">This device</Badge> : null}
      </Link>
    </li>
  )
}
