'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Settings as SettingsIcon,
  User as UserIcon,
  Bell,
  Target,
  Mail,
  Loader2,
  AlertCircle,
  CheckCircle2,
  KeyRound,
  ExternalLink,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useSession } from 'next-auth/react'

/* ----------------------------- types ----------------------------- */
interface IncomeSettings {
  monthlyGoal: number
  dailyGrowthTarget: number
  currencySymbol: string
  displayMode: 'compact' | 'detailed'
}
interface NotificationSettings {
  enabled: boolean
  email: string
  events: {
    mission_complete: boolean
    mission_failed: boolean
    income_logged: boolean
    daily_summary: boolean
    weekly_summary: boolean
  }
  minDelayMinutes: number
}
interface NotificationLog {
  id: string
  type: string
  to: string
  subject: string
  body: string
  sent: boolean
  createdAt: string
}

const DEFAULT_INCOME: IncomeSettings = {
  monthlyGoal: 1000,
  dailyGrowthTarget: 10,
  currencySymbol: '$',
  displayMode: 'detailed',
}
const DEFAULT_NOTIF: NotificationSettings = {
  enabled: false,
  email: 'antonio.can2022@hotmail.com',
  events: {
    mission_complete: true,
    mission_failed: true,
    income_logged: false,
    daily_summary: true,
    weekly_summary: false,
  },
  minDelayMinutes: 5,
}

/* ----------------------------- Settings tab ----------------------------- */
export function SettingsTab({ onOpenChangePassword }: { onOpenChangePassword: () => void }) {
  const { data: session } = useSession()
  const [income, setIncome] = useState<IncomeSettings>(DEFAULT_INCOME)
  const [notif, setNotif] = useState<NotificationSettings>(DEFAULT_NOTIF)
  const [logs, setLogs] = useState<NotificationLog[]>([])
  const [loading, setLoading] = useState(true)
  const [savingIncome, setSavingIncome] = useState(false)
  const [savingNotif, setSavingNotif] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([
        fetch('/api/settings').then((r) => r.json()),
        fetch('/api/notifications/log').then((r) => r.json()),
      ])
      if (s.income) setIncome(s.income)
      if (s.notifications) setNotif(s.notifications)
      if (l.logs) setLogs(l.logs)
      setError('')
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const saveIncome = async (e: React.FormEvent) => {
    e.preventDefault()
    if (savingIncome) return
    setSavingIncome(true)
    setError('')
    setSavedMsg('')
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ income }),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`)
      if (json.income) setIncome(json.income)
      setSavedMsg('Income settings saved.')
      setTimeout(() => setSavedMsg(''), 2500)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save income settings')
    } finally {
      setSavingIncome(false)
    }
  }

  const saveNotif = async (e: React.FormEvent) => {
    e.preventDefault()
    if (savingNotif) return
    setSavingNotif(true)
    setError('')
    setSavedMsg('')
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifications: notif }),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`)
      if (json.notifications) setNotif(json.notifications)
      setSavedMsg('Notification settings saved.')
      setTimeout(() => setSavedMsg(''), 2500)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save notification settings')
    } finally {
      setSavingNotif(false)
    }
  }

  const smtpConfigured = process.env.NEXT_PUBLIC_SMTP_CONFIGURED === '1'

  if (loading) {
    return (
      <main className="flex-1 flex flex-col items-center justify-center text-[#7c89b5]">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading settings…
      </main>
    )
  }

  return (
    <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
      <div className="flex-1 overflow-y-auto scroll-cyan p-4 sm:p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          {/* Header */}
          <div className="mb-2">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              <span className="neon-text-cyan">Settings</span>
            </h1>
            <p className="text-xs text-[#7c89b5] mt-1 tracking-wide">
              Profile, password, notifications, and income goals — all in one place.
            </p>
          </div>

          {/* Profile */}
          <section className="glass rounded-xl p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-3">
              <UserIcon className="w-4 h-4 text-cyan-300" />
              <h2 className="text-sm font-semibold text-[#e0e7ff] tracking-wide">PROFILE</h2>
            </div>
            <div className="flex items-center gap-4 mb-3">
              <div className="w-12 h-12 rounded-full bg-cyan-400/15 border border-cyan-400/40 text-cyan-200 text-base font-bold flex items-center justify-center">
                {(session?.user?.name ?? session?.user?.email ?? 'OP').slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-[#e0e7ff] truncate">
                  {session?.user?.name ?? 'Agent007 Operator'}
                </div>
                <div className="text-xs text-[#7c89b5] truncate">{session?.user?.email}</div>
              </div>
            </div>
            <button
              onClick={onOpenChangePassword}
              className="h-9 px-4 rounded-lg glass border-cyan-400/30 hover:border-cyan-400/70 text-cyan-200 text-xs font-semibold tracking-wider flex items-center gap-1.5 transition"
              style={{ touchAction: 'manipulation' }}
            >
              <KeyRound className="w-3.5 h-3.5" />
              CHANGE PASSWORD
            </button>
          </section>

          {/* Income settings */}
          <section className="glass rounded-xl p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-3">
              <Target className="w-4 h-4 text-pink-300" />
              <h2 className="text-sm font-semibold text-[#e0e7ff] tracking-wide">INCOME GOALS</h2>
            </div>
            <form onSubmit={saveIncome} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1 font-semibold">MONTHLY GOAL ($)</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={income.monthlyGoal}
                  onChange={(e) => setIncome({ ...income, monthlyGoal: parseFloat(e.target.value) || 0 })}
                  className="w-full glass rounded-lg px-3 py-2.5 text-sm text-[#e0e7ff] outline-none focus:border-cyan-400/70 transition"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1 font-semibold">DAILY GROWTH TARGET (%)</label>
                <input
                  type="number"
                  step="0.1"
                  value={income.dailyGrowthTarget}
                  onChange={(e) => setIncome({ ...income, dailyGrowthTarget: parseFloat(e.target.value) || 0 })}
                  className="w-full glass rounded-lg px-3 py-2.5 text-sm text-[#e0e7ff] outline-none focus:border-cyan-400/70 transition"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1 font-semibold">CURRENCY SYMBOL</label>
                <input
                  type="text"
                  maxLength={4}
                  value={income.currencySymbol}
                  onChange={(e) => setIncome({ ...income, currencySymbol: e.target.value })}
                  className="w-full glass rounded-lg px-3 py-2.5 text-sm text-[#e0e7ff] outline-none focus:border-cyan-400/70 transition"
                  placeholder="$"
                />
              </div>
              <div>
                <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1 font-semibold">DISPLAY MODE</label>
                <div className="flex gap-2">
                  {(['detailed', 'compact'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setIncome({ ...income, displayMode: m })}
                      className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold tracking-wider transition border ${
                        income.displayMode === m
                          ? 'neon-btn-cyan border-transparent'
                          : 'glass border-cyan-400/20 text-[#cfd9f0]'
                      }`}
                      style={{ touchAction: 'manipulation' }}
                    >
                      {m.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div className="sm:col-span-2 flex justify-end">
                <button
                  type="submit"
                  disabled={savingIncome}
                  className="h-9 px-5 rounded-lg neon-btn-cyan text-xs font-bold tracking-wider flex items-center gap-2 disabled:opacity-60"
                  style={{ touchAction: 'manipulation' }}
                >
                  {savingIncome ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      SAVING…
                    </>
                  ) : (
                    'SAVE INCOME GOALS'
                  )}
                </button>
              </div>
            </form>
          </section>

          {/* Notification settings */}
          <section className="glass rounded-xl p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-purple-300" />
                <h2 className="text-sm font-semibold text-[#e0e7ff] tracking-wide">EMAIL NOTIFICATIONS</h2>
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <span className="text-[10px] text-[#7c89b5] tracking-wider">ENABLED</span>
                <input
                  type="checkbox"
                  checked={notif.enabled}
                  onChange={(e) => setNotif({ ...notif, enabled: e.target.checked })}
                  className="w-4 h-4 accent-cyan-400"
                />
              </label>
            </div>

            {!smtpConfigured && (
              <div className="flex items-start gap-2 mb-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-400/40 text-amber-200 text-[11px]">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <div>
                  <strong>SMTP not configured.</strong> Notifications will be logged to the
                  NotificationLog table (visible below) and printed to the server console instead of
                  being sent. Set <code>SMTP_HOST</code>, <code>SMTP_PORT</code>, <code>SMTP_USER</code>,{' '}
                  <code>SMTP_PASS</code>, and <code>SMTP_FROM</code> env vars to enable real email delivery.
                </div>
              </div>
            )}

            <form onSubmit={saveNotif} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1 font-semibold">NOTIFICATION EMAIL</label>
                  <input
                    type="email"
                    value={notif.email}
                    onChange={(e) => setNotif({ ...notif, email: e.target.value })}
                    className="w-full glass rounded-lg px-3 py-2.5 text-sm text-[#e0e7ff] outline-none focus:border-cyan-400/70 transition"
                    placeholder="antonio.can2022@hotmail.com"
                  />
                </div>
                <div>
                  <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1 font-semibold">MIN DELAY BETWEEN EMAILS (min)</label>
                  <input
                    type="number"
                    min="0"
                    value={notif.minDelayMinutes}
                    onChange={(e) => setNotif({ ...notif, minDelayMinutes: parseInt(e.target.value) || 0 })}
                    className="w-full glass rounded-lg px-3 py-2.5 text-sm text-[#e0e7ff] outline-none focus:border-cyan-400/70 transition"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-2 font-semibold">EVENTS THAT TRIGGER EMAILS</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {([
                    ['mission_complete', 'Mission Complete'],
                    ['mission_failed', 'Mission Failed'],
                    ['income_logged', 'Income Logged'],
                    ['daily_summary', 'Daily Summary'],
                    ['weekly_summary', 'Weekly Summary'],
                  ] as const).map(([key, label]) => (
                    <label
                      key={key}
                      className="flex items-center gap-2 cursor-pointer select-none px-3 py-2 rounded-lg glass border-cyan-400/15 hover:border-cyan-400/40 transition"
                    >
                      <input
                        type="checkbox"
                        checked={notif.events[key]}
                        onChange={(e) =>
                          setNotif({
                            ...notif,
                            events: { ...notif.events, [key]: e.target.checked },
                          })
                        }
                        className="w-4 h-4 accent-cyan-400"
                      />
                      <span className="text-xs text-[#cfd9f0]">{label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={savingNotif}
                  className="h-9 px-5 rounded-lg neon-btn-cyan text-xs font-bold tracking-wider flex items-center gap-2 disabled:opacity-60"
                  style={{ touchAction: 'manipulation' }}
                >
                  {savingNotif ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      SAVING…
                    </>
                  ) : (
                    'SAVE NOTIFICATIONS'
                  )}
                </button>
              </div>
            </form>
          </section>

          {/* Notification log */}
          <section className="glass rounded-xl p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-cyan-300" />
                <h2 className="text-sm font-semibold text-[#e0e7ff] tracking-wide">NOTIFICATION LOG</h2>
              </div>
              <span className="text-[10px] text-[#5b6a92] tracking-wider">{logs.length} entries</span>
            </div>
            {logs.length === 0 ? (
              <div className="text-center py-6 text-[#5b6a92] text-xs">
                No notifications yet. Trigger a mission or run a schedule to generate log entries.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-72 overflow-y-auto scroll-cyan pr-1">
                {logs.map((l) => (
                  <div key={l.id} className="glass rounded-md p-2 border-cyan-400/15">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded-full tracking-wide border flex-shrink-0 ${
                          l.sent
                            ? 'bg-emerald-400/10 border-emerald-400/40 text-emerald-200'
                            : 'bg-amber-400/10 border-amber-400/40 text-amber-200'
                        }`}
                      >
                        {l.sent ? 'SENT' : 'LOGGED'}
                      </span>
                      <span className="text-[10px] text-cyan-200 font-semibold truncate flex-1">
                        {l.subject}
                      </span>
                      <span className="text-[9px] text-[#5b6a92] tracking-wide flex-shrink-0">
                        {new Date(l.createdAt).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <div className="text-[10px] text-[#7c89b5] truncate">
                      → {l.to} • {l.type}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Footer */}
          <div className="text-center text-[10px] text-[#5b6a92] tracking-wide pt-2 pb-4">
            Agent007 AI v2.0 • powered by Z.ai SDK • 10 sub-agents • full web access
          </div>
        </div>
      </div>

      {/* Saved toast */}
      <AnimatePresence>
        {savedMsg && (
          <motion.div
            initial={{ opacity: 0, y: 20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 20, x: '-50%' }}
            className="fixed left-1/2 bottom-6 z-40 px-4 py-2 rounded-lg glass-strong border border-emerald-400/40 text-emerald-200 text-xs flex items-center gap-2"
            style={{ boxShadow: '0 0 18px rgba(16,185,129,0.3)' }}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            {savedMsg}
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  )
}
