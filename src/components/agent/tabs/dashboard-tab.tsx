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
  RefreshCw,
  Zap,
  ExternalLink,
  Info,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Send,
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
import { AutonomyIntelligencePanel } from '@/components/agent/autonomy-intelligence-panel'
import { MissionMonitor } from '@/components/agent/mission-monitor'

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
interface CustomWidget {
  id: string
  title: string
  type: 'kpi' | 'stat' | 'note' | 'link' | 'progress' | 'alert'
  value: string | number
  subtitle?: string
  color?: string
  icon?: string
  position?: 'top' | 'middle' | 'bottom'
  link?: string
  alertLevel?: 'info' | 'warn' | 'error'
  progress?: number
  updatedAt: string
}

/* ----------------------------- Dashboard tab ----------------------------- */
export function DashboardTab() {
  const [data, setData] = useState<IncomeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [settings, setSettings] = useState<IncomeSettings>({
    monthlyGoal: 20000,
    dailyGrowthTarget: 20,
    currencySymbol: '$',
    displayMode: 'detailed',
  })
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [settingsModalOpen, setSettingsModalOpen] = useState(false)
  const [customWidgets, setCustomWidgets] = useState<CustomWidget[]>([])
  const [widgetsLoading, setWidgetsLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null)

  // Subscribe to refresh signals from Agent007
  const refreshVersion = useChatStore((s) => s.refreshVersion)
  const autoRefreshEnabled = useChatStore((s) => s.autoRefreshEnabled)
  const setAutoRefreshEnabled = useChatStore((s) => s.setAutoRefreshEnabled)

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

  const loadCustomWidgets = useCallback(async () => {
    setWidgetsLoading(true)
    try {
      const res = await fetch('/api/dashboard/widgets')
      const json = await res.json()
      if (json.widgets) setCustomWidgets(json.widgets)
    } catch {
      /* ignore */
    } finally {
      setWidgetsLoading(false)
    }
  }, [])

  const refreshAll = useCallback(async () => {
    setRefreshing(true)
    await Promise.all([loadIncome(), loadSettings(), loadCustomWidgets()])
    setLastRefreshedAt(new Date())
    setTimeout(() => setRefreshing(false), 600)
  }, [loadIncome, loadSettings, loadCustomWidgets])

  // Initial load + seed if empty
  // UPGRADE #142 — Parallelize initial fetches (Issue A fix)
  // Before: 4 SEQUENTIAL awaits on cold start = 4× DB cold-start tax (~10s each)
  // After: 1 seed POST (non-blocking) + 3 parallel GETs = ~10s total instead of ~40s
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Fire the seed POST in the background (don't await — it's idempotent
      // and the GETs below will return whatever data exists).
      fetch('/api/income', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seedIfEmpty: true }),
      }).catch(() => {/* ignore */})

      // Parallelize the 3 GETs — they all hit `ensureDbReady()` and the
      // first cold-start DB init will satisfy all 3 simultaneously.
      try {
        await Promise.all([
          loadIncome(),
          loadSettings(),
          loadCustomWidgets(),
        ])
      } catch {
        /* ignore — individual loaders have their own error handling */
      }
      if (!cancelled) setLastRefreshedAt(new Date())
    })()
    return () => { cancelled = true }
  }, [loadIncome, loadSettings, loadCustomWidgets])

  // Re-fetch when Agent007 emits a refresh signal
  useEffect(() => {
    if (refreshVersion === 0) return // skip initial
    refreshAll()
  }, [refreshVersion, refreshAll])

  // UPGRADE #156 Fix 2: REMOVED 60-second scheduler tick from dashboard mount.
  // Before: fired POST /api/schedules/tick every 60 seconds, which triggered
  //   2 monitor calls (each 30s timeout) — blocking the dashboard for 65+ seconds.
  // After: scheduled tasks run via Vercel Cron (every 30 minutes, configured in
  //   vercel.json). The dashboard no longer blocks. Users can still trigger
  //   schedules manually via the Schedules tab "Run Now" button.

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
                Mission: $20,000/month passive income • 20% monthly growth • 20% daily growth • Full autonomous authority
              </p>
              {lastRefreshedAt && (
                <p className="text-[10px] text-[#5b6a92] mt-0.5 tracking-wide">
                  Last refreshed: {lastRefreshedAt.toLocaleTimeString()}
                  {refreshing && ' • refreshing…'}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Auto-refresh toggle */}
              <button
                onClick={() => setAutoRefreshEnabled(!autoRefreshEnabled)}
                className={`h-9 px-3 rounded-lg text-xs font-semibold tracking-wider flex items-center gap-1.5 transition border ${
                  autoRefreshEnabled
                    ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-200'
                    : 'glass border-cyan-400/30 text-[#7c89b5]'
                }`}
                title={autoRefreshEnabled ? 'Auto-refresh ON (Agent007 changes appear automatically)' : 'Auto-refresh OFF'}
                style={{ touchAction: 'manipulation' }}
              >
                <Zap className={`w-3.5 h-3.5 ${autoRefreshEnabled ? 'fill-emerald-300' : ''}`} />
                <span className="hidden sm:inline">AUTO</span>
              </button>
              {/* Manual refresh */}
              <button
                onClick={refreshAll}
                disabled={refreshing}
                className="h-9 px-3 rounded-lg glass border-cyan-400/30 hover:border-cyan-400/70 text-cyan-200 text-xs font-semibold tracking-wider flex items-center gap-1.5 transition disabled:opacity-50"
                title="Manual refresh"
                style={{ touchAction: 'manipulation' }}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">REFRESH</span>
              </button>
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

          {/* UPGRADE #87 — Autonomy / Intelligence / Awareness panel (live data) */}
          <div className="glass rounded-xl p-4 border border-cyan-400/20 mb-5">
            <AutonomyIntelligencePanel mode="full" />
          </div>

          {/* Custom widgets — top position */}
          {customWidgets.filter((w) => w.position === 'top').length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4">
              {customWidgets
                .filter((w) => w.position === 'top')
                .map((w) => (
                  <CustomWidgetCard key={w.id} widget={w} onRemove={loadCustomWidgets} />
                ))}
            </div>
          )}

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
              {/* UPGRADE #144 — Live Mission Monitor (real-time pipeline progress) */}
              <div className="mb-4">
                <MissionMonitor />
              </div>

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

              {/* Custom widgets — middle position */}
              {customWidgets.filter((w) => w.position === 'middle').length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mt-4">
                  {customWidgets
                    .filter((w) => w.position === 'middle')
                    .map((w) => (
                      <CustomWidgetCard key={w.id} widget={w} onRemove={loadCustomWidgets} />
                    ))}
                </div>
              )}

              {/* Custom widgets — bottom position */}
              {customWidgets.filter((w) => w.position === 'bottom').length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mt-4">
                  {customWidgets
                    .filter((w) => w.position === 'bottom')
                    .map((w) => (
                      <CustomWidgetCard key={w.id} widget={w} onRemove={loadCustomWidgets} />
                    ))}
                </div>
              )}

              {/* Hint about Agent007 control */}
              {customWidgets.length === 0 && !widgetsLoading && (
                <div className="mt-4 glass rounded-xl p-4 border border-cyan-400/20">
                  <div className="flex items-start gap-2 text-xs text-[#9bb5d4]">
                    <Zap className="w-4 h-4 text-cyan-300 flex-shrink-0 mt-0.5" />
                    <div className="leading-relaxed">
                      <span className="text-cyan-300 font-semibold">Agent007 has full dashboard control.</span>{' '}
                      Tell Agent007 in chat to <em>&quot;add a KPI widget for daily revenue&quot;</em> or{' '}
                      <em>&quot;add an alert widget for 2FA status&quot;</em> and it will appear here automatically.
                      Agent007 can add, edit, or remove any widget via manage actions — no limitations.
                    </div>
                  </div>
                </div>
              )}

              {/* System Control Panel — upgrade manifest + self-heal + comms test */}
              <SystemControlPanel refreshVersion={refreshVersion} />
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

/* --------------------------- Custom Widget Card --------------------------- */
function CustomWidgetCard({ widget, onRemove }: { widget: CustomWidget; onRemove: () => void }) {
  const [removing, setRemoving] = useState(false)

  const handleRemove = async () => {
    if (removing) return
    setRemoving(true)
    try {
      await fetch('/api/dashboard/widgets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', id: widget.id }),
      })
      onRemove()
    } catch {
      /* ignore */
    } finally {
      setRemoving(false)
    }
  }

  const accentColor = widget.color ?? '#00f0ff'

  if (widget.type === 'alert') {
    const level = widget.alertLevel ?? 'info'
    const levelStyles = {
      info: { bg: 'bg-cyan-500/10', border: 'border-cyan-400/40', text: 'text-cyan-200', icon: <Info className="w-4 h-4" /> },
      warn: { bg: 'bg-amber-500/10', border: 'border-amber-400/40', text: 'text-amber-200', icon: <AlertTriangle className="w-4 h-4" /> },
      error: { bg: 'bg-pink-500/10', border: 'border-pink-400/40', text: 'text-pink-200', icon: <AlertCircle className="w-4 h-4" /> },
    }
    const s = levelStyles[level]
    return (
      <div className={`glass rounded-xl p-3 sm:p-4 border ${s.border} ${s.bg}`}>
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className={s.text}>{s.icon}</span>
            <span className="text-[9px] sm:text-[10px] tracking-[0.18em] text-[#7c89b5] font-semibold uppercase">
              {widget.title}
            </span>
          </div>
          <button
            onClick={handleRemove}
            disabled={removing}
            className="text-[#5b6a92] hover:text-pink-300 text-[10px] transition disabled:opacity-50"
            title="Remove widget"
            style={{ touchAction: 'manipulation' }}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
        <div className={`text-sm ${s.text} font-semibold`}>{widget.value}</div>
        {widget.subtitle && <div className="text-[10px] text-[#7c89b5] mt-1">{widget.subtitle}</div>}
      </div>
    )
  }

  if (widget.type === 'note') {
    return (
      <div className="glass rounded-xl p-3 sm:p-4">
        <div className="flex items-start justify-between mb-2">
          <span className="text-[9px] sm:text-[10px] tracking-[0.18em] text-[#7c89b5] font-semibold uppercase">
            {widget.title}
          </span>
          <button
            onClick={handleRemove}
            disabled={removing}
            className="text-[#5b6a92] hover:text-pink-300 text-[10px] transition disabled:opacity-50"
            title="Remove widget"
            style={{ touchAction: 'manipulation' }}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
        <div className="text-sm text-[#e0e7ff] leading-relaxed">{widget.value}</div>
        {widget.subtitle && <div className="text-[10px] text-[#7c89b5] mt-1">{widget.subtitle}</div>}
      </div>
    )
  }

  if (widget.type === 'link') {
    return (
      <div className="glass rounded-xl p-3 sm:p-4">
        <div className="flex items-start justify-between mb-2">
          <span className="text-[9px] sm:text-[10px] tracking-[0.18em] text-[#7c89b5] font-semibold uppercase">
            {widget.title}
          </span>
          <button
            onClick={handleRemove}
            disabled={removing}
            className="text-[#5b6a92] hover:text-pink-300 text-[10px] transition disabled:opacity-50"
            title="Remove widget"
            style={{ touchAction: 'manipulation' }}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
        <a
          href={widget.link ?? '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-cyan-300 hover:text-cyan-200 flex items-center gap-1.5 transition"
          style={{ touchAction: 'manipulation' }}
        >
          <ExternalLink className="w-3.5 h-3.5" />
          {widget.value}
        </a>
        {widget.subtitle && <div className="text-[10px] text-[#7c89b5] mt-1">{widget.subtitle}</div>}
      </div>
    )
  }

  if (widget.type === 'progress') {
    const pct = Math.max(0, Math.min(100, widget.progress ?? 0))
    return (
      <div className="glass rounded-xl p-3 sm:p-4">
        <div className="flex items-start justify-between mb-2">
          <span className="text-[9px] sm:text-[10px] tracking-[0.18em] text-[#7c89b5] font-semibold uppercase">
            {widget.title}
          </span>
          <button
            onClick={handleRemove}
            disabled={removing}
            className="text-[#5b6a92] hover:text-pink-300 text-[10px] transition disabled:opacity-50"
            title="Remove widget"
            style={{ touchAction: 'manipulation' }}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-xl sm:text-2xl font-bold" style={{ color: accentColor }}>
            {widget.value}
          </span>
          <span className="text-[10px] text-[#7c89b5]">{pct.toFixed(0)}%</span>
        </div>
        <div className="h-2.5 rounded-full bg-[#0a1020] overflow-hidden border border-cyan-400/15">
          <motion.div
            className="h-full rounded-full"
            style={{ background: accentColor, boxShadow: `0 0 8px ${accentColor}80` }}
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </div>
        {widget.subtitle && <div className="text-[10px] text-[#7c89b5] mt-1">{widget.subtitle}</div>}
      </div>
    )
  }

  // kpi or stat (default)
  return (
    <div className="glass rounded-xl p-3 sm:p-4">
      <div className="flex items-start justify-between mb-2">
        <span className="text-[9px] sm:text-[10px] tracking-[0.18em] text-[#7c89b5] font-semibold uppercase">
          {widget.title}
        </span>
        <button
          onClick={handleRemove}
          disabled={removing}
          className="text-[#5b6a92] hover:text-pink-300 text-[10px] transition disabled:opacity-50"
          title="Remove widget"
          style={{ touchAction: 'manipulation' }}
        >
          <X className="w-3 h-3" />
        </button>
      </div>
      <div className="text-xl sm:text-2xl font-bold" style={{ color: accentColor }}>
        {widget.value}
      </div>
      {widget.subtitle && <div className="text-[10px] text-[#7c89b5] mt-1">{widget.subtitle}</div>}
    </div>
  )
}

/* --------------------------- System Control Panel --------------------------- */
function SystemControlPanel({ refreshVersion }: { refreshVersion: number }) {
  const [manifest, setManifest] = useState<any>(null)
  const [audit, setAudit] = useState<any>(null)
  const [healResult, setHealResult] = useState<any>(null)
  const [commsResult, setCommsResult] = useState<any>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const loadManifest = useCallback(async () => {
    try {
      const res = await fetch('/api/system/manifest')
      const data = await res.json()
      setManifest(data)
    } catch {}
  }, [])

  const loadAudit = useCallback(async () => {
    setLoading('audit')
    try {
      const res = await fetch('/api/system/audit')
      const data = await res.json()
      setAudit(data)
    } catch {}
    setLoading(null)
  }, [])

  const runSelfHeal = async (action: string) => {
    setLoading(`heal_${action}`)
    try {
      const res = await fetch('/api/system/self-heal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      setHealResult(data)
    } catch {}
    setLoading(null)
  }

  const testComms = async () => {
    setLoading('comms')
    try {
      const res = await fetch('/api/system/test-communication', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      setCommsResult(data)
    } catch {}
    setLoading(null)
  }

  useEffect(() => {
    loadManifest()
    loadAudit()
  }, [loadManifest, loadAudit, refreshVersion])

  const totalUpgrades = manifest?.totalUpgrades ?? 0
  const integrity = manifest?.integrity
  const auditOverall = audit?.overall ?? '—'

  return (
    <div className="mt-4 glass rounded-xl p-4 border border-emerald-400/20">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-300" />
          <h3 className="text-sm font-semibold text-[#e0e7ff] tracking-wide">
            SYSTEM CONTROL PANEL
          </h3>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-400/10 border border-emerald-400/30 text-emerald-200 tracking-wider">
            UPGRADE-ONLY MODE
          </span>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[10px] text-cyan-300/80 hover:text-cyan-200 tracking-wider transition"
          style={{ touchAction: 'manipulation' }}
        >
          {expanded ? '▼ COLLAPSE' : '▶ EXPAND'}
        </button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <div className="bg-[#0a1020] rounded-lg p-2 border border-emerald-400/15">
          <div className="text-[9px] tracking-wider text-[#7c89b5]">UPGRADES</div>
          <div className="text-lg font-bold text-emerald-300">{totalUpgrades}</div>
        </div>
        <div className="bg-[#0a1020] rounded-lg p-2 border border-cyan-400/15">
          <div className="text-[9px] tracking-wider text-[#7c89b5]">INTEGRITY</div>
          <div className="text-lg font-bold text-cyan-300">
            {integrity?.ok ? '✓ OK' : '✗ FAIL'}
          </div>
        </div>
        <div className="bg-[#0a1020] rounded-lg p-2 border border-purple-400/15">
          <div className="text-[9px] tracking-wider text-[#7c89b5]">AUDIT</div>
          <div className={`text-lg font-bold ${auditOverall === 'pass' ? 'text-emerald-300' : auditOverall === 'warn' ? 'text-amber-300' : 'text-pink-300'}`}>
            {auditOverall.toUpperCase()}
          </div>
        </div>
        <div className="bg-[#0a1020] rounded-lg p-2 border border-pink-400/15">
          <div className="text-[9px] tracking-wider text-[#7c89b5]">SUBAGENTS</div>
          <div className="text-lg font-bold text-pink-300">18 FULL</div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 mb-3">
        <button
          onClick={() => runSelfHeal('diagnose')}
          disabled={!!loading}
          className="h-8 px-3 rounded-lg glass border-cyan-400/30 hover:border-cyan-400/70 text-cyan-200 text-[11px] font-semibold tracking-wider flex items-center gap-1.5 transition disabled:opacity-50"
          style={{ touchAction: 'manipulation' }}
        >
          <Activity className="w-3 h-3" />
          {loading === 'heal_diagnose' ? 'DIAGNOSING…' : 'DIAGNOSE'}
        </button>
        <button
          onClick={() => runSelfHeal('full_repair')}
          disabled={!!loading}
          className="h-8 px-3 rounded-lg bg-emerald-500/15 border border-emerald-400/40 hover:border-emerald-400/70 text-emerald-200 text-[11px] font-semibold tracking-wider flex items-center gap-1.5 transition disabled:opacity-50"
          style={{ touchAction: 'manipulation' }}
        >
          <RefreshCw className={`w-3 h-3 ${loading === 'heal_full_repair' ? 'animate-spin' : ''}`} />
          {loading === 'heal_full_repair' ? 'REPAIRING…' : 'FULL REPAIR'}
        </button>
        <button
          onClick={testComms}
          disabled={!!loading}
          className="h-8 px-3 rounded-lg glass border-purple-400/30 hover:border-purple-400/70 text-purple-200 text-[11px] font-semibold tracking-wider flex items-center gap-1.5 transition disabled:opacity-50"
          style={{ touchAction: 'manipulation' }}
        >
          <Send className="w-3 h-3" />
          {loading === 'comms' ? 'TESTING…' : 'TEST COMMS'}
        </button>
        <button
          onClick={loadAudit}
          disabled={!!loading}
          className="h-8 px-3 rounded-lg glass border-cyan-400/30 hover:border-cyan-400/70 text-cyan-200 text-[11px] font-semibold tracking-wider flex items-center gap-1.5 transition disabled:opacity-50"
          style={{ touchAction: 'manipulation' }}
        >
          <ShieldCheck className="w-3 h-3" />
          {loading === 'audit' ? 'AUDITING…' : 'RE-AUDIT'}
        </button>
      </div>

      {/* Heal result */}
      {healResult && (
        <div className="mb-3 bg-[#0a1020] rounded-lg p-3 border border-cyan-400/20 max-h-60 overflow-y-auto scroll-cyan">
          <div className="text-[10px] tracking-wider text-[#7c89b5] mb-2">
            SELF-HEAL: {healResult.action} → {healResult.overall?.toUpperCase()}
          </div>
          <div className="text-[10px] text-[#9bb5d4] mb-2">{healResult.summary}</div>
          <div className="space-y-1">
            {healResult.results?.slice(0, 8).map((r: any, i: number) => (
              <div key={i} className="flex items-start gap-2 text-[10px]">
                <span className={
                  r.status === 'pass' ? 'text-emerald-300' :
                  r.status === 'warn' ? 'text-amber-300' :
                  'text-pink-300'
                }>
                  {r.status === 'pass' ? '✓' : r.status === 'warn' ? '⚠' : '✗'}
                </span>
                <span className="text-[#cfd9f0]">{r.step}:</span>
                <span className="text-[#7c89b5]">{r.detail}</span>
              </div>
            ))}
            {healResult.results?.length > 8 && (
              <div className="text-[10px] text-[#5b6a92]">... and {healResult.results.length - 8} more</div>
            )}
          </div>
        </div>
      )}

      {/* Comms result */}
      {commsResult && (
        <div className="mb-3 bg-[#0a1020] rounded-lg p-3 border border-purple-400/20">
          <div className="text-[10px] tracking-wider text-[#7c89b5] mb-2">
            COMMUNICATION TEST: {commsResult.overall?.toUpperCase()}
          </div>
          <div className="space-y-1">
            {commsResult.results?.map((r: any, i: number) => (
              <div key={i} className="flex items-start gap-2 text-[10px]">
                <span className={
                  r.status === 'pass' ? 'text-emerald-300' :
                  r.status === 'warn' ? 'text-amber-300' :
                  'text-pink-300'
                }>
                  {r.status === 'pass' ? '✓' : r.status === 'warn' ? '⚠' : '✗'}
                </span>
                <span className="text-cyan-300 font-mono">{r.channel}:</span>
                <span className="text-[#9bb5d4]">{r.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expanded view — full upgrade manifest */}
      {expanded && manifest && (
        <div className="bg-[#0a1020] rounded-lg p-3 border border-emerald-400/20 max-h-80 overflow-y-auto scroll-cyan">
          <div className="text-[10px] tracking-wider text-[#7c89b5] mb-2">
            PERMANENT UPGRADE MANIFEST ({manifest.totalUpgrades} upgrades)
          </div>
          <div className="space-y-1.5">
            {manifest.upgrades?.map((u: any) => (
              <div key={u.id} className="text-[10px] border-l-2 border-emerald-400/30 pl-2">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-400/10 text-emerald-300 tracking-wider uppercase">
                    {u.category}
                  </span>
                  <span className="text-[#e0e7ff] font-semibold">{u.title}</span>
                </div>
                <div className="text-[#7c89b5] mt-0.5">{u.description}</div>
                <div className="text-[#5b6a92] mt-0.5">Applied: {u.dateApplied} • {u.files?.length ?? 0} files</div>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-2 border-t border-emerald-400/15 text-[10px] text-[#9bb5d4]">
            <ShieldCheck className="w-3 h-3 inline mr-1 text-emerald-300" />
            All upgrades are <strong className="text-emerald-300">PERMANENT</strong>. Reset/delete operations require owner 2FA (SMS, TOTP, WhatsApp, or Email).
            Tell Agent007: <em>&quot;view manifest&quot;</em>, <em>&quot;run self-heal full_repair&quot;</em>, or <em>&quot;setup TOTP&quot;</em>.
          </div>
        </div>
      )}
    </div>
  )
}
