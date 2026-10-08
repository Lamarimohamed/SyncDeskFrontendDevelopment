import { cloneElement, useId, type ReactElement, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface FieldProps {
  label: string
  helper?: ReactNode
  error?: string
  success?: string
  optional?: boolean
  className?: string
  children: ReactElement<Record<string, unknown>>
}

/** Label, control, helper and error wiring. The child control receives id and aria attributes. */
export function Field({ label, helper, error, success, optional, className, children }: FieldProps) {
  const id = useId()
  const helperId = helper ? `${id}-helper` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [errorId, helperId].filter(Boolean).join(' ') || undefined
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="type-label text-fg">
        {label}
        {optional ? <span className="ms-1 font-normal text-muted">(optional)</span> : null}
      </label>
      {cloneElement(children, { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy, invalid: Boolean(error) })}
      {error ? (
        <p id={errorId} className="type-body-sm text-error-fg">
          {error}
        </p>
      ) : success ? (
        <p className="type-body-sm text-success-fg">{success}</p>
      ) : null}
      {helper ? (
        <p id={helperId} className="type-body-sm text-muted">
          {helper}
        </p>
      ) : null}
    </div>
  )
}

export const controlClasses = (invalid?: boolean) =>
  cn(
    'w-full rounded-input border bg-surface px-3 text-fg transition-colors duration-150 placeholder:text-muted',
    'hover:border-muted focus-visible:border-primary focus-visible:outline-2 focus-visible:-outline-offset-1',
    'disabled:cursor-not-allowed disabled:bg-subtle disabled:text-muted',
    invalid ? 'border-error' : 'border-line-strong',
  )
