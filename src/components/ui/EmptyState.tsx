import type { ComponentType, ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  title: string
  description: ReactNode
  /** What happens once the user acts. */
  next?: string
  actions?: ReactNode
  compact?: boolean
}

export function EmptyState({ icon: Icon, title, description, next, actions, compact }: EmptyStateProps) {
  return (
    <div className={compact ? 'px-6 py-10 text-center' : 'px-6 py-16 text-center'}>
      {Icon ? (
        <span className="mx-auto mb-4 flex size-10 items-center justify-center rounded-card bg-subtle text-fg2">
          <Icon aria-hidden className="size-5" />
        </span>
      ) : null}
      <h3 className="type-h3 text-fg">{title}</h3>
      <p className="type-body mx-auto mt-1 max-w-md text-fg2">{description}</p>
      {next ? <p className="type-body-sm mx-auto mt-1 max-w-md text-muted">{next}</p> : null}
      {actions ? <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </div>
  )
}
