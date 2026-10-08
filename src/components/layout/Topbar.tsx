import { LogOut, Moon, Settings, Sun, User as UserIcon } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Dropdown } from '@/components/ui/Dropdown'
import { Avatar } from '@/components/ui/Avatar'
import { IconButton } from '@/components/ui/Button'
import { Logo } from '@/components/brand/Logo'
import { SyncIndicator } from '@/components/sync/SyncIndicator'
import { useAuth } from '@/hooks/useAuth'
import { usePreferences } from '@/hooks/usePreferences'
import { useToast } from '@/components/ui/Toast'
import { env } from '@/lib/env'

export function Topbar() {
  const { user, service } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [prefs, setPrefs] = usePreferences()
  const resolvedDark =
    prefs.theme === 'dark' || (prefs.theme === 'system' && typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches)

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface px-4 md:px-6">
      <div className="md:hidden">
        <Logo />
      </div>
      <div className="ms-auto flex items-center gap-2">
        {env.demoMode ? <span className="type-caption hidden rounded-control bg-subtle px-2 py-0.5 text-muted sm:inline">Demo workspace</span> : null}
        <SyncIndicator compactOnMobile asLink />
        <IconButton
          label={resolvedDark ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={() => setPrefs({ theme: resolvedDark ? 'light' : 'dark' })}
        >
          {resolvedDark ? <Sun aria-hidden className="size-[18px]" /> : <Moon aria-hidden className="size-[18px]" />}
        </IconButton>
        {user ? (
          <Dropdown
            label="Account menu"
            triggerClassName="rounded-full"
            trigger={<Avatar name={user.name} size="sm" />}
            header={
              <div className="px-3 py-2">
                <p className="type-label text-fg">{user.name}</p>
                <p className="type-caption text-muted">{user.email}</p>
              </div>
            }
            items={[
              { label: 'Profile', icon: UserIcon, to: '/settings/profile' },
              { label: 'Settings', icon: Settings, to: '/settings' },
              'separator',
              {
                label: 'Sign out',
                icon: LogOut,
                onSelect: async () => {
                  await service.logout()
                  toast.show({ title: 'Signed out', description: 'Local data stays on this device.' })
                  navigate('/login', { replace: true })
                },
              },
            ]}
          />
        ) : null}
      </div>
    </header>
  )
}
