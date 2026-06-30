'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  CalendarClock,
  Plus,
  Trash2,
  Play,
  Loader2,
  AlertCircle,
  CheckCircle2,
  X,
  Clock,
  ExternalLink,
  Power,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

/* ----------------------------- types ----------------------------- */
interface Schedule {
  id: string
  name: string
  prompt: string
  intervalMin: number
  enabled: boolean
  lastRunAt: string | null
  nextRunAt: string | null
  lastConvId: string | null
  createdAt: string
  updatedAt: string
}

/* ----------------------------- Schedules tab ----------------------------- */
export function SchedulesTab() {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [runningId, setRunningId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/schedules')
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setSchedules(json.schedules ?? [])
      setError('')
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load schedules')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    // Tick the scheduler every 60s so due schedules fire even without manual interaction
    const tick = () => {
      fetch('/api/schedules/tick', { method: 'POST' })
        .then(() => load())
        .catch(() => {/* ignore */})
    }
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, [load])

  const onRunNow = async (id: string) => {
    setRunningId(id)
    try {
      await fetch(`/api/schedules/tick?id=${id}`, { method: 'POST' })
      // Give the kick-off a moment then refresh
      setTimeout(() => {
        load()
        setRunningId(null)
      }, 1500)
    } catch (e) {
      console.error('run now failed', e)
      setRunningId(null)
    }
  }

  const onToggle = async (s: Schedule) => {
    try {
      await fetch(`/api/schedules/${s.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !s.enabled }),
      })
      await load()
    } catch {
      /* ignore */
    }
  }

  const onDelete = async (id: string) => {
    try {
      await fetch(`/api/schedules/${id}`, { method: 'DELETE' })
      await load()
    } catch {
      /* ignore */
    }
  }

  return (
    <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
      <div className="flex-1 overflow-y-auto scroll-cyan p-4 sm:p-6">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                <span className="neon-text-cyan">Scheduled</span>{' '}
                <span className="neon-text-purple">Runs</span>
              </h1>
              <p className="text-xs text-[#7c89b5] mt-1 tracking-wide">
                Autonomous mission scheduler — Agent007 runs on your schedule.
              </p>
            </div>
            <button
              onClick={() => setModalOpen(true)}
              className="h-9 px-4 rounded-lg neon-btn-cyan text-xs font-bold tracking-wider flex items-center gap-1.5"
              style={{ touchAction: 'manipulation' }}
            >
              <Plus className="w-3.5 h-3.5" />
              NEW SCHEDULE
            </button>
          </div>

          {/* Notice card */}
          <div className="glass rounded-xl p-3 mb-4 border-cyan-400/15 flex items-start gap-2 text-[11px] text-[#9bb5d4]">
            <Clock className="w-3.5 h-3.5 text-cyan-300 mt-0.5 flex-shrink-0" />
            <div>
              <strong className="text-[#e0e7ff]">Best-effort scheduler:</strong> Since Next.js dev
              mode has no long-running background workers, the scheduler ticks when this page is
              open. If you close the browser, schedules won&apos;t fire. Each schedule calls{' '}
              <code className="text-cyan-300">/api/schedules/tick</code> every 60s to wake it up.
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20 text-[#7c89b5]">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Loading schedules…
            </div>
          ) : error ? (
            <div className="glass rounded-xl p-4 border border-pink-400/40 text-pink-200 text-sm flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-semibold mb-1">Failed to load schedules</div>
                <div className="text-xs text-[#cfd9f0]">{error}</div>
              </div>
            </div>
          ) : schedules.length === 0 ? (
            <div className="glass rounded-xl p-8 text-center">
              <CalendarClock className="w-10 h-10 text-[#5b6a92] mx-auto mb-3" />
              <div className="text-base font-semibold text-[#e0e7ff] mb-1">No schedules yet</div>
              <p className="text-xs text-[#7c89b5] mb-4 max-w-md mx-auto">
                Create your first scheduled mission to let Agent007 run autonomously — e.g.
                &quot;Scan trends every 6 hours and pick the best passive-income opportunity.&quot;
              </p>
              <button
                onClick={() => setModalOpen(true)}
                className="h-9 px-4 rounded-lg neon-btn-cyan text-xs font-bold tracking-wider inline-flex items-center gap-1.5"
                style={{ touchAction: 'manipulation' }}
              >
                <Plus className="w-3.5 h-3.5" />
                CREATE SCHEDULE
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
              {schedules.map((s) => (
                <ScheduleCard
                  key={s.id}
                  schedule={s}
                  running={runningId === s.id}
                  onRunNow={() => onRunNow(s.id)}
                  onToggle={() => onToggle(s)}
                  onDelete={() => onDelete(s.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {modalOpen && (
          <CreateScheduleModal
            onClose={() => setModalOpen(false)}
            onCreated={() => {
              setModalOpen(false)
              load()
            }}
          />
        )}
      </AnimatePresence>
    </main>
  )
}

/* ----------------------------- Schedule card ----------------------------- */
function ScheduleCard({
  schedule,
  running,
  onRunNow,
  onToggle,
  onDelete,
}: {
  schedule: Schedule
  running: boolean
  onRunNow: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const nextRun = schedule.nextRunAt ? new Date(schedule.nextRunAt) : null
  const lastRun = schedule.lastRunAt ? new Date(schedule.lastRunAt) : null
  const countdown = useCountdown(nextRun)

  return (
    <div
      className={`glass rounded-xl p-4 transition ${
        schedule.enabled ? 'border-cyan-400/30' : 'border-[#2a2f44]/40 opacity-70'
      }`}
      style={{
        boxShadow: schedule.enabled ? '0 0 18px rgba(0,240,255,0.1)' : 'none',
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-[#e0e7ff] truncate">{schedule.name}</h3>
            <span
              className={`text-[9px] px-1.5 py-0.5 rounded-full tracking-wide border ${
                schedule.enabled
                  ? 'bg-emerald-400/10 border-emerald-400/40 text-emerald-200'
                  : 'bg-[#1a1f33] border-[#3a3f54] text-[#7c89b5]'
              }`}
            >
              {schedule.enabled ? 'ENABLED' : 'DISABLED'}
            </span>
          </div>
          <div className="text-[10px] text-[#5b6a92] mt-0.5 tracking-wide flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Every {formatInterval(schedule.intervalMin)}
          </div>
        </div>
        <button
          onClick={onToggle}
          className={`w-8 h-8 rounded-md flex items-center justify-center border transition flex-shrink-0 ${
            schedule.enabled
              ? 'bg-emerald-400/10 border-emerald-400/40 text-emerald-300'
              : 'glass border-[#3a3f54] text-[#7c89b5]'
          }`}
          aria-label={schedule.enabled ? 'Disable schedule' : 'Enable schedule'}
          title={schedule.enabled ? 'Disable' : 'Enable'}
          style={{ touchAction: 'manipulation' }}
        >
          <Power className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="glass rounded-md p-2 mb-3 bg-[#0a0e1a]/50">
        <div className="text-[9px] tracking-[0.2em] text-[#5b6a92] mb-1 font-semibold">PROMPT</div>
        <p className="text-[11px] text-[#cfd9f0] leading-snug line-clamp-3">{schedule.prompt}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3 text-[10px]">
        <div className="glass rounded-md p-2">
          <div className="text-[#5b6a92] tracking-wide mb-0.5">NEXT RUN</div>
          {schedule.enabled ? (
            countdown ? (
              <div className="text-cyan-300 font-semibold">{countdown}</div>
            ) : (
              <div className="text-[#7c89b5]">any moment…</div>
            )
          ) : (
            <div className="text-[#5b6a92]">—</div>
          )}
        </div>
        <div className="glass rounded-md p-2">
          <div className="text-[#5b6a92] tracking-wide mb-0.5">LAST RUN</div>
          {lastRun ? (
            <div className="text-purple-300 font-semibold">
              {lastRun.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </div>
          ) : (
            <div className="text-[#5b6a92]">never</div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onRunNow}
          disabled={!schedule.enabled || running}
          className="flex-1 h-8 rounded-lg neon-btn-cyan text-[11px] font-bold tracking-wider flex items-center justify-center gap-1.5 disabled:opacity-50"
          style={{ touchAction: 'manipulation' }}
        >
          {running ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              DISPATCHING…
            </>
          ) : (
            <>
              <Play className="w-3 h-3" />
              RUN NOW
            </>
          )}
        </button>
        {schedule.lastConvId && (
          <a
            href={`/api/conversations/${schedule.lastConvId}`}
            target="_blank"
            rel="noreferrer"
            className="h-8 px-3 rounded-lg glass border-cyan-400/30 hover:border-cyan-400/70 text-cyan-200 text-[11px] font-semibold tracking-wider flex items-center gap-1 transition"
            title="View last run conversation (raw JSON)"
            style={{ touchAction: 'manipulation' }}
          >
            <ExternalLink className="w-3 h-3" />
            <span className="hidden sm:inline">VIEW</span>
          </a>
        )}
        <button
          onClick={onDelete}
          className="h-8 w-8 rounded-lg glass border-pink-400/30 hover:border-pink-400/70 text-pink-300 flex items-center justify-center transition"
          aria-label="Delete schedule"
          style={{ touchAction: 'manipulation' }}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

/** Returns a human-readable countdown string for a future date, updated every 1s. */
function useCountdown(target: Date | null): string | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  if (!target) return null
  const diff = target.getTime() - now
  if (diff <= 0) return null
  const h = Math.floor(diff / 3600_000)
  const m = Math.floor((diff % 3600_000) / 60_000)
  const s = Math.floor((diff % 60_000) / 1000)
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatInterval(min: number): string {
  if (min < 60) return `${min} min`
  if (min === 60) return '1 hour'
  if (min < 1440) return `${Math.round(min / 60)} hours`
  if (min === 1440) return '1 day'
  return `${Math.round(min / 1440)} days`
}

/* ----------------------------- Create schedule modal ----------------------------- */
const INTERVAL_PRESETS = [
  { label: '1 hour', value: 60 },
  { label: '6 hours', value: 360 },
  { label: '12 hours', value: 720 },
  { label: '24 hours', value: 1440 },
  { label: '7 days', value: 1440 * 7 },
]

function CreateScheduleModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('Daily Income Mission')
  const [prompt, setPrompt] = useState(
    "Run today's passive income mission: scan trends, find 3 opportunities, pick the best, execute one step, monitor progress, and report."
  )
  const [intervalMin, setIntervalMin] = useState(1440)
  const [customInterval, setCustomInterval] = useState('')
  const [runNow, setRunNow] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    if (!name.trim() || !prompt.trim()) {
      setError('Name and prompt are required.')
      return
    }
    let interval = intervalMin
    if (customInterval.trim()) {
      const parsed = parseInt(customInterval, 10)
      if (!isFinite(parsed) || parsed <= 0) {
        setError('Custom interval must be a positive number of minutes.')
        return
      }
      interval = parsed
    }
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          prompt: prompt.trim(),
          intervalMin: interval,
          enabled: true,
          runNow,
        }),
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        setError(json.error ?? `HTTP ${res.status}`)
        setSubmitting(false)
        return
      }
      onCreated()
    } catch (e: any) {
      setError(e?.message ?? 'Network error')
      setSubmitting(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.96 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg glass-strong sm:rounded-2xl p-5 sm:p-6 min-h-screen sm:min-h-0 overflow-y-auto scroll-cyan"
        style={{ borderColor: 'rgba(0,240,255,0.35)', boxShadow: '0 0 40px rgba(0,240,255,0.15)' }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-cyan-300" />
            <h2 className="text-base font-bold text-[#e0e7ff]">New Schedule</h2>
          </div>
          <button
            onClick={onClose}
            className="sm:hidden text-[#7c89b5] hover:text-cyan-300 p-1"
            aria-label="Close"
            style={{ touchAction: 'manipulation' }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-[11px] text-[#7c89b5] mb-4">Configure an autonomous Agent007 mission.</p>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1 font-semibold">NAME</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              className="w-full glass rounded-lg px-3 py-2.5 text-sm text-[#e0e7ff] outline-none focus:border-cyan-400/70 transition"
              placeholder="Daily Income Mission"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1 font-semibold">PROMPT</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              maxLength={4000}
              className="w-full glass rounded-lg px-3 py-2.5 text-sm text-[#e0e7ff] outline-none focus:border-cyan-400/70 transition resize-none"
              required
            />
          </div>
          <div>
            <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1 font-semibold">INTERVAL</label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 mb-2">
              {INTERVAL_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => {
                    setIntervalMin(p.value)
                    setCustomInterval('')
                  }}
                  className={`px-2 py-1.5 rounded-md text-[10px] font-semibold tracking-wider transition border ${
                    intervalMin === p.value && !customInterval
                      ? 'neon-btn-cyan border-transparent'
                      : 'glass border-cyan-400/20 text-[#cfd9f0]'
                  }`}
                  style={{ touchAction: 'manipulation' }}
                >
                  {p.label.toUpperCase()}
                </button>
              ))}
            </div>
            <input
              type="number"
              min="1"
              value={customInterval}
              onChange={(e) => setCustomInterval(e.target.value)}
              className="w-full glass rounded-lg px-3 py-2 text-xs text-[#e0e7ff] outline-none focus:border-cyan-400/70 transition"
              placeholder="Custom: minutes (e.g. 90)"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={runNow}
              onChange={(e) => setRunNow(e.target.checked)}
              className="w-4 h-4 accent-cyan-400"
            />
            <span className="text-xs text-[#cfd9f0]">Run immediately after creating</span>
          </label>
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-pink-500/10 border border-pink-400/40 text-pink-200 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-3 py-2.5 rounded-lg text-xs font-semibold glass border-cyan-400/20 text-[#cfd9f0] hover:border-cyan-400/40 transition"
              style={{ touchAction: 'manipulation' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 neon-btn-cyan rounded-lg py-2.5 text-xs font-bold tracking-wider flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ touchAction: 'manipulation' }}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  CREATING…
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  CREATE
                </>
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}
