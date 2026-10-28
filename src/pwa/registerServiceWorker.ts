import { logger } from '@/lib/logger'

/**
 * Registers the application-shell service worker in production builds.
 * Development is excluded on purpose: Vite serves ephemeral modules that
 * must never be cached, and offline behaviour is tested against the
 * production build via `vite preview`.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        logger.info('PWA', 'Service worker registered', registration.scope)
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              worker.postMessage('SKIP_WAITING')
            }
          })
        })
      })
      .catch((error: unknown) => {
        logger.warn('PWA', 'Service worker registration failed', error instanceof Error ? error.message : String(error))
      })
  })
}
