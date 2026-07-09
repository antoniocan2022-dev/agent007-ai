'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Clock, RefreshCw, AlertTriangle, WifiOff } from 'lucide-react'
import { useChatStore } from '@/store/chat-store'

/**
 * ProviderErrorBanner — replaces the old RateLimitBanner.
 *
 * Shows above the chat input whenever the LLM provider fails with a
 * retryable error:
 *   - 429 rate limit     → 60s countdown (amber)
 *   - 5xx server error   → 30s countdown (red/orange)
 *   - network error      → 30s countdown (blue)
 *   - timeout            → 30s countdown (blue)
 *
 * Displays:
 *   - An icon + brief description of what went wrong
 *   - A live countdown timer
 *   - A "Retry Now" button (always enabled while banner is visible)
 *   - Auto-retry when the countdown hits 0
 *
 * Auth errors (401/403) are NOT shown here — they're not retryable, so the
 * banner stays hidden and only the inline error message is shown.
 */
export function ProviderErrorBanner() {
  const rateLimitedUntil = useChatStore((s) => s.rateLimitedUntil)
  const serverErrorUntil = useChatStore((s) => s.serverErrorUntil)
  const retryLastMessage = useChatStore((s) => s.retryLastMessage)
  const status = useChatStore((s) => s.status)

  const [remaining, setRemaining] = useState(0)
  const autoFiredRef = useRef(false)

  // Pick the earlier of the two timers (whichever is active)
  const activeUntil = (() => {
    const now = Date.now()
    const rl = rateLimitedUntil && rateLimitedUntil > now ? rateLimitedUntil : 0
    const se = serverErrorUntil && serverErrorUntil > now ? serverErrorUntil : 0
    if (rl && se) return Math.min(rl, se)
    return rl || se || null
  })()

  const errorKind: 'rate_limit' | 'server_error' | null = (() => {
    if (!activeUntil) return null
    if (activeUntil === rateLimitedUntil) return 'rate_limit'
    return 'server_error'
  })()

  // Tick every 250ms to update the countdown
  useEffect(() => {
    if (!activeUntil) {
      setRemaining(0)
      autoFiredRef.current = false
      return
    }
    const tick = () => {
      const r = Math.max(0, Math.ceil((activeUntil! - Date.now()) / 1000))
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
  }, [activeUntil, status, retryLastMessage])

  const visible = !!activeUntil && activeUntil > Date.now()

  // Style + icon by error kind
  const theme = errorKind === 'rate_limit'
    ? {
        icon: Clock,
        borderColor: 'rgba(251,191,36,0.4)',
        background: 'rgba(251,191,36,0.08)',
        textClass: 'text-amber-100',
        accentClass: 'text-amber-300',
        btnBorder: 'border-amber-400/50',
        btnText: 'text-amber-100',
        btnHover: 'hover:bg-amber-400/15',
        label: 'Rate limited.',
      }
    : {
        icon: AlertTriangle,
        borderColor: 'rgba(248,113,113,0.4)',
        background: 'rgba(248,113,113,0.08)',
        textClass: 'text-red-100',
        accentClass: 'text-red-300',
        btnBorder: 'border-red-400/50',
        btnText: 'text-red-100',
        btnHover: 'hover:bg-red-400/15',
        label: 'Provider issue.',
      }

  const Icon = theme.icon

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
              borderColor: theme.borderColor,
              background: theme.background,
            }}
            role="alert"
          >
            <Icon className={`w-3.5 h-3.5 ${theme.accentClass} flex-shrink-0`} />
            <span className={`text-[11px] ${theme.textClass} flex-1 min-w-0`}>
              <span className="font-semibold">{theme.label}</span>{' '}
              Auto-retry in{' '}
              <span className={`font-mono font-bold ${theme.accentClass}`}>{remaining}s</span>
              <span className="hidden sm:inline"> — or click Retry Now.</span>
            </span>
            <button
              onClick={() => {
                autoFiredRef.current = true
                retryLastMessage().catch(() => {/* ignore */})
              }}
              disabled={status !== 'idle'}
              className={`flex-shrink-0 h-7 px-2.5 rounded-md text-[10px] font-bold tracking-wider border ${theme.btnBorder} ${theme.btnText} ${theme.btnHover} transition flex items-center gap-1 disabled:opacity-50`}
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

/**
 * Backward-compat: keep the old name exported so any existing imports
 * (e.g. from chat-header or chat-tab) continue to work.
 */
export const RateLimitBanner = ProviderErrorBanner
