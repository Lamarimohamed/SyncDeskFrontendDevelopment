import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode
  description?: ReactNode
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, description, className, id, ...rest }, ref) {
  const auto = useId()
  const inputId = id ?? auto
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <span className="relative mt-0.5 inline-flex size-4 shrink-0">
        <input
          ref={ref}
          id={inputId}
          type="checkbox"
          className="peer size-4 cursor-pointer appearance-none rounded-[4px] border border-line-strong bg-surface transition-colors duration-150 checked:border-primary checked:bg-primary disabled:opacity-50"
          {...rest}
        />
        <Check aria-hidden strokeWidth={3} className="pointer-events-none absolute inset-0 m-auto size-3 text-on-primary opacity-0 peer-checked:opacity-100" />
      </span>
      <label htmlFor={inputId} className="type-body cursor-pointer text-fg">
        {label}
        {description ? <span className="type-body-sm block text-muted">{description}</span> : null}
      </label>
    </div>
  )
})
