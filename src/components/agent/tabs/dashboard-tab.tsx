'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  TrendingUp,
  TrendingDown,
  Plus,
  Settings as SettingsIcon,
  Trash2,
  DollarSign,
  Calendar,
  Target,
  Activity,
  Loader2,
  AlertCircle,
  X,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts'
import { useChatStore } from '@/store/chat-store'

/* ----------------------------- types ----------------------------- */
interface IncomeEntry {
  id: string
  amount: number
  source: string
  notes: string | null
  date: string
  createdAt: string
}
interface Aggregates {
  today: number
  yesterday: number
  month: number
  total: number
  count: number
  last7Total: number
  last7Days: Array<{ date: string; label: string; total: number }>
}
interface IncomeData {
  entries: IncomeEntry[]
  aggregates: Aggregates
}
interface IncomeSettings {
  monthlyGoal: number
  dailyGrowthTarget: number
  currencySymbol: string
  displayMode: 'compact' | 'detailed'
}

/* ----------------------------- Dashboard tab ----------------------------- */
export function DashboardTab() {
  const [data, setData] = useState<IncomeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [settings, setSettings] = useState<IncomeSettings>({
    monthlyGoal: 1000,
    dailyGrowthTarget: 10,
    currencySymbol: '$',
    displayMode: 'detailed',
  })
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [settingsModalOpen, setSettingsModalOpen] = useState(false)

  const loadIncome = useCallback(async () => {
    try {
      const res = await fetch('/api/income')
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setData(json)
      setError('')
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load income data')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings')
      const json = await res.json()
      if (json.income) setSettings(json.income)
    } catch {
      /* ignore */
    }
  }, [])

  // Initial load + seed if empty
  useEffect(() => {
    ;(async () => {
      // Try to seed if empty so the dashboard isn't blank
      try {
        await fetch('/api/income', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seedIfEmpty: true }),
        })
      } catch {
        /* ignore */
      }
      await loadIncome()
      await loadSettings()
    })()
  }, [loadIncome, loadSettings])

  // Also tick the scheduler every 60s while the dashboard is mounted
  useEffect(() => {
    const tick = () => {
      fetch('/api/schedules/tick', { method: 'POST' }).catch(() => {/* ignore */})
    }
    tick()
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, [])

  const today = data?.aggregates.today ?? 0
  const yesterday = data?.aggregates.yesterday ?? 0
  const growthPct =
    yesterday > 0 ? ((today - yesterday) / yesterday) * 100 : today > 0 ? 100 : 0
  const monthTotal = data?.aggregates.month ?? 0
  const monthPct = settings.monthlyGoal > 0 ? Math.min(100, (monthTotal / settings.monthlyGoal) * 100) : 0
  const recent = data?.entries?.slice(0, 8) ?? []

  return (
    <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
      <div className="flex-1 overflow-y-auto scroll-cyan p-4 sm:p-6">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                <span className="neon-text-cyan">Income</span>{' '}
                <span className="neon-text-purple">Tracker</span>
              </h1>
              <p className="text-xs text-[#7c89b5] mt-1 tracking-wide">
                Real-time passive-income metrics for the +10% daily mission
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setSettingsModalOpen(true)}
                className="h-9 px-3 rounded-lg glass border-cyan-400/30 hover:border-cyan-400/70 text-cyan-200 text-xs font-semibold tracking-wider flex items-center gap-1.5 transition"
                aria-label="Dashboard settings"
                style={{ touchAction: 'manipulation' }}
              >
                <SettingsIcon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">SETTINGS</span>
              </button>
              <button
                onClick={() => setAddModalOpen(true)}
                className="h-9 px-4 rounded-lg neon-btn-cyan text-xs font-bold tracking-wider flex items-center gap-1.5"
                style={{ touchAction: 'manipulation' }}
              >
                <Plus className="w-3.5 h-3.5" />
                ADD INCOME
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20 text-[#7c89b5]">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Loading income data…
            </div>
          ) : error ? (
            <div className="glass rounded-xl p-4 border border-pink-400/40 text-pink-200 text-sm flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-semibold mb-1">Failed to load dashboard</div>
                <div className="text-xs text-[#cfd9f0]">{error}</div>
              </div>
            </div>
          ) : (
            <>
              {/* Top KPI cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4">
                <KpiCard
                  label="TODAY'S INCOME"
                  value={`${settings.currencySymbol}${today.toFixed(2)}`}
                  icon={<DollarSign className="w-4 h-4 text-cyan-300" />}
                  accent="cyan"
                  big
                />
                <KpiCard
                  label="YESTERDAY"
                  value={`${settings.currencySymbol}${yesterday.toFixed(2)}`}
                  icon={<Calendar className="w-4 h-4 text-purple-300" />}
                  accent="purple"
                />
                <GrowthCard
                  pct={growthPct}
                  target={settings.dailyGrowthTarget}
                  currencySymbol={settings.currencySymbol}
                />
                <KpiCard
                  label="THIS MONTH"
                  value={`${settings.currencySymbol}${monthTotal.toFixed(2)}`}
                  sub={`Goal: ${settings.currencySymbol}${settings.monthlyGoal.toFixed(0)}`}
                  icon={<Target className="w-4 h-4 text-pink-300" />}
                  accent="pink"
                />
              </div>

              {/* 7-day chart + monthly progress */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4 mb-4">
                <div className="lg:col-span-2 glass rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-cyan-300" />
                      <h3 className="text-sm font-semibold text-[#e0e7ff] tracking-wide">
                        7-DAY INCOME TREND
                      </h3>
                    </div>
                    <span className="text-[10px] text-[#7c89b5] tracking-wider">
                      Total: {settings.currencySymbol}
                      {(data?.aggregates.last7Total ?? 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="h-48 sm:h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={data?.aggregates.last7Days ?? []} margin={{ top: 6, right: 6, left: -16, bottom: 0 }}>
                        <defs>
                          <linearGradient id="income-grad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#00f0ff" stopOpacity={0.6} />
                            <stop offset="100%" stopColor="#00f0ff" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,240,255,0.08)" />
                        <XAxis
                          dataKey="label"
                          tick={{ fill: '#7c89b5', fontSize: 11 }}
                          tickLine={{ stroke: 'rgba(0,240,255,0.2)' }}
                          axisLine={{ stroke: 'rgba(0,240,255,0.15)' }}
                        />
                        <YAxis
                          tick={{ fill: '#7c89b5', fontSize: 11 }}
                          tickLine={{ stroke: 'rgba(0,240,255,0.2)' }}
                          axisLine={{ stroke: 'rgba(0,240,255,0.15)' }}
                        />
                        <Tooltip
                          contentStyle={{
                            background: 'rgba(8,10,22,0.95)',
                            border: '1px solid rgba(0,240,255,0.4)',
                            borderRadius: '8px',
                            color: '#e0e7ff',
                            fontSize: '12px',
                            boxShadow: '0 0 18px rgba(0,240,255,0.25)',
                          }}
                          labelStyle={{ color: '#00f0ff' }}
                          formatter={(v: any) => [`${settings.currencySymbol}${Number(v).toFixed(2)}`, 'Income']}
                        />
                        <Area
                          type="monotone"
                          dataKey="total"
                          stroke="#00f0ff"
                          strokeWidth={2.5}
                          fill="url(#income-grad)"
                          dot={{ r: 3, fill: '#00f0ff', strokeWidth: 0 }}
                          activeDot={{ r: 5, fill: '#a855f7' }}
                        />
                        <ReferenceLine
                          y={yesterday}
                          stroke="#a855f7"
                          strokeDasharray="4 4"
                          strokeWidth={1}
                          label={{ value: 'Yesterday', fill: '#a855f7', fontSize: 10, position: 'insideTopRight' }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="glass rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Target className="w-4 h-4 text-pink-300" />
                      <h3 className="text-sm font-semibold text-[#e0e7ff] tracking-wide">
                        MONTHLY GOAL
                      </h3>
                    </div>
                    <span className="text-[10px] text-[#7c89b5]">
                      {monthPct.toFixed(0)}%
                    </span>
                  </div>
                  <div className="flex flex-col gap-3 mt-2">
                    <div>
                      <div className="flex items-baseline gap-2 mb-2">
                        <span className="text-2xl sm:text-3xl font-bold neon-text-cyan">
                          {settings.currencySymbol}
                          {monthTotal.toFixed(2)}
                        </span>
                        <span className="text-xs text-[#7c89b5]">
                          / {settings.currencySymbol}
                          {settings.monthlyGoal.toFixed(0)}
                        </span>
                      </div>
                      <div className="h-3 rounded-full bg-[#0a1020] overflow-hidden border border-cyan-400/15">
                        <motion.div
                          className="h-full rounded-full"
                          style={{
                            background:
                              'linear-gradient(90deg, #00f0ff 0%, #a855f7 70%, #ec4899 100%)',
                            boxShadow: '0 0 12px rgba(0,240,255,0.5)',
                          }}
                          initial={{ width: 0 }}
                          animate={{ width: `${monthPct}%` }}
                          transition={{ duration: 0.6, ease: 'easeOut' }}
                        />
                      </div>
                      <div className="text-[10px] text-[#5b6a92] mt-1.5 tracking-wide">
                        {settings.currencySymbol}
                        {Math.max(0, settings.monthlyGoal - monthTotal).toFixed(2)} remaining to hit goal
                      </div>
                    </div>
                    {/* Goal vs actual sparkline */}
                    <div className="h-20 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={data?.aggregates.last7Days ?? []}>
                          <Line
                            type="monotone"
                            dataKey="total"
                            stroke="#00f0ff"
                            strokeWidth={2}
                            dot={false}
                          />
                          <ReferenceLine
                            y={settings.monthlyGoal / 30}
                            stroke="#ec4899"
                            strokeDasharray="3 3"
                            strokeWidth={1}
                          />
                          <Tooltip
                            contentStyle={{
                              background: 'rgba(8,10,22,0.95)',
                              border: '1px solid rgba(0,240,255,0.4)',
                              borderRadius: '8px',
                              color: '#e0e7ff',
                              fontSize: '11px',
                            }}
                            formatter={(v: any) => [`${settings.currencySymbol}${Number(v).toFixed(2)}`, 'Actual']}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-[#5b6a92] tracking-wide">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-cyan-400 inline-block" />
                        Actual
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-pink-400 inline-block" />
                        Target ({settings.currencySymbol}
                        {(settings.monthlyGoal / 30).toFixed(2)}/day)
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Recent income events */}
              <div className="glass rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-cyan-300" />
                    <h3 className="text-sm font-semibold text-[#e0e7ff] tracking-wide">
                      RECENT INCOME EVENTS
                    </h3>
                  </div>
                  <span className="text-[10px] text-[#5b6a92] tracking-wider">
                    {data?.aggregates.count ?? 0} total entries
                  </span>
                </div>
                {recent.length === 0 ? (
                  <div className="text-center py-8 text-[#5b6a92] text-xs">
                    No income events yet. Click <span className="text-cyan-300 font-semibold">+ ADD INCOME</span> to log your first one.
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-80 overflow-y-auto scroll-cyan pr-1">
                    {recent.map((e) => (
                      <IncomeRow
                        key={e.id}
                        entry={e}
                        currencySymbol={settings.currencySymbol}
                        onDelete={async () => {
                          try {
                            await fetch(`/api/income?id=${e.id}`, { method: 'DELETE' })
                            await loadIncome()
                          } catch {
                            /* ignore */
                          }
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <AnimatePresence>
        {addModalOpen && (
          <AddIncomeModal
            onClose={() => setAddModalOpen(false)}
            onSaved={async () => {
              setAddModalOpen(false)
              await loadIncome()
            }}
          />
        )}
        {settingsModalOpen && (
          <DashboardSettingsModal
            initial={settings}
            onClose={() => setSettingsModalOpen(false)}
            onSaved={async (s) => {
              setSettings(s)
              setSettingsModalOpen(false)
            }}
          />
        )}
      </AnimatePresence>
    </main>
  )
}

/* ----------------------------- KPI card ----------------------------- */
function KpiCard({
  label,
  value,
  sub,
  icon,
  accent,
  big,
}: {
  label: string
  value: string
  sub?: string
  icon: React.ReactNode
  accent: 'cyan' | 'purple' | 'pink'
  big?: boolean
}) {
  const colorMap = {
    cyan: 'text-cyan-300 border-cyan-400/30',
    purple: 'text-purple-300 border-purple-400/30',
    pink: 'text-pink-300 border-pink-400/30',
  }
  return (
    <div className="glass rounded-xl p-3 sm:p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[9px] sm:text-[10px] tracking-[0.18em] text-[#7c89b5] font-semibold">
          {label}
        </span>
        <div className={`w-7 h-7 rounded-md flex items-center justify-center bg-[#0a1020] border ${colorMap[accent]}`}>
          {icon}
        </div>
      </div>
      <div className={`${big ? 'text-2xl sm:text-3xl' : 'text-xl sm:text-2xl'} font-bold neon-text-cyan`}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-[#5b6a92] mt-1 tracking-wide">{sub}</div>}
    </div>
  )
}

function GrowthCard({
  pct,
  target,
  currencySymbol: _currencySymbol,
}: {
  pct: number
  target: number
  currencySymbol: string
}) {
  const positive = pct >= 0
  const metTarget = pct >= target
  return (
    <div className="glass rounded-xl p-3 sm:p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[9px] sm:text-[10px] tracking-[0.18em] text-[#7c89b5] font-semibold">
          GROWTH %
        </span>
        <div
          className={`w-7 h-7 rounded-md flex items-center justify-center bg-[#0a1020] border ${
            positive ? 'text-emerald-300 border-emerald-400/30' : 'text-pink-300 border-pink-400/30'
          }`}
        >
          {positive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
        </div>
      </div>
      <div
        className={`text-2xl sm:text-3xl font-bold ${
          positive ? 'text-emerald-300' : 'text-pink-300'
        }`}
        style={{
          textShadow: positive
            ? '0 0 8px rgba(110,231,183,0.6), 0 0 18px rgba(110,231,183,0.3)'
            : '0 0 8px rgba(236,72,153,0.6), 0 0 18px rgba(236,72,153,0.3)',
        }}
      >
        {positive ? '+' : ''}
        {pct.toFixed(1)}%
      </div>
      <div className="text-[10px] text-[#5b6a92] mt-1 tracking-wide">
        vs yesterday • target +{target}%
        {metTarget && <span className="text-emerald-300 ml-1">✓</span>}
      </div>
    </div>
  )
}

/* ----------------------------- Income row ----------------------------- */
function IncomeRow({
  entry,
  currencySymbol,
  onDelete,
}: {
  entry: IncomeEntry
  currencySymbol: string
  onDelete: () => void
}) {
  const date = new Date(entry.date)
  const isSample = entry.source.toLowerCase() === 'sample'
  return (
    <div className="flex items-center gap-3 p-2 rounded-lg glass border-cyan-400/15 hover:border-cyan-400/40 transition group">
      <div
        className={`w-9 h-9 rounded-md flex items-center justify-center font-bold text-xs flex-shrink-0 ${
          isSample
            ? 'bg-[#1a1430] text-purple-200 border border-purple-400/30'
            : 'bg-cyan-400/10 text-cyan-300 border border-cyan-400/30'
        }`}
      >
        {entry.source.slice(0, 2).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-[#e0e7ff] truncate">{entry.source}</span>
          {isSample && (
            <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-purple-400/10 border border-purple-400/30 text-purple-200 tracking-wide">
              SAMPLE
            </span>
          )}
        </div>
        <div className="text-[10px] text-[#5b6a92] truncate">
          {date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          {entry.notes && <span className="ml-2">• {entry.notes.slice(0, 60)}</span>}
        </div>
      </div>
      <div className="text-sm font-bold text-emerald-300 flex-shrink-0">
        +{currencySymbol}
        {entry.amount.toFixed(2)}
      </div>
      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 text-pink-300 hover:text-pink-200 transition flex-shrink-0 p-1"
        aria-label="Delete income entry"
        style={{ touchAction: 'manipulation' }}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

/* ----------------------------- Add Income modal ----------------------------- */
function AddIncomeModal({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: () => void
}) {
  const [amount, setAmount] = useState('')
  const [source, setSource] = useState('manual')
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState(() => {
    const d = new Date()
    return d.toISOString().slice(0, 10) + 'T' + d.toTimeString().slice(0, 5)
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    const amt = parseFloat(amount)
    if (!isFinite(amt) || amt <= 0) {
      setError('Amount must be a positive number.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/income', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amt,
          source: source.trim() || 'manual',
          notes: notes.trim() || null,
          date: new Date(date).toISOString(),
        }),
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        setError(json.error ?? `HTTP ${res.status}`)
        setSubmitting(false)
        return
      }
      onSaved()
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
        className="w-full sm:max-w-md glass-strong sm:rounded-2xl p-5 sm:p-6 min-h-screen sm:min-h-0 overflow-y-auto"
        style={{ borderColor: 'rgba(0,240,255,0.35)', boxShadow: '0 0 40px rgba(0,240,255,0.15)' }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Plus className="w-5 h-5 text-cyan-300" />
            <h2 className="text-base font-bold text-[#e0e7ff]">Add Income</h2>
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
        <p className="text-[11px] text-[#7c89b5] mb-4">Log a new income entry manually.</p>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1 font-semibold">AMOUNT ($)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full glass rounded-lg px-3 py-2.5 text-sm text-[#e0e7ff] outline-none focus:border-cyan-400/70 transition"
              placeholder="12.50"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1 font-semibold">SOURCE</label>
            <input
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-full glass rounded-lg px-3 py-2.5 text-sm text-[#e0e7ff] outline-none focus:border-cyan-400/70 transition"
              placeholder="manual, Affiliate, Freelance, …"
            />
          </div>
          <div>
            <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1 font-semibold">DATE</label>
            <input
              type="datetime-local"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full glass rounded-lg px-3 py-2.5 text-sm text-[#e0e7ff] outline-none focus:border-cyan-400/70 transition"
            />
          </div>
          <div>
            <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1 font-semibold">NOTES (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full glass rounded-lg px-3 py-2.5 text-sm text-[#e0e7ff] outline-none focus:border-cyan-400/70 transition resize-none"
              placeholder="Brief description…"
            />
          </div>
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
                  SAVING…
                </>
              ) : (
                'SAVE INCOME'
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}

/* ----------------------------- Dashboard settings modal ----------------------------- */
function DashboardSettingsModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: IncomeSettings
  onClose: () => void
  onSaved: (s: IncomeSettings) => void
}) {
  const [monthlyGoal, setMonthlyGoal] = useState(String(initial.monthlyGoal))
  const [dailyGrowthTarget, setDailyGrowthTarget] = useState(String(initial.dailyGrowthTarget))
  const [currencySymbol, setCurrencySymbol] = useState(initial.currencySymbol)
  const [displayMode, setDisplayMode] = useState<'compact' | 'detailed'>(initial.displayMode)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    const goal = parseFloat(monthlyGoal)
    const growth = parseFloat(dailyGrowthTarget)
    if (!isFinite(goal) || goal < 0) {
      setError('Monthly goal must be a non-negative number.')
      return
    }
    if (!isFinite(growth)) {
      setError('Daily growth target must be a number.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const updated: IncomeSettings = {
        monthlyGoal: goal,
        dailyGrowthTarget: growth,
        currencySymbol: currencySymbol || '$',
        displayMode,
      }
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ income: updated }),
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        setError(json.error ?? `HTTP ${res.status}`)
        setSubmitting(false)
        return
      }
      onSaved(json.income ?? updated)
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
        className="w-full sm:max-w-md glass-strong sm:rounded-2xl p-5 sm:p-6 min-h-screen sm:min-h-0 overflow-y-auto"
        style={{ borderColor: 'rgba(168,85,247,0.35)', boxShadow: '0 0 40px rgba(168,85,247,0.15)' }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <SettingsIcon className="w-5 h-5 text-purple-300" />
            <h2 className="text-base font-bold text-[#e0e7ff]">Dashboard Settings</h2>
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
        <p className="text-[11px] text-[#7c89b5] mb-4">Customize your income tracker.</p>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1 font-semibold">MONTHLY GOAL ($)</label>
            <input
              type="number"
              step="1"
              min="0"
              value={monthlyGoal}
              onChange={(e) => setMonthlyGoal(e.target.value)}
              className="w-full glass rounded-lg px-3 py-2.5 text-sm text-[#e0e7ff] outline-none focus:border-cyan-400/70 transition"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1 font-semibold">DAILY GROWTH TARGET (%)</label>
            <input
              type="number"
              step="0.1"
              value={dailyGrowthTarget}
              onChange={(e) => setDailyGrowthTarget(e.target.value)}
              className="w-full glass rounded-lg px-3 py-2.5 text-sm text-[#e0e7ff] outline-none focus:border-cyan-400/70 transition"
              required
            />
          </div>
          <div>
            <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1 font-semibold">CURRENCY SYMBOL</label>
            <input
              type="text"
              maxLength={4}
              value={currencySymbol}
              onChange={(e) => setCurrencySymbol(e.target.value)}
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
                  onClick={() => setDisplayMode(m)}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold tracking-wider transition border ${
                    displayMode === m
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
                  SAVING…
                </>
              ) : (
                'SAVE'
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}
