import type { ComponentType, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info' | 'offline'

export const toneClasses: Record<Tone, string> = {
  neutral: 'bg-subtle text-fg2',
  primary: 'bg-primary-soft text-primary-text',
  success: 'bg-success-soft text-success-fg',
  warning: 'bg-warning-soft text-warning-fg',
  error: 'bg-error-soft text-error-fg',
  info: 'bg-info-soft text-info-fg',
  offline: 'bg-offline-soft text-offline-fg',
}

interface BadgeProps {
  tone?: Tone
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  children: ReactNode
  className?: string
}

export function Badge({ tone = 'neutral', icon: Icon, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'type-caption inline-flex h-5 items-center gap-1 rounded-full px-2 font-medium whitespace-nowrap',
        toneClasses[tone],
        className,
      )}
    >
      {Icon ? <Icon aria-hidden className="size-3" /> : null}
      {children}
    </span>
  )
}
