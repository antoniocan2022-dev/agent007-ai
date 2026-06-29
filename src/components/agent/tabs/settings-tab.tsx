'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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
  BarChart3,
  Download,
  Upload,
  Database,
  Activity,
  TrendingUp,
  Clock,
  FileText,
  Trash2,
  Search,
  CreditCard,
  BookMarked,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useSession } from 'next-auth/react'
import { SubAgentsPanel } from './subagents-panel'

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

          {/* Sub-Agents management */}
          <SubAgentsPanel />

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

          {/* AGENT ANALYTICS */}
          <AgentAnalyticsSection />

          {/* KNOWLEDGE BASE (RAG) */}
          <KnowledgeBaseSection onToast={setSavedMsg} />

          {/* PAYMENT INTEGRATIONS */}
          <PaymentIntegrationsSection />

          {/* BACKUP / RESTORE */}
          <BackupRestoreSection onToast={setSavedMsg} />

          {/* Footer */}
          <div className="text-center text-[10px] text-[#5b6a92] tracking-wide pt-2 pb-4">
            Agent007 AI v2.0 • powered by Z.ai SDK • 17 sub-agents • multi-user • PWA • voice • RAG • Stripe/PayPal
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

/* ------------------------------------------------------------------ *
 * Agent Analytics Section — shows per-agent usage stats
 * ------------------------------------------------------------------ */
function AgentAnalyticsSection() {
  const [analytics, setAnalytics] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/analytics/agents')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setAnalytics(data)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section className="glass rounded-xl p-4 border-cyan-400/15">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="w-4 h-4 text-cyan-300" />
        <h2 className="text-sm font-semibold text-[#e0e7ff] tracking-wide">AGENT ANALYTICS</h2>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-4 h-4 animate-spin text-cyan-300" />
        </div>
      ) : !analytics || !analytics.agents || analytics.agents.length === 0 ? (
        <div className="text-center py-6 text-[#5b6a92] text-xs">
          No agent activity yet. Dispatch some sub-agents to see analytics here.
        </div>
      ) : (
        <>
          {/* Global stats */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="glass rounded-lg p-2 text-center">
              <div className="text-[9px] label-tag">DISPATCHES</div>
              <div className="text-lg font-bold text-cyan-200">{analytics.global.totalDispatches}</div>
            </div>
            <div className="glass rounded-lg p-2 text-center">
              <div className="text-[9px] label-tag">TOOL CALLS</div>
              <div className="text-lg font-bold text-purple-200">{analytics.global.totalToolCalls}</div>
            </div>
            <div className="glass rounded-lg p-2 text-center">
              <div className="text-[9px] label-tag">AGENTS USED</div>
              <div className="text-lg font-bold text-emerald-200">{analytics.global.totalAgentsUsed}</div>
            </div>
          </div>

          {analytics.global.mostUsed && (
            <div className="text-[10px] text-[#7c89b5] mb-3 flex items-center gap-1">
              <TrendingUp className="w-3 h-3 text-emerald-300" />
              Most used: <strong className="text-[#e0e7ff]">{analytics.global.mostUsed.name}</strong> ({analytics.global.mostUsed.dispatchCount}x)
            </div>
          )}

          {/* Per-agent table */}
          <div className="space-y-1 max-h-64 overflow-y-auto scroll-cyan pr-1">
            {analytics.agents.slice(0, 12).map((a: any) => (
              <div key={a.id} className="glass rounded-md p-2 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold text-[#e0e7ff] truncate">{a.name}</div>
                  <div className="text-[9px] text-[#5b6a92] flex items-center gap-2">
                    <span>{a.dispatchCount} dispatches</span>
                    <span>•</span>
                    <span>{a.toolCallCount} tools</span>
                    {a.lastUsedAt && (
                      <>
                        <span>•</span>
                        <span className="flex items-center gap-0.5">
                          <Clock className="w-2.5 h-2.5" />
                          {new Date(a.lastUsedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <div className="w-12 h-1.5 rounded-full bg-black/40 overflow-hidden">
                    <div
                      className="h-full bg-cyan-400"
                      style={{
                        width: `${Math.min(100, a.successRate)}%`,
                      }}
                    />
                  </div>
                  <span className="text-[9px] text-[#9bb5d4] w-8 text-right">{a.successRate}%</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ *
 * Backup / Restore Section — export + import all dashboard data
 * ------------------------------------------------------------------ */
function BackupRestoreSection({ onToast }: { onToast: (msg: string) => void }) {
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<any>(null)

  const handleExport = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const res = await fetch('/api/backup')
      if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `agent007-backup-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      onToast('Backup downloaded successfully')
    } catch (e: any) {
      onToast(`Export failed: ${e?.message ?? 'unknown error'}`)
    } finally {
      setExporting(false)
    }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || importing) return
    setImporting(true)
    setImportResult(null)
    try {
      const text = await file.text()
      const backup = JSON.parse(text)
      const res = await fetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backup }),
      })
      const result = await res.json()
      if (!res.ok || !result.ok) throw new Error(result.error || `HTTP ${res.status}`)
      setImportResult(result.stats)
      onToast(
        `Restored: ${result.stats.conversations} conversations, ${result.stats.messages} messages, ${result.stats.customSubagents} agents`
      )
    } catch (e: any) {
      onToast(`Import failed: ${e?.message ?? 'invalid file'}`)
    } finally {
      setImporting(false)
      if (e.target) e.target.value = ''
    }
  }

  return (
    <section className="glass rounded-xl p-4 border-cyan-400/15">
      <div className="flex items-center gap-2 mb-3">
        <Database className="w-4 h-4 text-cyan-300" />
        <h2 className="text-sm font-semibold text-[#e0e7ff] tracking-wide">BACKUP & RESTORE</h2>
      </div>
      <p className="text-[11px] text-[#7c89b5] mb-3 leading-relaxed">
        Export all dashboard data (conversations, memories, income entries, schedules, custom
        sub-agents, settings) as a JSON file. Restore on any Agent007 instance.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <button
          onClick={handleExport}
          disabled={exporting}
          className="flex-1 neon-btn-cyan rounded-lg py-2 text-xs font-bold tracking-wider flex items-center justify-center gap-2 disabled:opacity-60"
          style={{ touchAction: 'manipulation' }}
        >
          {exporting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Download className="w-3.5 h-3.5" />
          )}
          {exporting ? 'EXPORTING…' : 'EXPORT BACKUP'}
        </button>
        <label
          className="flex-1 glass border-cyan-400/30 hover:border-cyan-400/60 rounded-lg py-2 text-xs font-bold tracking-wider flex items-center justify-center gap-2 cursor-pointer transition text-cyan-200"
          style={{ touchAction: 'manipulation' }}
        >
          {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          {importing ? 'RESTORING…' : 'RESTORE BACKUP'}
          <input
            type="file"
            accept="application/json,.json"
            onChange={handleImport}
            disabled={importing}
            className="hidden"
          />
        </label>
      </div>
      {importResult && (
        <div className="mt-3 text-[10px] text-[#9bb5d4] glass rounded-lg p-2 border-emerald-400/20">
          <div className="flex items-center gap-1 mb-1 text-emerald-200 font-semibold">
            <CheckCircle2 className="w-3 h-3" />
            Last restore result:
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <span>Conversations: {importResult.conversations}</span>
            <span>Messages: {importResult.messages}</span>
            <span>Memories: {importResult.memories}</span>
            <span>Income: {importResult.incomeEntries}</span>
            <span>Schedules: {importResult.schedules}</span>
            <span>Custom agents: {importResult.customSubagents}</span>
          </div>
          {importResult.errors?.length > 0 && (
            <div className="mt-1 text-amber-200">{importResult.errors.length} warnings (skipped some rows)</div>
          )}
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ *
 * Knowledge Base Section — upload + search documents (RAG)
 * ------------------------------------------------------------------ */
function KnowledgeBaseSection({ onToast }: { onToast: (msg: string) => void }) {
  const [docs, setDocs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[] | null>(null)
  const [searching, setSearching] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Need useRef import — add it
  const loadDocs = useCallback(async () => {
    try {
      const res = await fetch('/api/kb')
      const data = await res.json()
      setDocs(data.docs || [])
    } catch {
      setDocs([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDocs()
  }, [loadDocs])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || uploading) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/kb', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      onToast(`Uploaded "${data.doc.filename}" — ${data.doc.chunkCount} chunks indexed`)
      await loadDocs()
    } catch (e: any) {
      onToast(`Upload failed: ${e?.message ?? 'error'}`)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleDelete = async (docId: string, filename: string) => {
    if (!confirm(`Delete "${filename}" and all its chunks?`)) return
    try {
      await fetch(`/api/kb?id=${docId}`, { method: 'DELETE' })
      onToast(`Deleted "${filename}"`)
      await loadDocs()
    } catch (e: any) {
      onToast(`Delete failed: ${e?.message ?? 'error'}`)
    }
  }

  const handleSearch = async () => {
    if (!searchQuery.trim() || searching) return
    setSearching(true)
    setSearchResults(null)
    try {
      const res = await fetch('/api/kb/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery, limit: 5 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setSearchResults(data.results || [])
    } catch (e: any) {
      onToast(`Search failed: ${e?.message ?? 'error'}`)
    } finally {
      setSearching(false)
    }
  }

  return (
    <section className="glass rounded-xl p-4 border-cyan-400/15">
      <div className="flex items-center gap-2 mb-3">
        <BookMarked className="w-4 h-4 text-cyan-300" />
        <h2 className="text-sm font-semibold text-[#e0e7ff] tracking-wide">KNOWLEDGE BASE (RAG)</h2>
      </div>
      <p className="text-[11px] text-[#7c89b5] mb-3 leading-relaxed">
        Upload documents (TXT, MD, CSV, JSON, PDF, code files). Agent007 and all sub-agents can
        search your knowledge base via the <code className="text-cyan-200">kb_search</code> tool
        to ground their answers in your own data.
      </p>

      {/* Upload button */}
      <label
        className="flex items-center justify-center gap-2 w-full glass border-cyan-400/30 hover:border-cyan-400/60 rounded-lg py-2 text-xs font-bold tracking-wider cursor-pointer transition text-cyan-200 mb-3"
        style={{ touchAction: 'manipulation' }}
      >
        {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
        {uploading ? 'INDEXING…' : 'UPLOAD DOCUMENT'}
        <input
          ref={fileRef}
          type="file"
          onChange={handleUpload}
          disabled={uploading}
          className="hidden"
          accept=".txt,.md,.csv,.json,.js,.ts,.tsx,.jsx,.py,.go,.rs,.java,.c,.cpp,.h,.sh,.sql,.yaml,.yml,.xml,.html,.css,.pdf"
        />
      </label>

      {/* Search box */}
      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#5b6a92]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Test search your knowledge base…"
            className="w-full glass rounded-lg pl-8 pr-3 py-1.5 text-xs text-[#e0e7ff] placeholder:text-[#5b6a92] outline-none focus:border-cyan-400/70"
          />
        </div>
        <button
          onClick={handleSearch}
          disabled={searching || !searchQuery.trim()}
          className="neon-btn-cyan rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-50"
          style={{ touchAction: 'manipulation' }}
        >
          {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'SEARCH'}
        </button>
      </div>

      {/* Search results */}
      {searchResults && (
        <div className="mb-3 space-y-1.5 max-h-40 overflow-y-auto scroll-cyan pr-1">
          {searchResults.length === 0 ? (
            <div className="text-[11px] text-[#5b6a92] text-center py-2">No matches found.</div>
          ) : (
            searchResults.map((r, i) => (
              <div key={i} className="glass rounded-md p-2 text-[10px]">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-cyan-200 font-semibold truncate">{r.filename}</span>
                  <span className="text-[#5b6a92]">score: {r.score}</span>
                </div>
                <div className="text-[#9bb5d4] line-clamp-3">{r.content}</div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Doc list */}
      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-4 h-4 animate-spin text-cyan-300" />
        </div>
      ) : docs.length === 0 ? (
        <div className="text-center py-4 text-[#5b6a92] text-xs">
          No documents uploaded yet. Upload your first doc above.
        </div>
      ) : (
        <div className="space-y-1 max-h-48 overflow-y-auto scroll-cyan pr-1">
          {docs.map((d) => (
            <div key={d.id} className="glass rounded-md p-2 flex items-center gap-2">
              <FileText className="w-3.5 h-3.5 text-cyan-300 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-semibold text-[#e0e7ff] truncate">{d.filename}</div>
                <div className="text-[9px] text-[#5b6a92]">
                  {d.chunkCount} chunks • {(d.size / 1024).toFixed(1)}KB •{' '}
                  {new Date(d.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </div>
              </div>
              <button
                onClick={() => handleDelete(d.id, d.filename)}
                className="text-[#5b6a92] hover:text-pink-300 flex-shrink-0"
                aria-label="Delete doc"
                style={{ touchAction: 'manipulation' }}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ *
 * Payment Integrations Section — Stripe + PayPal webhook config
 * ------------------------------------------------------------------ */
function PaymentIntegrationsSection() {
  const [transactions, setTransactions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/transactions?limit=10')
      .then((r) => r.json())
      .then((data) => {
        setTransactions(data.transactions || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const stripeWebhookUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/webhooks/stripe` : ''
  const paypalWebhookUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/webhooks/paypal` : ''

  return (
    <section className="glass rounded-xl p-4 border-cyan-400/15">
      <div className="flex items-center gap-2 mb-3">
        <CreditCard className="w-4 h-4 text-cyan-300" />
        <h2 className="text-sm font-semibold text-[#e0e7ff] tracking-wide">PAYMENT INTEGRATIONS</h2>
      </div>
      <p className="text-[11px] text-[#7c89b5] mb-3 leading-relaxed">
        Connect Stripe + PayPal to auto-log real payments as income. Each successful payment
        creates a Transaction record + an IncomeEntry that appears in your Dashboard.
      </p>

      {/* Webhook URLs */}
      <div className="space-y-2 mb-3">
        <div className="glass rounded-md p-2">
          <div className="text-[10px] label-tag mb-1">STRIPE WEBHOOK URL</div>
          <code className="text-[10px] text-cyan-200 break-all">{stripeWebhookUrl}</code>
          <div className="text-[9px] text-[#5b6a92] mt-1">
            Set <code className="text-cyan-300">STRIPE_WEBHOOK_SECRET</code> env var. Subscribe to <code>payment_intent.succeeded</code> + <code>charge.refunded</code>.
          </div>
        </div>
        <div className="glass rounded-md p-2">
          <div className="text-[10px] label-tag mb-1">PAYPAL WEBHOOK URL</div>
          <code className="text-[10px] text-cyan-200 break-all">{paypalWebhookUrl}</code>
          <div className="text-[9px] text-[#5b6a92] mt-1">
            Set <code className="text-cyan-300">PAYPAL_CLIENT_ID</code> + <code>PAYPAL_CLIENT_SECRET</code> env vars. Subscribe to <code>PAYMENT.CAPTURE.COMPLETED</code>.
          </div>
        </div>
      </div>

      {/* Recent transactions */}
      <div className="text-[10px] label-tag mb-2">RECENT TRANSACTIONS</div>
      {loading ? (
        <div className="flex items-center justify-center py-3">
          <Loader2 className="w-4 h-4 animate-spin text-cyan-300" />
        </div>
      ) : transactions.length === 0 ? (
        <div className="text-center py-3 text-[#5b6a92] text-xs">
          No transactions yet. Connect Stripe/PayPal to start logging real payments.
        </div>
      ) : (
        <div className="space-y-1 max-h-40 overflow-y-auto scroll-cyan pr-1">
          {transactions.map((t) => (
            <div key={t.id} className="glass rounded-md p-2 flex items-center gap-2">
              <span
                className={`text-[9px] px-1.5 py-0.5 rounded-full tracking-wide border flex-shrink-0 ${
                  t.provider === 'stripe'
                    ? 'bg-indigo-400/10 border-indigo-400/40 text-indigo-200'
                    : 'bg-blue-400/10 border-blue-400/40 text-blue-200'
                }`}
              >
                {t.provider.toUpperCase()}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-semibold text-emerald-200">
                  ${t.amount.toFixed(2)} {t.currency}
                </div>
                <div className="text-[9px] text-[#5b6a92] truncate">
                  {t.customerEmail || t.description || t.providerTxId.slice(-12)}
                </div>
              </div>
              <span className="text-[9px] text-[#5b6a92] flex-shrink-0">
                {new Date(t.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
