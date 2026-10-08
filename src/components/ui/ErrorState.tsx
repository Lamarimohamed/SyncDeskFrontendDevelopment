import type { ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Button } from './Button'

interface ErrorStateProps {
  title: string
  description?: ReactNode
  /** Reassure the user about offline-first guarantees. */
  reassurance?: string
  onRetry?: () => void
  retryLabel?: string
  actions?: ReactNode
}

export function ErrorState({ title, description, reassurance, onRetry, retryLabel = 'Retry', actions }: ErrorStateProps) {
  return (
    <div role="alert" className="px-6 py-14 text-center">
      <span className="mx-auto mb-4 flex size-10 items-center justify-center rounded-card bg-error-soft text-error-fg">
        <TriangleAlert aria-hidden className="size-5" />
      </span>
      <h3 className="type-h3 text-fg">{title}</h3>
      {description ? <p className="type-body mx-auto mt-1 max-w-md text-fg2">{description}</p> : null}
      {reassurance ? <p className="type-body mx-auto mt-1 max-w-md text-fg2">{reassurance}</p> : null}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {onRetry ? <Button onClick={onRetry}>{retryLabel}</Button> : null}
        {actions}
      </div>
    </div>
  )
}
