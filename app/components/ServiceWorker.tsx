'use client'

/**
 * Registers the service worker.
 *
 * Registered in production only. In development the cache fights hot reload
 * and produces the single most confusing bug class in web development — edits
 * that appear not to apply because a worker is serving the previous version.
 */

import { useEffect } from 'react'

export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return

    // After load, so registration never competes with first paint.
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch((error) => {
        // Non-fatal: the app works fine without it. Log rather than surface —
        // a user cannot act on this.
        console.error('Service worker registration failed:', error)
      })
    }

    if (document.readyState === 'complete') register()
    else {
      window.addEventListener('load', register)
      return () => window.removeEventListener('load', register)
    }
  }, [])

  return null
}
