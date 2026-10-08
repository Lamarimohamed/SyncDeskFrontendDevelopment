import { CircleAlert, CircleCheck, CircleHelp, CircleMinus, CircleSlash, Clock, PackageX, RefreshCw, TriangleAlert, WifiOff, Wifi } from 'lucide-react'
import type { Availability, DeviceStatus, EntitySyncState, StockLevel } from '@/domain/types'
import { Badge } from './Badge'

/** Business state: whether a product can be sold. Never a network concept. */
export function AvailabilityBadge({ value }: { value: Availability }) {
  return value === 'available' ? (
    <Badge tone="success" icon={CircleCheck}>Available</Badge>
  ) : (
    <Badge tone="neutral" icon={CircleMinus}>Unavailable</Badge>
  )
}

/** Business state: how much stock remains. */
export function StockBadge({ level }: { level: StockLevel }) {
  switch (level) {
    case 'ok':
      return <Badge tone="neutral">In stock</Badge>
    case 'low':
      return <Badge tone="warning" icon={TriangleAlert}>Low stock</Badge>
    case 'out':
      return <Badge tone="error" icon={PackageX}>Out of stock</Badge>
    case 'negative':
      return <Badge tone="error" icon={CircleAlert}>Needs reconciliation</Badge>
  }
}

/** Network state of a single record. */
export function EntitySyncBadge({ state }: { state: EntitySyncState }) {
  switch (state) {
    case 'synced':
      return <Badge tone="success" icon={CircleCheck}>Synchronized</Badge>
    case 'pending':
      return <Badge tone="info" icon={Clock}>Saved locally</Badge>
    case 'failed':
      return <Badge tone="error" icon={CircleAlert}>Sync failed</Badge>
  }
}

export function DeviceStatusBadge({ status }: { status: DeviceStatus }) {
  switch (status) {
    case 'online':
      return <Badge tone="success" icon={Wifi}>Online</Badge>
    case 'syncing':
      return <Badge tone="info" icon={RefreshCw}>Syncing</Badge>
    case 'offline':
      return <Badge tone="offline" icon={WifiOff}>Offline</Badge>
    case 'unknown':
      return <Badge tone="neutral" icon={CircleHelp}>Unknown</Badge>
    case 'evicted':
      return <Badge tone="neutral" icon={CircleSlash}>Evicted</Badge>
  }
}
