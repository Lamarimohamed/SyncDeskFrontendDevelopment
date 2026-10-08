import { useState } from 'react'
import { NavLink } from 'react-router'
import { Boxes, LayoutDashboard, Menu, Package, RefreshCw } from 'lucide-react'
import { Drawer } from '@/components/ui/Overlay'
import { cn } from '@/lib/cn'
import { useSyncSnapshot } from '@/hooks/useSync'
import { NavList } from './NavList'

const tabs = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/products', label: 'Products', icon: Package },
  { to: '/stock', label: 'Stock', icon: Boxes },
  { to: '/sync', label: 'Sync', icon: RefreshCw },
]

export function MobileNav() {
  const [open, setOpen] = useState(false)
  const pending = useSyncSnapshot().pending.length
  const itemClass = 'type-caption relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 transition-colors duration-150'
  return (
    <>
      <nav aria-label="Primary mobile" className="pb-safe fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface md:hidden">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === '/sync'}
            className={({ isActive }) => cn(itemClass, isActive ? 'font-medium text-primary-text' : 'text-fg2')}
          >
            <t.icon aria-hidden className="size-5" />
            {t.label}
            {t.to === '/sync' && pending > 0 ? (
              <span className="type-caption absolute top-1.5 start-1/2 ms-2 min-w-4 rounded-full bg-info px-1 text-center text-[10px] leading-4 font-medium text-white">
                <span className="sr-only">{pending} pending</span>
                <span aria-hidden>{pending}</span>
              </span>
            ) : null}
          </NavLink>
        ))}
        <button type="button" className={cn(itemClass, 'text-fg2')} onClick={() => setOpen(true)} aria-haspopup="dialog">
          <Menu aria-hidden className="size-5" />
          More
        </button>
      </nav>
      <Drawer open={open} onClose={() => setOpen(false)} title="Menu">
        <div className="-mx-5 -my-4 flex h-full flex-col">
          <NavList onNavigate={() => setOpen(false)} />
        </div>
      </Drawer>
    </>
  )
}
