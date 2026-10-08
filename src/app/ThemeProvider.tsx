import { useEffect, type ReactNode } from 'react'
import { usePreferences } from '@/hooks/usePreferences'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [prefs] = usePreferences()

  useEffect(() => {
    const root = document.documentElement
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
    const apply = () => root.classList.toggle('dark', prefs.theme === 'dark' || (prefs.theme === 'system' && !!mq?.matches))
    apply()
    mq?.addEventListener('change', apply)
    return () => mq?.removeEventListener('change', apply)
  }, [prefs.theme])

  useEffect(() => {
    document.documentElement.dataset.motion = prefs.reducedMotion ? 'reduced' : 'full'
  }, [prefs.reducedMotion])

  useEffect(() => {
    document.documentElement.dir = prefs.direction
    document.documentElement.lang = prefs.direction === 'rtl' ? 'ar' : 'en'
  }, [prefs.direction])

  return <>{children}</>
}
