'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

type HealthStatus = 'ok' | 'rate_limited' | 'unknown'

interface HealthResponse {
  status: 'ok' | 'rate_limited'
  last429At: number | null
  cooldownMs: number
  retryingNow?: boolean
}

/**
 * Polls /api/health/llm every 30s and renders a small status dot/pill.
 *
 * Colors:
 *   - green  → ok (no recent 429)
 *   - amber  → rate_limited (cooldown active)
 *   - gray   → unknown (fetch failed / never fetched)
 *
 * Tooltip explains the current state.
 *
 * Pass `compact` to render just the colored dot (used in narrow layouts).
 */
export function ApiStatusIndicator({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<HealthStatus>('unknown')
  const [cooldownMs, setCooldownMs] = useState(0)
  const [retrying, setRetrying] = useState(false)
  const [tooltip, setTooltip] = useState('API status unknown')

  useEffect(() => {
    let cancelled = false

    const check = async () => {
      try {
        const res = await fetch('/api/health/llm', { cache: 'no-store' })
        if (!res.ok) {
          if (!cancelled) {
            setStatus('unknown')
            setTooltip('API status unknown')
          }
          return
        }
        const data: HealthResponse = await res.json()
        if (cancelled) return
        const cd = Math.ceil((data.cooldownMs ?? 0) / 1000)
        setCooldownMs(cd)
        setRetrying(!!data.retryingNow)
        if (data.status === 'rate_limited') {
          setStatus('rate_limited')
          setTooltip(
            `Rate limited — cooldown ${cd}s${data.retryingNow ? ' (retrying…)' : ''}`
          )
        } else {
          setStatus('ok')
          setTooltip('API OK')
        }
      } catch {
        if (!cancelled) {
          setStatus('unknown')
          setTooltip('API status unknown')
        }
      }
    }

    check()
    const id = setInterval(check, 30_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const dotColor =
    status === 'ok'
      ? 'bg-emerald-400'
      : status === 'rate_limited'
      ? 'bg-amber-400'
      : 'bg-[#5b6a92]'
  const ringColor =
    status === 'ok'
      ? 'shadow-[0_0_6px_rgba(52,211,153,0.7)]'
      : status === 'rate_limited'
      ? 'shadow-[0_0_6px_rgba(251,191,36,0.7)]'
      : 'shadow-none'

  if (compact) {
    return (
      <span
        className="inline-flex items-center justify-center w-7 h-7"
        title={tooltip}
        aria-label={tooltip}
        role="status"
      >
        <motion.span
          className={`block w-2.5 h-2.5 rounded-full ${dotColor} ${ringColor}`}
          animate={
            status === 'rate_limited'
              ? { opacity: [1, 0.4, 1] }
              : { opacity: 1 }
          }
          transition={
            status === 'rate_limited'
              ? { duration: 1.2, repeat: Infinity, ease: 'easeInOut' }
              : { duration: 0 }
          }
        />
      </span>
    )
  }

  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={tooltip}
      aria-label={tooltip}
      role="status"
    >
      <motion.span
        className={`block w-2 h-2 rounded-full ${dotColor} ${ringColor}`}
        animate={
          status === 'rate_limited'
            ? { opacity: [1, 0.4, 1] }
            : { opacity: 1 }
        }
        transition={
          status === 'rate_limited'
            ? { duration: 1.2, repeat: Infinity, ease: 'easeInOut' }
            : { duration: 0 }
        }
      />
      <span className="text-[9px] tracking-wider text-[#7c89b5] hidden 2xl:inline">
        {status === 'ok'
          ? 'API OK'
          : status === 'rate_limited'
          ? retrying
            ? `RETRYING ${cooldownMs}s`
            : `RATE-LIMITED ${cooldownMs}s`
          : 'API ?'}
      </span>
    </span>
  )
}
