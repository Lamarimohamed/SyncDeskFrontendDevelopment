import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { IconButton } from './Button'

const stack: symbol[] = []
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function useOverlayBehavior(open: boolean, onClose: () => void, dismissible: boolean) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    const id = Symbol('overlay')
    stack.push(id)
    const previous = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const focusables = () => Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    const initial = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables().find((el) => el.dataset.close === undefined) ?? panel
    initial?.focus()

    function onKey(e: KeyboardEvent) {
      if (stack[stack.length - 1] !== id) return
      if (e.key === 'Escape' && dismissible) {
        e.stopPropagation()
        closeRef.current()
      } else if (e.key === 'Tab') {
        const items = focusables()
        if (items.length === 0) {
          e.preventDefault()
          return
        }
        const first = items[0]
        const last = items[items.length - 1]
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      stack.splice(stack.indexOf(id), 1)
      document.body.style.overflow = prevOverflow
      previous?.focus?.()
    }
  }, [open, dismissible])

  return panelRef
}

interface OverlayProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  dismissible?: boolean
}

function OverlayFrame({
  variant,
  size,
  open,
  onClose,
  title,
  description,
  children,
  footer,
  dismissible = true,
}: OverlayProps & { variant: 'modal' | 'drawer'; size?: 'sm' | 'md' | 'lg' }) {
  const panelRef = useOverlayBehavior(open, onClose, dismissible)
  const titleId = useId()
  const descId = useId()
  if (!open) return null

  const panel =
    variant === 'modal'
      ? cn(
          'relative flex max-h-[90dvh] w-full flex-col bg-surface shadow-pop outline-none',
          'max-sm:animate-sheet-in max-sm:rounded-t-dialog sm:animate-pop-in sm:rounded-dialog',
          size === 'sm' ? 'sm:max-w-sm' : size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-md',
        )
      : 'relative flex h-full max-h-dvh w-full flex-col bg-surface shadow-pop outline-none max-sm:max-h-[92dvh] max-sm:animate-sheet-in max-sm:rounded-t-dialog sm:max-w-md sm:animate-slide-in-end sm:[--slide-from:24px] rtl:sm:[--slide-from:-24px]'

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-50 flex',
        variant === 'modal' ? 'items-end justify-center sm:items-center sm:p-4' : 'items-end justify-end sm:items-stretch',
      )}
    >
      <div
        aria-hidden
        className="absolute inset-0 animate-fade-in bg-overlay"
        onClick={dismissible ? onClose : undefined}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={panel}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="type-h2 text-fg">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="type-body-sm mt-0.5 text-fg2">
                {description}
              </p>
            ) : null}
          </div>
          {dismissible ? (
            <IconButton label="Close" size="sm" onClick={onClose} data-close>
              <X aria-hidden className="size-4" />
            </IconButton>
          ) : null}
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="pb-safe flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}

export function Modal(props: OverlayProps & { size?: 'sm' | 'md' | 'lg' }) {
  return <OverlayFrame variant="modal" {...props} />
}

export function Drawer(props: OverlayProps) {
  return <OverlayFrame variant="drawer" {...props} />
}
