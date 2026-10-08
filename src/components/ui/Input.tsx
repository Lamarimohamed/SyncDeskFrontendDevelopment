import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { controlClasses } from './Field'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
  start?: ReactNode
  end?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ invalid, start, end, className, ...rest }, ref) {
  if (!start && !end) {
    return <input ref={ref} className={cn(controlClasses(invalid), 'type-body h-9 max-sm:h-11', className)} {...rest} />
  }
  return (
    <div className="relative">
      {start ? <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-muted">{start}</span> : null}
      <input
        ref={ref}
        className={cn(controlClasses(invalid), 'type-body h-9 max-sm:h-11', start ? 'ps-9' : '', end ? 'pe-9' : '', className)}
        {...rest}
      />
      {end ? <span className="absolute inset-y-0 end-1 flex items-center">{end}</span> : null}
    </div>
  )
})

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ invalid, className, rows = 3, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} className={cn(controlClasses(invalid), 'type-body min-h-20 resize-y py-2', className)} {...rest} />
})

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ invalid, className, children, ...rest }, ref) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(controlClasses(invalid), 'type-body h-9 max-sm:h-11 appearance-none pe-9', className)}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
    </div>
  )
})
