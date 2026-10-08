import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { IconButton } from './Button'
import { cn } from '@/lib/cn'

type ToastTone = 'neutral' | 'success' | 'error'

export interface ToastInput {
  title: string
  description?: string
  tone?: ToastTone
  action?: { label: string; onAction: () => void }
  durationMs?: number
}

interface ToastItem extends ToastInput {
  id: number
}

interface ToastApi {
  show: (toast: ToastInput) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const MAX_VISIBLE = 3

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), [])

  const show = useCallback(
    (toast: ToastInput) => {
      const id = nextId.current++
      setItems((all) => [...all, { ...toast, id }].slice(-MAX_VISIBLE))
      setTimeout(() => dismiss(id), toast.durationMs ?? (toast.action ? 8000 : 4500))
    },
    [dismiss],
  )

  const api = useMemo(() => ({ show }), [show])
  const Icon = { neutral: Info, success: CircleCheck, error: CircleAlert }

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="region"
        aria-label="Notifications"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:inset-x-auto md:end-6 md:bottom-6 md:items-end md:px-0"
      >
        {items.map((t) => {
          const I = Icon[t.tone ?? 'neutral']
          return (
            <div
              key={t.id}
              className="pointer-events-auto flex w-full max-w-sm animate-toast-in items-start gap-3 rounded-card bg-surface p-3 shadow-pop"
            >
              <I
                aria-hidden
                className={cn('mt-0.5 size-4 shrink-0', t.tone === 'success' ? 'text-success' : t.tone === 'error' ? 'text-error' : 'text-info')}
              />
              <div className="min-w-0 flex-1">
                <p className="type-label text-fg">{t.title}</p>
                {t.description ? <p className="type-body-sm mt-0.5 text-fg2">{t.description}</p> : null}
              </div>
              {t.action ? (
                <button
                  type="button"
                  className="type-label rounded-control px-2 py-1 text-primary-text hover:bg-primary-soft"
                  onClick={() => {
                    t.action?.onAction()
                    dismiss(t.id)
                  }}
                >
                  {t.action.label}
                </button>
              ) : null}
              <IconButton label="Dismiss notification" size="sm" className="-my-1 -me-1" onClick={() => dismiss(t.id)}>
                <X aria-hidden className="size-4" />
              </IconButton>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
