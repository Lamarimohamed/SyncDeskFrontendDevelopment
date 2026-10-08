import { NavLink, Outlet } from 'react-router'
import { PageHeader } from '@/components/layout/PageHeader'
import { cn } from '@/lib/cn'

const items = [
  { to: '/settings/profile', label: 'Profile' },
  { to: '/settings/workspace', label: 'Workspace' },
  { to: '/settings/synchronization', label: 'Synchronization' },
  { to: '/settings/connectivity', label: 'Connectivity' },
  { to: '/settings/appearance', label: 'Appearance' },
]

export function SettingsLayout() {
  return (
    <div>
      <PageHeader title="Settings" description="Preferences for this device and workspace." />
      <div className="flex flex-col gap-6 md:flex-row md:gap-10">
        <nav aria-label="Settings" className="md:w-52 md:shrink-0">
          <ul className="scroll-thin -mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 md:mx-0 md:flex-col md:overflow-visible md:border-b-0 md:px-0">
            {items.map((i) => (
              <li key={i.to} className="shrink-0">
                <NavLink
                  to={i.to}
                  className={({ isActive }) =>
                    cn(
                      'type-label -mb-px flex h-10 items-center border-b-2 px-3 whitespace-nowrap transition-colors duration-150',
                      'md:mb-0 md:h-9 md:rounded-control md:border-b-0 md:border-s-2 md:rounded-s-none',
                      isActive
                        ? 'border-primary text-fg md:bg-subtle'
                        : 'border-transparent text-fg2 hover:text-fg md:hover:bg-subtle',
                    )
                  }
                >
                  {i.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 max-w-2xl flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
