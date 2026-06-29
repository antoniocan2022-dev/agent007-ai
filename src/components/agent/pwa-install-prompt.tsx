'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Download, X, Smartphone } from 'lucide-react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'agent007-pwa-install-dismissed'
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  // Don't show if already installed (standalone mode) — computed once at init
  const [show, setShow] = useState(() => {
    if (typeof window === 'undefined') return false
    return !window.matchMedia('(display-mode: standalone)').matches
  })

  useEffect(() => {
    // Only show if not previously dismissed (within TTL)
    let dismissed = false
    try {
      const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0)
      dismissed = !!dismissedAt && Date.now() - dismissedAt < DISMISS_TTL_MS
    } catch {}

    if (dismissed) return

    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      // Small delay so it doesn't feel intrusive
      setTimeout(() => setShow(true), 3000)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleInstall = async () => {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const choice = await deferredPrompt.userChoice
    if (choice.outcome === 'accepted') {
      setShow(false)
    }
    setDeferredPrompt(null)
  }

  const handleDismiss = () => {
    setShow(false)
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {}
  }

  return (
    <AnimatePresence>
      {show && deferredPrompt && (
        <motion.div
          initial={{ opacity: 0, y: 80 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 80 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-md"
        >
          <div
            className="glass-strong rounded-xl p-4 flex items-center gap-3"
            style={{
              borderColor: 'rgba(0,240,255,0.4)',
              boxShadow: '0 0 30px rgba(0,240,255,0.2)',
            }}
          >
            <div className="w-10 h-10 rounded-lg bg-cyan-400/10 border border-cyan-400/30 flex items-center justify-center flex-shrink-0">
              <Smartphone className="w-5 h-5 text-cyan-300" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-[#e0e7ff]">Install Agent007 AI</div>
              <div className="text-[11px] text-[#7c89b5]">
                Add to home screen for full-screen, offline access.
              </div>
            </div>
            <button
              onClick={handleInstall}
              className="neon-btn-cyan rounded-lg px-3 py-1.5 text-xs font-bold flex items-center gap-1 flex-shrink-0"
              style={{ touchAction: 'manipulation' }}
            >
              <Download className="w-3.5 h-3.5" />
              INSTALL
            </button>
            <button
              onClick={handleDismiss}
              className="text-[#5b6a92] hover:text-pink-300 flex-shrink-0 p-1"
              aria-label="Dismiss"
              style={{ touchAction: 'manipulation' }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
