'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Clock, RefreshCw } from 'lucide-react'
import { useChatStore } from '@/store/chat-store'

/**
 * Rate-limit banner (#6).
 *
 * Shown above the chat input whenever `rateLimitedUntil > Date.now()`.
 * Displays a live countdown + a "Retry Now" button. When the countdown
 * hits 0, auto-calls `retryLastMessage()`.
 *
 * Mounts as a sibling of <ChatInput /> in the chat tab so it sits right
 * above the input field.
 */
export function RateLimitBanner() {
  const rateLimitedUntil = useChatStore((s) => s.rateLimitedUntil)
  const retryLastMessage = useChatStore((s) => s.retryLastMessage)
  const status = useChatStore((s) => s.status)

  const [remaining, setRemaining] = useState(0)
  const autoFiredRef = useRef(false)

  // Tick every 250ms to update the countdown
  useEffect(() => {
    if (!rateLimitedUntil) {
      setRemaining(0)
      autoFiredRef.current = false
      return
    }
    const tick = () => {
      const r = Math.max(0, Math.ceil((rateLimitedUntil - Date.now()) / 1000))
      setRemaining(r)
      if (r === 0 && !autoFiredRef.current && status === 'idle') {
        autoFiredRef.current = true
        // Auto-retry when countdown expires
        retryLastMessage().catch(() => {/* ignore */})
      }
    }
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [rateLimitedUntil, status, retryLastMessage])

  const visible = !!rateLimitedUntil && rateLimitedUntil > Date.now()

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          transition={{ duration: 0.2 }}
          className="max-w-[820px] mx-auto px-1 mb-2"
        >
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg glass-strong border"
            style={{
              borderColor: 'rgba(251,191,36,0.4)',
              background: 'rgba(251,191,36,0.08)',
            }}
            role="alert"
          >
            <Clock className="w-3.5 h-3.5 text-amber-300 flex-shrink-0" />
            <span className="text-[11px] text-amber-100 flex-1 min-w-0">
              <span className="font-semibold">Rate limited.</span>{' '}
              Auto-retry in{' '}
              <span className="font-mono font-bold text-amber-200">{remaining}s</span>
              <span className="hidden sm:inline"> — or click Retry Now.</span>
            </span>
            <button
              onClick={() => {
                autoFiredRef.current = true
                retryLastMessage().catch(() => {/* ignore */})
              }}
              disabled={status !== 'idle'}
              className="flex-shrink-0 h-7 px-2.5 rounded-md text-[10px] font-bold tracking-wider border border-amber-400/50 text-amber-100 hover:bg-amber-400/15 transition flex items-center gap-1 disabled:opacity-50"
              style={{ touchAction: 'manipulation' }}
              title="Retry the last message now"
            >
              <RefreshCw className="w-3 h-3" />
              RETRY NOW
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
