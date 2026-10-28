/*
 * SyncDesk service worker — application-shell caching for offline startup.
 *
 * Strategy:
 * - Navigation requests: network-first with a cache fallback, so a visited
 *   document keeps loading when the server is unreachable. Successful
 *   navigations are cached under their request URL; '/' is the fallback
 *   shell for client-side routes never visited online.
 * - Hashed build assets (/assets/...): cache-first, they are immutable.
 * - Other same-origin static files (icons, manifest, favicon):
 *   stale-while-revalidate.
 * - Cross-origin requests (the backend API) and non-GET requests are never
 *   intercepted or cached. The application itself queues failed writes;
 *   the network layer stays honest.
 */

const VERSION = 'syncdesk-shell-v1'
const SHELL_CACHE = `${VERSION}-shell`
const ASSET_CACHE = `${VERSION}-assets`
const STATIC_CACHE = `${VERSION}-static`

const PRECACHE_URLS = ['/', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      await cache.addAll(PRECACHE_URLS)
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((name) => !name.startsWith(VERSION)).map((name) => caches.delete(name)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

const isHashedAsset = (url) => url.pathname.startsWith('/assets/')
const isStaticFile = (url) =>
  url.pathname === '/manifest.webmanifest' ||
  url.pathname === '/favicon.svg' ||
  url.pathname.startsWith('/icons/')

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // Vite dev/preview internals must always hit the network.
  if (url.pathname.startsWith('/@') || url.pathname.startsWith('/node_modules/')) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstDocument(request))
    return
  }
  if (isHashedAsset(url)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE))
    return
  }
  if (isStaticFile(url)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE))
  }
})

async function networkFirstDocument(request) {
  const cache = await caches.open(SHELL_CACHE)
  try {
    const response = await fetch(request)
    if (response && response.ok) await cache.put(request, response.clone())
    return response
  } catch (error) {
    const cached = (await cache.match(request)) ?? (await cache.match('/'))
    if (cached) return cached
    throw error
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response && response.ok) await cache.put(request, response.clone())
  return response
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone())
      return response
    })
    .catch(() => undefined)
  return cached ?? (await network) ?? Response.error()
}
