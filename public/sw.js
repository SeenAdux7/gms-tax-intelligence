/**
 * Service worker
 * ==============
 *
 * WHAT "OFFLINE" HONESTLY MEANS HERE
 *
 * This does NOT make the app work without a connection. It makes content you
 * have already loaded stay readable when the connection drops — reading an
 * update on the underground, finishing a lesson in a lift. Brand new
 * developments published an hour ago still need the network, and the offline
 * page below says so rather than implying a sync failed.
 *
 * STRATEGY, AND WHY IT IS NOT "CACHE FIRST"
 *
 * Pages use network-first with a cache fallback. Cache-first would be faster,
 * and wrong: this app's whole point is showing current regulatory information,
 * and serving a stale page from cache while the device is online could show
 * someone last week's version of a rule. Freshness beats a few hundred
 * milliseconds here.
 *
 * Static assets (the build output, icons) are cache-first, because Next.js
 * fingerprints their filenames — a changed asset has a different URL, so a
 * cached one can never be stale.
 *
 * WHAT IS DELIBERATELY NEVER CACHED
 *
 *   /api/*        — the refresh endpoint SPENDS MONEY when called, and the
 *                   debug endpoints are dev-only. A cached POST response, or a
 *                   replayed request, would be actively harmful.
 *   non-GET       — service workers should not touch mutations. Saving a
 *                   bookmark or recording an answer must reach the server or
 *                   visibly fail, never appear to succeed from a cache.
 */

const VERSION = 'v1'
const PAGES = `pages-${VERSION}`
const ASSETS = `assets-${VERSION}`
const OFFLINE_URL = '/offline'

/** Pre-cached so the offline fallback itself is available offline. */
const PRECACHE = [OFFLINE_URL, '/icons/icon-192.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(PAGES)
      .then((cache) => cache.addAll(PRECACHE))
      // Take over immediately rather than waiting for every tab to close.
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== PAGES && key !== ASSETS)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Mutations and API calls go straight to the network, always.
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  // Fingerprinted build output and icons: cache-first is safe because the URL
  // changes when the content does.
  const isStatic =
    url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')

  if (isStatic) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone()
              caches.open(ASSETS).then((cache) => cache.put(request, copy))
            }
            return response
          }),
      ),
    )
    return
  }

  // Pages and data: network first, fall back to cache, then to the offline page.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(PAGES).then((cache) => cache.put(request, copy))
        }
        return response
      })
      .catch(async () => {
        const cached = await caches.match(request)
        if (cached) return cached

        // Only navigations get the offline page — returning HTML for a failed
        // data request would confuse the client rather than help it.
        if (request.mode === 'navigate') {
          const offline = await caches.match(OFFLINE_URL)
          if (offline) return offline
        }

        return new Response('Offline', {
          status: 503,
          statusText: 'Offline',
          headers: { 'Content-Type': 'text/plain' },
        })
      }),
  )
})
