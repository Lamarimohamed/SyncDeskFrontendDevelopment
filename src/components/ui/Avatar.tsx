import { cn } from '@/lib/cn'

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
}

export function Avatar({ name, size = 'md', className }: { name: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-primary-soft font-medium text-primary-text',
        size === 'sm' ? 'size-6 text-[11px]' : size === 'lg' ? 'size-14 text-lg' : 'size-8 text-xs',
        className,
      )}
    >
      {initials(name)}
    </span>
  )
}
