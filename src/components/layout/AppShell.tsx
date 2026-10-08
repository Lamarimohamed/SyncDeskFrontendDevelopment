import { Outlet, useLocation } from 'react-router'
import { WifiOff } from 'lucide-react'
import { Sidebar } from '@/components/navigation/Sidebar'
import { MobileNav } from '@/components/navigation/MobileNav'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { useStore } from '@/lib/store'
import { uiStore } from '@/state/ui'
import { useSyncSnapshot } from '@/hooks/useSync'
import { plural } from '@/lib/format'
import { Topbar } from './Topbar'
import { DevPanel } from './DevPanel'

export function AppShell() {
  const ui = useStore(uiStore)
  const snap = useSyncSnapshot()
  const location = useLocation()
  const offline = snap.connectivity === 'offline'
  const n = snap.pending.length

  return (
    <div className="flex min-h-dvh bg-bg">
      <a
        href="#main"
        className="type-label sr-only z-50 rounded-input bg-surface px-3 py-2 text-fg focus:not-sr-only focus:fixed focus:start-4 focus:top-4"
      >
        Skip to content
      </a>
      <Sidebar collapsed={ui.sidebarCollapsed} onToggle={() => uiStore.set({ sidebarCollapsed: !ui.sidebarCollapsed })} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        {offline ? (
          <div role="status" className="type-caption flex items-center gap-2 border-b border-line bg-offline-soft px-4 py-2 text-offline-fg md:px-6">
            <WifiOff aria-hidden className="size-4" />
            <span>
              Offline · {n} {plural(n, 'change')} pending. Work continues on this device and will sync when the connection returns.
            </span>
          </div>
        ) : null}
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-28 outline-none md:px-8 md:pb-16">
          <ErrorBoundary resetKey={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      <MobileNav />
      <DevPanel />
    </div>
  )
}
