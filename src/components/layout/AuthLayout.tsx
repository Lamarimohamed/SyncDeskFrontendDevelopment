import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Logo } from '@/components/brand/Logo'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'

interface AuthLayoutProps {
  title: string
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  banner?: ReactNode
}

export function AuthLayout({ title, description, children, footer, banner }: AuthLayoutProps) {
  useDocumentTitle(title)
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex h-16 items-center px-6">
        <Link to="/" aria-label="SyncDesk home" className="rounded-control">
          <Logo />
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:items-center sm:pt-0">
        <div className="w-full max-w-md">
          {banner ? <div className="mb-4">{banner}</div> : null}
          <div className="rounded-dialog border border-line bg-surface p-6 sm:p-8">
            <h1 className="type-h2 text-fg">{title}</h1>
            {description ? <p className="type-body mt-1.5 text-fg2">{description}</p> : null}
            <div className="mt-6">{children}</div>
          </div>
          {footer ? <div className="type-body-sm mt-4 text-center text-fg2">{footer}</div> : null}
        </div>
      </main>
    </div>
  )
}
