import { useEffect, useId, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router'
import { cn } from '@/lib/cn'

export type MenuItem =
  | 'separator'
  | {
      label: string
      icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
      onSelect?: () => void
      to?: string
      tone?: 'default' | 'danger'
      disabled?: boolean
    }

interface DropdownProps {
  label: string
  items: MenuItem[]
  trigger: ReactNode
  triggerClassName?: string
  header?: ReactNode
}

interface Pos {
  top?: number
  bottom?: number
  left?: number
  right?: number
}

export function Dropdown({ label, items, trigger, triggerClassName, header }: DropdownProps) {
  const [pos, setPos] = useState<Pos | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const open = pos !== null

  function toggle() {
    if (open) return setPos(null)
    const r = btnRef.current!.getBoundingClientRect()
    const rtl = getComputedStyle(document.documentElement).direction === 'rtl'
    const flip = r.bottom + 280 > window.innerHeight
    setPos({
      ...(flip ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      ...(rtl ? { left: Math.max(8, r.left) } : { right: Math.max(8, window.innerWidth - r.right) }),
    })
  }

  const close = (restoreFocus = true) => {
    setPos(null)
    if (restoreFocus) btnRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus()
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) setPos(null)
    }
    const onScroll = () => setPos(null)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  function onMenuKey(e: React.KeyboardEvent) {
    const nodes = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])
    const idx = nodes.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown') nodes[(idx + 1) % nodes.length]?.focus()
    else if (e.key === 'ArrowUp') nodes[(idx - 1 + nodes.length) % nodes.length]?.focus()
    else if (e.key === 'Home') nodes[0]?.focus()
    else if (e.key === 'End') nodes[nodes.length - 1]?.focus()
    else if (e.key === 'Escape') {
      e.stopPropagation()
      close()
      return
    } else if (e.key === 'Tab') {
      close(false)
      return
    } else return
    e.preventDefault()
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={toggle}
        onKeyDown={(e) => {
          if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) {
            e.preventDefault()
            toggle()
          }
        }}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              id={id}
              role="menu"
              aria-label={label}
              onKeyDown={onMenuKey}
              style={{ position: 'fixed', ...pos }}
              className="z-[65] min-w-52 animate-fade-in rounded-card bg-surface p-1 shadow-pop"
            >
              {header ? <div className="border-b border-line px-3 py-2">{header}</div> : null}
              {items.map((item, i) => {
                if (item === 'separator') return <div key={i} role="separator" className="my-1 h-px bg-line" />
                const cls = cn(
                  'type-body flex w-full items-center gap-2 rounded-control px-3 py-2 text-start transition-colors duration-100 outline-none',
                  'focus-visible:bg-subtle hover:bg-subtle aria-disabled:opacity-50',
                  item.tone === 'danger' ? 'text-error-fg' : 'text-fg',
                )
                const inner = (
                  <>
                    {item.icon ? <item.icon aria-hidden className="size-4 shrink-0" /> : null}
                    {item.label}
                  </>
                )
                return item.to ? (
                  <Link key={i} to={item.to} role="menuitem" tabIndex={-1} className={cls} onClick={() => close(false)}>
                    {inner}
                  </Link>
                ) : (
                  <button
                    key={i}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    aria-disabled={item.disabled || undefined}
                    className={cls}
                    onClick={() => {
                      if (item.disabled) return
                      close(false)
                      item.onSelect?.()
                    }}
                  >
                    {inner}
                  </button>
                )
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
