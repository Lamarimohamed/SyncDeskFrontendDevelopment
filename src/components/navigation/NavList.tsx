import { NavLink } from 'react-router'
import { cn } from '@/lib/cn'
import { Tooltip } from '@/components/ui/Tooltip'
import { useSyncSnapshot } from '@/hooks/useSync'
import { navGroups, settingsItem, type NavItem } from './navItems'

interface NavListProps {
  collapsed?: boolean
  onNavigate?: () => void
}

function NavEntry({ item, collapsed, onNavigate }: { item: NavItem; collapsed: boolean; onNavigate?: () => void }) {
  const pending = useSyncSnapshot().pending.length
  const count = item.badge === 'pending' ? pending : 0
  const link = (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      aria-label={collapsed ? `${item.label}${count ? `, ${count} pending` : ''}` : undefined}
      className={({ isActive }) =>
        cn(
          'type-body relative flex h-9 items-center gap-3 rounded-input px-2.5 transition-colors duration-150 max-md:h-11',
          isActive ? 'bg-primary-soft font-medium text-primary-text' : 'text-fg2 hover:bg-subtle hover:text-fg',
          collapsed && 'justify-center',
        )
      }
    >
      <item.icon aria-hidden className="size-[18px] shrink-0" />
      {collapsed ? null : <span className="flex-1 truncate">{item.label}</span>}
      {count > 0 ? (
        collapsed ? (
          <span aria-hidden className="absolute end-1.5 top-1.5 size-2 rounded-full bg-info" />
        ) : (
          <span className="type-caption rounded-full bg-info-soft px-1.5 font-medium text-info-fg">{count}</span>
        )
      ) : null}
    </NavLink>
  )
  return collapsed ? (
    <Tooltip content={item.label} side="end">
      <span className="flex w-full [&>a]:w-full">{link}</span>
    </Tooltip>
  ) : (
    link
  )
}

export function NavList({ collapsed = false, onNavigate }: NavListProps) {
  return (
    <nav aria-label="Primary" className="flex min-h-0 flex-1 flex-col">
      <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {navGroups.map((g) => (
          <div key={g.id} role="group" aria-labelledby={`nav-${g.id}`}>
            <p id={`nav-${g.id}`} className={cn('type-caption mb-1 px-2.5 font-medium text-muted', collapsed && 'sr-only')}>
              {g.label}
            </p>
            {collapsed ? <div aria-hidden className="mx-2 mb-2 h-px bg-line" /> : null}
            <ul className="space-y-0.5">
              {g.items.map((item) => (
                <li key={item.to} className="flex">
                  <NavEntry item={item} collapsed={collapsed} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-line px-3 py-3">
        <NavEntry item={settingsItem} collapsed={collapsed} onNavigate={onNavigate} />
      </div>
    </nav>
  )
}
