'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Users, Crown } from 'lucide-react'

/**
 * ActiveUsersIndicator — shows the count of currently-active users in real time.
 *
 * Polls /api/active-users every 15s. Renders a small pill in the chat header:
 *   👥 3 ONLINE
 *
 * On hover/click, expands a tooltip/popover with the user list:
 *   - Each user's name + email
 *   - "Xs ago" since last activity
 *   - Crown icon for the current user
 *
 * The dot pulses green when there are 2+ users online (multi-user session),
 * solid green when 1 user, gray when 0.
 */

interface ActiveUser {
  userId: string
  email: string
  name: string
  lastSeenAt: number
  page: string
  secondsAgo: number
}

export function ActiveUsersIndicator() {
  const [count, setCount] = useState(0)
  const [users, setUsers] = useState<ActiveUser[]>([])
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false

    const poll = async () => {
      try {
        const res = await fetch('/api/active-users', { cache: 'no-store' })
        if (!res.ok) {
          if (!cancelled) setError(true)
          return
        }
        const data = await res.json()
        if (cancelled) return
        setCount(data.count ?? 0)
        setUsers(data.users ?? [])
        setError(false)
      } catch {
        if (!cancelled) setError(true)
      }
    }

    poll()
    const id = setInterval(poll, 15_000) // 15s poll
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  // Color the dot based on count
  const dotColor =
    count >= 2 ? 'bg-emerald-400' : count === 1 ? 'bg-emerald-400' : 'bg-[#5b6a92]'
  const ringColor =
    count >= 1 ? 'shadow-[0_0_6px_rgba(52,211,153,0.7)]' : 'shadow-none'

  return (
    <div
      className="relative"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 h-9 px-2.5 rounded-lg glass border-cyan-400/30 hover:border-cyan-400/70 text-cyan-200 transition"
        title={`${count} user${count === 1 ? '' : 's'} online now`}
        aria-label={`${count} active users`}
        style={{ touchAction: 'manipulation' }}
      >
        <motion.span
          className={`block w-2 h-2 rounded-full ${dotColor} ${ringColor}`}
          animate={count >= 1 ? { opacity: [1, 0.5, 1] } : { opacity: 1 }}
          transition={count >= 1 ? { duration: 1.8, repeat: Infinity, ease: 'easeInOut' } : { duration: 0 }}
        />
        <Users className="w-3.5 h-3.5 text-cyan-300" />
        <span className="text-[10px] font-bold tracking-wider">
          {count} <span className="hidden sm:inline">ONLINE</span>
        </span>
      </button>

      <AnimatePresence>
        {expanded && users.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            role="tooltip"
            className="absolute right-0 top-full mt-2 w-64 glass-strong rounded-xl p-2 z-40 max-h-80 overflow-y-auto"
            style={{ borderColor: 'rgba(0,240,255,0.3)' }}
          >
            <div className="px-3 py-2 border-b border-cyan-400/15 mb-1 flex items-center justify-between">
              <span className="text-[10px] font-bold tracking-wider text-cyan-200">
                {count} ACTIVE USER{count === 1 ? '' : 'S'}
              </span>
              <span className="text-[9px] text-[#5b6a92]">last 5 min</span>
            </div>
            <ul className="space-y-0.5">
              {users.map((u) => (
                <li
                  key={u.userId}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-cyan-400/5"
                >
                  <span className="w-6 h-6 rounded-full bg-cyan-400/15 border border-cyan-400/40 text-cyan-200 text-[9px] font-bold flex items-center justify-center flex-shrink-0">
                    {(u.name || u.email || '?').slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-semibold text-[#e0e7ff] truncate flex items-center gap-1">
                      {u.name || u.email}
                      {u.secondsAgo < 30 && (
                        <Crown className="w-2.5 h-2.5 text-amber-300 flex-shrink-0" />
                      )}
                    </div>
                    <div className="text-[9px] text-[#7c89b5] truncate">
                      {u.email} • {u.secondsAgo}s ago
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-1 pt-2 border-t border-cyan-400/10 px-3 text-[9px] text-[#5b6a92]">
              Updates every 15s • window: 5 min
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <span className="sr-only" role="alert">
          Active-users indicator failed to load.
        </span>
      )}
    </div>
  )
}
