import { Activity, Boxes, FolderTree, LayoutDashboard, ListChecks, Monitor, Package, RefreshCw, Settings, type LucideIcon } from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  badge?: 'pending'
}

export interface NavGroup {
  id: string
  label: string
  items: NavItem[]
}

export const navGroups: NavGroup[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [{ to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    id: 'catalog',
    label: 'Catalog',
    items: [
      { to: '/products', label: 'Products', icon: Package },
      { to: '/categories', label: 'Categories', icon: FolderTree },
    ],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    items: [{ to: '/stock', label: 'Stock', icon: Boxes }],
  },
  {
    id: 'sync',
    label: 'Synchronization',
    items: [
      { to: '/sync', label: 'Sync status', icon: RefreshCw, end: true },
      { to: '/sync/activity', label: 'Activity', icon: Activity },
      { to: '/sync/pending', label: 'Pending changes', icon: ListChecks, badge: 'pending' },
      { to: '/devices', label: 'Devices', icon: Monitor },
    ],
  },
]

export const settingsItem: NavItem = { to: '/settings', label: 'Settings', icon: Settings }
