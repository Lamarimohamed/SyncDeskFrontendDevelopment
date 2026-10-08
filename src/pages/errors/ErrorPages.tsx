import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Logo } from '@/components/brand/Logo'
import { Button, ButtonLink } from '@/components/ui/Button'
import { useAuth } from '@/hooks/useAuth'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useSyncSnapshot } from '@/hooks/useSync'
import { plural, relativeTime } from '@/lib/format'
import { syncService } from '@/services/container'

interface ErrorPageLayoutProps {
  code: string
  title: string
  documentTitle: string
  children: ReactNode
  actions?: ReactNode
  extra?: ReactNode
}

/** Standalone layout for error and status pages (no app shell). */
export function ErrorPageLayout({ code, title, documentTitle, children, actions, extra }: ErrorPageLayoutProps) {
  useDocumentTitle(documentTitle)
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex h-16 items-center px-4 sm:px-6">
        <Link to="/" aria-label="SyncDesk home" className="rounded-control">
          <Logo />
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 pb-24 sm:px-6">
        <p aria-hidden className={`tabular font-mono leading-none font-semibold tracking-tight text-line-strong ${code.length > 3 ? 'text-[44px] sm:text-[72px]' : 'text-[72px] sm:text-[96px]'}`}>
          {code}
        </p>
        <h1 className="type-h1 mt-6 text-fg">
          <span className="sr-only">Error {code}: </span>
          {title}
        </h1>
        <div className="type-body-lg mt-2 text-fg2">{children}</div>
        {extra ? <div className="mt-6">{extra}</div> : null}
        <div className="mt-8 flex flex-wrap gap-3">{actions}</div>
      </main>
    </div>
  )
}

function HomeAction({ primary = true }: { primary?: boolean }) {
  const { isAuthenticated } = useAuth()
  return isAuthenticated ? (
    <ButtonLink to="/dashboard" variant={primary ? 'primary' : 'secondary'}>Go to dashboard</ButtonLink>
  ) : (
    <ButtonLink to="/" variant={primary ? 'primary' : 'secondary'}>Go to home page</ButtonLink>
  )
}

export function NotFoundPage() {
  const { isAuthenticated } = useAuth()
  return (
    <ErrorPageLayout
      code="404"
      title="Page not found"
      documentTitle="Page not found"
      actions={
        <>
          <HomeAction />
          {!isAuthenticated ? <ButtonLink to="/login">Sign in</ButtonLink> : null}
        </>
      }
    >
      The address may be mistyped, or the page may have moved. Nothing was lost; data on this device is unchanged.
    </ErrorPageLayout>
  )
}

export function UnauthorizedPage() {
  return (
    <ErrorPageLayout
      code="401"
      title="Sign in required"
      documentTitle="Sign in required"
      actions={
        <>
          <ButtonLink to="/login" variant="primary">Sign in</ButtonLink>
          <ButtonLink to="/">Go to home page</ButtonLink>
        </>
      }
    >
      You need to be signed in to view this page. Your session may have ended.
    </ErrorPageLayout>
  )
}

export function ForbiddenPage() {
  const { user } = useAuth()
  return (
    <ErrorPageLayout
      code="403"
      title="You do not have access"
      documentTitle="Access denied"
      actions={user ? <HomeAction /> : <ButtonLink to="/login" variant="primary">Sign in</ButtonLink>}
    >
      {user
        ? `Your role (${user.role}) does not include permission to open this page. Ask a workspace owner if you need access.`
        : 'Your account does not include permission to open this page.'}
    </ErrorPageLayout>
  )
}

export function ServerErrorPage() {
  const { isAuthenticated } = useAuth()
  return (
    <ErrorPageLayout
      code="500"
      title="Something went wrong"
      documentTitle="Unexpected error"
      actions={
        <>
          <Button variant="primary" onClick={() => window.location.reload()}>Reload page</Button>
          <HomeAction primary={false} />
        </>
      }
    >
      The app hit an unexpected problem.{' '}
      {isAuthenticated ? 'Changes saved on this device and queued changes are not affected.' : 'Reloading usually fixes it.'}
    </ErrorPageLayout>
  )
}

export function OfflinePage() {
  const snap = useSyncSnapshot()
  const { isAuthenticated } = useAuth()
  const [message, setMessage] = useState<string | null>(null)

  function tryAgain() {
    if (navigator.onLine) {
      syncService.goOnline()
      setMessage('Your device reports a connection. Reconnecting now.')
    } else {
      setMessage('Still offline. Your device reports no connection.')
    }
  }

  return (
    <ErrorPageLayout
      code="Offline"
      title="You are offline"
      documentTitle="Offline"
      extra={
        <div>
          <dl className="divide-y divide-line border-y border-line">
            <div className="flex items-baseline justify-between gap-4 py-3">
              <dt className="type-body text-fg2">Changes waiting to sync</dt>
              <dd className="type-body tabular font-medium text-fg">{plural(snap.pending.length, 'change')}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-3">
              <dt className="type-body text-fg2">Last sync</dt>
              <dd className="type-body font-medium text-fg">{snap.lastSyncAt ? relativeTime(snap.lastSyncAt) : 'Never'}</dd>
            </div>
          </dl>
          <p role="status" className="type-body-sm mt-3 min-h-5 text-muted">{message}</p>
        </div>
      }
      actions={
        <>
          <Button variant="primary" onClick={tryAgain}>Try again</Button>
          {isAuthenticated ? <ButtonLink to="/dashboard">Open dashboard</ButtonLink> : <ButtonLink to="/">Go to home page</ButtonLink>}
        </>
      }
    >
      SyncDesk keeps working without a connection. Your edits are saved on this device and will merge with other devices when the connection returns.
    </ErrorPageLayout>
  )
}
