import type { ReactNode } from 'react'
import { Breadcrumb, type Crumb } from '@/components/ui/Breadcrumb'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'

interface PageHeaderProps {
  title: string
  description?: ReactNode
  actions?: ReactNode
  breadcrumbs?: Crumb[]
  meta?: ReactNode
  documentTitle?: string
}

export function PageHeader({ title, description, actions, breadcrumbs, meta, documentTitle }: PageHeaderProps) {
  useDocumentTitle(documentTitle ?? title)
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {breadcrumbs ? <div className="mb-2"><Breadcrumb items={breadcrumbs} /></div> : null}
        <h1 className="type-h1 text-fg">{title}</h1>
        {description ? <p className="type-body mt-1 max-w-2xl text-fg2">{description}</p> : null}
        {meta ? <div className="mt-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}
