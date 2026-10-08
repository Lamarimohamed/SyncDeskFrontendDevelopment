import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface TooltipProps {
  content: ReactNode
  side?: 'top' | 'bottom' | 'end'
  disabled?: boolean
  children: ReactNode
}

interface Pos {
  top: number
  left?: number
  right?: number
  transform: string
}

function compute(rect: DOMRect, side: 'top' | 'bottom' | 'end'): Pos {
  const rtl = getComputedStyle(document.documentElement).direction === 'rtl'
  if (side === 'end') {
    const top = rect.top + rect.height / 2
    return rtl
      ? { top, right: window.innerWidth - rect.left + 8, transform: 'translateY(-50%)' }
      : { top, left: rect.right + 8, transform: 'translateY(-50%)' }
  }
  const left = rect.left + rect.width / 2
  return side === 'top'
    ? { top: rect.top - 8, left, transform: 'translate(-50%, -100%)' }
    : { top: rect.bottom + 8, left, transform: 'translateX(-50%)' }
}

export function Tooltip({ content, side = 'bottom', disabled, children }: TooltipProps) {
  const id = useId()
  const ref = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<Pos | null>(null)

  const show = () => {
    if (disabled || !ref.current) return
    setPos(compute(ref.current.getBoundingClientRect(), side))
  }
  const hide = () => setPos(null)

  useEffect(() => {
    if (!pos) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide()
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', hide, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', hide, true)
    }
  }, [pos])

  return (
    <span
      ref={ref}
      className="inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      aria-describedby={pos ? id : undefined}
    >
      {children}
      {pos
        ? createPortal(
            <div
              id={id}
              role="tooltip"
              style={{ position: 'fixed', top: pos.top, left: pos.left, right: pos.right, transform: pos.transform }}
              className="type-caption pointer-events-none z-[70] max-w-64 animate-fade-in rounded-control bg-fg px-2 py-1.5 text-bg"
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </span>
  )
}
