import { cn } from '@/lib/cn'

type LogoTone = 'brand' | 'mono' | 'on-dark'

const colors: Record<LogoTone, { box: string; glyph: string }> = {
  brand: { box: '#2563eb', glyph: '#ffffff' },
  mono: { box: 'currentColor', glyph: 'var(--bg)' },
  'on-dark': { box: '#ffffff', glyph: '#2563eb' },
}

/** Two replicas (a solid local node and an open remote node) joined by a continuous path. */
export function LogoMark({ tone = 'brand', className }: { tone?: LogoTone; className?: string }) {
  const c = colors[tone]
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn('size-8 shrink-0', className)}>
      <rect width="32" height="32" rx="8" fill={c.box} />
      <path d="M11 21c0-5 10-5 10-10" fill="none" stroke={c.glyph} strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="10.5" cy="21.5" r="3.4" fill={c.glyph} />
      <circle cx="21.5" cy="10.5" r="3" fill="none" stroke={c.glyph} strokeWidth="2.2" />
    </svg>
  )
}

export function Logo({ tone = 'brand', className, showWordmark = true }: { tone?: LogoTone; className?: string; showWordmark?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', tone === 'on-dark' ? 'text-white' : 'text-fg', className)}>
      <LogoMark tone={tone} />
      {showWordmark ? <span className="text-[17px] font-semibold tracking-tight">SyncDesk</span> : <span className="sr-only">SyncDesk</span>}
    </span>
  )
}
