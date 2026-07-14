'use client'

import { useEffect } from 'react'

/**
 * UPGRADE #70 — UNREGISTER the service worker.
 *
 * Previously, this component REGISTERED a service worker (/sw.js) that cached
 * the app shell. This caused a multi-device sync issue: different devices
 * cached different versions of the app at different times, so they ran
 * different code.
 *
 * Now, this component UNREGISTERS any existing service worker on every load.
 * This ensures all devices always fetch the latest version from Vercel —
 * no stale cached versions.
 *
 * The owner requested: "I want only the version who is alive in Vercel."
 * Killing the service worker ensures that.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      // Unregister ALL service workers
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => {
          for (const reg of registrations) {
            reg.unregister()
              .then(() => console.log('[PWA] Service Worker UNREGISTERED (UPGRADE #70) — all devices now fetch latest from Vercel'))
              .catch((err) => console.warn('[PWA] Service Worker unregister failed:', err))
          }
          // Also clear all caches
          if ('caches' in window) {
            caches.keys().then((names) => {
              for (const name of names) {
                caches.delete(name)
              }
            })
          }
        })
        .catch((err) => console.warn('[PWA] getRegistrations failed:', err))
    }
  }, [])

  return null
}
