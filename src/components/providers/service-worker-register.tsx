'use client'

import { useEffect } from 'react'

/**
 * Registers the PWA service worker on the client side only.
 * Extracted into a separate client component to avoid hydration issues
 * caused by inline <script> tags in the server-rendered layout.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => console.log('[PWA] Service Worker registered:', reg.scope))
        .catch((err) => console.warn('[PWA] Service Worker registration failed:', err))
    }
  }, [])

  return null
}
