import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { NavLink } from 'react-router'
import { cn } from '@/lib/cn'

interface TabItem<T extends string> {
  id: T
  label: string
  count?: number
}

interface TabsProps<T extends string> {
  tabs: TabItem<T>[]
  value: T
  onChange: (id: T) => void
  label: string
  children?: ReactNode
}

const tabBase =
  'type-label relative -mb-px inline-flex h-10 items-center gap-2 border-b-2 px-3 whitespace-nowrap transition-colors duration-150'

export function Tabs<T extends string>({ tabs, value, onChange, label, children }: TabsProps<T>) {
  const base = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  function onKeyDown(e: KeyboardEvent, index: number) {
    const last = tabs.length - 1
    const rtl = getComputedStyle(document.documentElement).direction === 'rtl'
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight'
    const backward = rtl ? 'ArrowRight' : 'ArrowLeft'
    let next = index
    if (e.key === forward) next = index === last ? 0 : index + 1
    else if (e.key === backward) next = index === 0 ? last : index - 1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = last
    else return
    e.preventDefault()
    onChange(tabs[next].id)
    refs.current[next]?.focus()
  }

  return (
    <div>
      <div role="tablist" aria-label={label} className="scroll-thin flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el
            }}
            role="tab"
            id={`${base}-tab-${t.id}`}
            aria-selected={value === t.id}
            aria-controls={`${base}-panel-${t.id}`}
            tabIndex={value === t.id ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(tabBase, value === t.id ? 'border-primary text-fg' : 'border-transparent text-fg2 hover:text-fg')}
          >
            {t.label}
            {t.count !== undefined ? <span className="type-caption rounded-full bg-subtle px-1.5 text-fg2">{t.count}</span> : null}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-panel-${value}`} aria-labelledby={`${base}-tab-${value}`} className="pt-4">
        {children}
      </div>
    </div>
  )
}

interface NavTabItem {
  to: string
  label: string
  end?: boolean
  count?: number
}

/** Route-driven tabs for sibling pages (for example Sync status / Activity / Pending). */
export function NavTabs({ items, label }: { items: NavTabItem[]; label: string }) {
  return (
    <nav aria-label={label} className="scroll-thin -mb-px flex gap-1 overflow-x-auto border-b border-line">
      {items.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) => cn(tabBase, isActive ? 'border-primary text-fg' : 'border-transparent text-fg2 hover:text-fg')}
        >
          {t.label}
          {t.count ? <span className="type-caption rounded-full bg-subtle px-1.5 text-fg2">{t.count}</span> : null}
        </NavLink>
      ))}
    </nav>
  )
}
