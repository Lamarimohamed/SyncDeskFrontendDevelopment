import type { HTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/cn'

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-card border border-line bg-surface', className)} {...rest} />
}

interface CardHeaderProps {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  as?: 'h2' | 'h3'
}

export function CardHeader({ title, description, action, as: Tag = 'h2' }: CardHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <Tag className="type-h3 text-fg">{title}</Tag>
        {description ? <p className="type-body-sm mt-0.5 text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 sm:p-5', className)} {...rest} />
}

interface MetricCardProps {
  label: string
  value: ReactNode
  hint?: ReactNode
  to?: string
  actionLabel?: string
  tone?: 'default' | 'warning' | 'info'
}

export function MetricCard({ label, value, hint, to, actionLabel, tone = 'default' }: MetricCardProps) {
  const content = (
    <>
      <p className="type-body-sm text-fg2">{label}</p>
      <p
        className={cn(
          'type-metric mt-1',
          tone === 'warning' ? 'text-warning-fg' : tone === 'info' ? 'text-info-fg' : 'text-fg',
        )}
      >
        {value}
      </p>
      {hint ? <p className="type-caption mt-1 text-muted">{hint}</p> : null}
      {to && actionLabel ? (
        <p className="type-body-sm mt-3 inline-flex items-center gap-1 font-medium text-primary-text">
          {actionLabel}
          <ArrowRight aria-hidden className="size-3.5 rtl:rotate-180" />
        </p>
      ) : null}
    </>
  )
  const base = 'block rounded-card border border-line bg-surface p-4'
  return to ? (
    <Link to={to} className={cn(base, 'transition-colors duration-150 hover:border-line-strong hover:bg-subtle')}>
      {content}
    </Link>
  ) : (
    <div className={base}>{content}</div>
  )
}
