import { Link } from 'react-router'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Logo, LogoMark } from '@/components/brand/Logo'
import { IconButton } from '@/components/ui/Button'
import { Tooltip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/cn'
import { NavList } from './NavList'

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col border-e border-line bg-surface transition-[width] duration-200 md:flex',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      <div className={cn('flex h-14 shrink-0 items-center border-b border-line', collapsed ? 'justify-center' : 'justify-between ps-4 pe-2')}>
        <Link to="/dashboard" aria-label="SyncDesk dashboard" className="rounded-control">
          {collapsed ? <LogoMark /> : <Logo />}
        </Link>
        {collapsed ? null : (
          <IconButton label="Collapse sidebar" size="sm" onClick={onToggle}>
            <PanelLeftClose aria-hidden className="size-4 rtl:rotate-180" />
          </IconButton>
        )}
      </div>
      <NavList collapsed={collapsed} />
      {collapsed ? (
        <div className="flex justify-center border-t border-line py-2">
          <Tooltip content="Expand sidebar" side="end">
            <IconButton label="Expand sidebar" size="sm" onClick={onToggle}>
              <PanelLeftOpen aria-hidden className="size-4 rtl:rotate-180" />
            </IconButton>
          </Tooltip>
        </div>
      ) : null}
    </aside>
  )
}
