// Agent007 AI Service Worker — offline shell + cache-first for static assets
const CACHE_VERSION = 'agent007-v2-0'
const STATIC_CACHE = `${CACHE_VERSION}-static`
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`

// Assets to pre-cache on install (the app shell)
const APP_SHELL = [
  '/',
  '/login',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      // Cache app shell — ignore failures on individual assets
      return Promise.allSettled(
        APP_SHELL.map((url) =>
          fetch(url)
            .then((res) => res.ok ? cache.put(url, res.clone()) : null)
            .catch(() => null)
        )
      )
    })
  )
  // Activate immediately
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('agent007-') && name !== STATIC_CACHE && name !== RUNTIME_CACHE)
          .map((name) => caches.delete(name))
      )
    })
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Skip non-GET requests (POST/PUT/DELETE always go to network)
  if (request.method !== 'GET') return

  // Skip cross-origin requests (z-ai API, external URLs)
  if (url.origin !== self.location.origin) return

  // Skip Next.js HMR + dev-only paths
  if (url.pathname.startsWith('/_next/webpack-hmr')) return
  if (url.pathname.includes('__nextjs')) return

  // Skip API requests (always fresh — agent state, conversations, etc.)
  if (url.pathname.startsWith('/api/')) {
    // Network-first for API
    event.respondWith(
      fetch(request)
        .then((res) => {
          // Cache successful GET responses for 60s
          if (res.ok && request.method === 'GET') {
            const clone = res.clone()
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone)).catch(() => {})
          }
          return res
        })
        .catch(() => {
          // Fallback to cache if network fails
          return caches.match(request).then((cached) => cached || new Response('Offline', { status: 503 }))
        })
    )
    return
  }

  // For navigation requests: network-first, fall back to cached shell
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          // Cache the latest page
          const clone = res.clone()
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone)).catch(() => {})
          return res
        })
        .catch(() => {
          // Offline — serve cached app shell
          return caches.match('/').then((cached) => cached || caches.match(request).then((c) => c))
        })
    )
    return
  }

  // For static assets (_next/static, images, fonts): cache-first
  if (url.pathname.startsWith('/_next/static/') || url.pathname.match(/\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot)$/i)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached
        return fetch(request).then((res) => {
          if (res.ok) {
            const clone = res.clone()
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone)).catch(() => {})
          }
          return res
        })
      })
    )
    return
  }

  // Default: stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request).then((res) => {
        if (res.ok) {
          const clone = res.clone()
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone)).catch(() => {})
        }
        return res
      }).catch(() => cached)
      return cached || fetchPromise
    })
  )
})

// Listen for messages from the page (e.g. "SKIP_WAITING" from update prompt)
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})
