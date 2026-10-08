import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface SettingsSectionProps {
  title: string
  description?: ReactNode
  children: ReactNode
  className?: string
}

/** Titled group within a settings page. Heading left on wide screens, content right. */
export function SettingsSection({ title, description, children, className }: SettingsSectionProps) {
  const id = useId()
  return (
    <section aria-labelledby={id} className={cn('border-b border-line py-6 first:pt-0 last:border-b-0', className)}>
      <h2 id={id} className="type-h3 text-fg">{title}</h2>
      {description ? <p className="type-body-sm mt-1 max-w-xl text-muted">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  )
}

interface RadioOption<T extends string> {
  value: T
  label: string
  description?: string
}

interface RadioGroupProps<T extends string> {
  legend: string
  name: string
  value: T
  options: RadioOption<T>[]
  onChange: (value: T) => void
}

export function RadioGroup<T extends string>({ legend, name, value, options, onChange }: RadioGroupProps<T>) {
  return (
    <fieldset>
      <legend className="sr-only">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((o) => {
          const checked = o.value === value
          return (
            <label
              key={o.value}
              className={cn(
                'flex cursor-pointer flex-col gap-0.5 rounded-card border px-3 py-3 transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary',
                checked ? 'border-primary bg-primary-soft' : 'border-line bg-surface hover:bg-subtle',
              )}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name={name}
                  value={o.value}
                  checked={checked}
                  onChange={() => onChange(o.value)}
                  className="size-4 accent-[var(--primary)]"
                />
                <span className="type-label text-fg">{o.label}</span>
              </span>
              {o.description ? <span className="type-caption ps-6 text-muted">{o.description}</span> : null}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
