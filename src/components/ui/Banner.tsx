import type { ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, TriangleAlert, WifiOff } from 'lucide-react'
import { cn } from '@/lib/cn'
import { toneClasses } from './Badge'

type BannerTone = 'info' | 'success' | 'warning' | 'error' | 'offline'

const icons = { info: Info, success: CircleCheck, warning: TriangleAlert, error: CircleAlert, offline: WifiOff }

interface BannerProps {
  tone?: BannerTone
  title?: string
  children?: ReactNode
  action?: ReactNode
  className?: string
}

export function Banner({ tone = 'info', title, children, action, className }: BannerProps) {
  const Icon = icons[tone]
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex flex-wrap items-start gap-3 rounded-card border border-line px-4 py-3', toneClasses[tone], className)}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="type-body min-w-0 flex-1">
        {title ? <p className="type-label">{title}</p> : null}
        {children ? <div className={cn(title && 'mt-0.5', 'text-current')}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
