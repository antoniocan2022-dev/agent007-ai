'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, CircleAlert, CircleDollarSign, RefreshCw, Target, TrendingUp } from 'lucide-react'

type Reality = Record<string, unknown>

type EnterpriseValue = {
  score?: number
  dimensions?: Record<string, number>
}

const money = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  maximumFractionDigits: 0,
})

function numberFrom(source: Record<string, unknown> | null, keys: string[]) {
  if (!source) return null
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const parsed = Number(value.replace(/[$,]/g, ''))
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

export function FinanceExecutiveTab() {
  const [reality, setReality] = useState<Reality | null>(null)
  const [enterpriseValue, setEnterpriseValue] = useState<EnterpriseValue | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [realityResponse, valueResponse] = await Promise.all([
        fetch('/api/reality-check', { cache: 'no-store' }),
        fetch('/api/system/portfolio?value=true', { cache: 'no-store' }),
      ])
      if (!realityResponse.ok || !valueResponse.ok) {
        throw new Error('Finance data is temporarily unavailable.')
      }
      const [realityData, valueData] = await Promise.all([
        realityResponse.json(),
        valueResponse.json(),
      ])
      setReality(realityData && typeof realityData === 'object' ? realityData : {})
      setEnterpriseValue(valueData && typeof valueData === 'object' ? valueData : {})
      setUpdatedAt(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load finance data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 30000)
    return () => window.clearInterval(timer)
  }, [load])

  const root = reality && typeof reality === 'object' ? reality : null
  const income = root && typeof root.income === 'object' && root.income !== null ? root.income as Record<string, unknown> : root
  const realIncome = numberFrom(income, ['realIncome', 'real', 'real_income'])
  const projectedIncome = numberFrom(income, ['projectedIncome', 'projected', 'autoParsed', 'autoParsedIncome'])
  const targetIncome = numberFrom(income, ['target', 'targetIncome', 'monthlyTarget'])
  const realVsTarget = realIncome !== null && targetIncome && targetIncome > 0 ? Math.min(100, Math.max(0, (realIncome / targetIncome) * 100)) : null
  const dimensionEntries = useMemo(() => Object.entries(enterpriseValue?.dimensions || {}).slice(0, 7), [enterpriseValue])

  return (
    <section className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5" aria-label="Finance and analytics">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-cyan-200 text-xs uppercase tracking-[0.18em]"><CircleDollarSign className="w-4 h-4" /> Finance & Analytics</div>
          <h2 className="mt-1 text-xl sm:text-2xl font-semibold text-[#e8edff]">Executive Financial Control</h2>
          <p className="mt-1 text-xs sm:text-sm text-[#7c89b5]">Real money first. Projections remain clearly separated from verified income.</p>
        </div>
        <button onClick={() => void load()} disabled={loading} className="h-9 px-3 rounded-lg glass border-cyan-400/20 text-cyan-200 text-xs flex items-center gap-2 disabled:opacity-50" title="Refresh financial data"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
      </div>

      {error && <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-4 text-sm text-amber-100 flex gap-2"><CircleAlert className="w-4 h-4 shrink-0 mt-0.5" />{error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <FinancialCard label="REAL income" value={realIncome === null ? '—' : money.format(realIncome)} tone="real" hint="Externally verified / accounting source" />
        <FinancialCard label="Projected / auto-parsed" value={projectedIncome === null ? '—' : money.format(projectedIncome)} tone="projected" hint="Never counted as verified cash" />
        <FinancialCard label="Monthly target" value={targetIncome === null ? '—' : money.format(targetIncome)} tone="target" hint="Strategic target, not revenue" />
      </div>

      <div className="grid xl:grid-cols-[1.25fr_.75fr] gap-4">
        <div className="rounded-2xl glass border border-cyan-400/15 p-4 sm:p-5 space-y-5">
          <div className="flex items-center gap-2"><TrendingUp className="w-4 h-4 text-cyan-300" /><span className="text-sm font-semibold text-[#dfe7ff]">Verified revenue progress</span></div>
          {realVsTarget === null ? <div className="rounded-xl border border-cyan-400/10 bg-white/[0.02] p-4 text-xs text-[#7c89b5]">A verified income and target pair is required before a progress percentage is shown.</div> : <>
            <div className="flex items-end justify-between"><span className="text-3xl font-semibold text-cyan-200">{realVsTarget.toFixed(1)}%</span><span className="text-xs text-[#7c89b5]">REAL / target</span></div>
            <div className="h-3 rounded-full bg-white/5 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-purple-500" style={{ width: `${realVsTarget}%` }} /></div>
          </>}
          <div className="grid sm:grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl border border-emerald-400/15 bg-emerald-400/[0.03] p-3"><div className="text-emerald-200 font-semibold">What counts as real</div><p className="mt-1 text-[#7c89b5]">A transaction must be externally verified and reconciled before it becomes REAL revenue.</p></div>
            <div className="rounded-xl border border-amber-400/15 bg-amber-400/[0.03] p-3"><div className="text-amber-200 font-semibold">What does not</div><p className="mt-1 text-[#7c89b5]">Agent-generated estimates, goals and auto-parsed text stay outside REAL cash.</p></div>
          </div>
        </div>

        <div className="rounded-2xl glass border border-cyan-400/15 p-4 sm:p-5 space-y-4">
          <div className="flex items-center gap-2"><Target className="w-4 h-4 text-cyan-300" /><span className="text-sm font-semibold text-[#dfe7ff]">Enterprise Value</span></div>
          <div className="text-3xl font-semibold text-cyan-200">{typeof enterpriseValue?.score === 'number' ? enterpriseValue.score.toFixed(1) : '—'}<span className="text-sm text-[#7c89b5]"> / 100</span></div>
          <div className="space-y-2">
            {dimensionEntries.map(([name, value]) => <div key={name}><div className="flex justify-between text-[10px] text-[#7c89b5]"><span>{name}</span><span>{Number(value).toFixed(0)}</span></div><div className="h-1.5 mt-1 rounded-full bg-white/5 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-purple-500" style={{ width: `${Math.max(0, Math.min(100, Number(value)))}%` }} /></div></div>)}
            {!dimensionEntries.length && <div className="text-xs text-[#7c89b5]">Enterprise-value dimensions will appear when portfolio data is available.</div>}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-cyan-400/10 bg-cyan-400/[0.03] p-3 text-[11px] text-[#7181aa] flex gap-2"><Activity className="w-3.5 h-3.5 text-cyan-300 shrink-0" /> Live source: the existing Reality Check and Portfolio APIs. {updatedAt ? `Last updated ${updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : ''}</div>
    </section>
  )
}

function FinancialCard({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: 'real' | 'projected' | 'target' }) {
  const toneClass = tone === 'real' ? 'text-emerald-200 border-emerald-400/15' : tone === 'projected' ? 'text-amber-200 border-amber-400/15' : 'text-cyan-200 border-cyan-400/15'
  return <div className={`rounded-2xl glass border p-4 ${toneClass}`}><div className="text-[10px] uppercase tracking-[0.16em] text-[#7c89b5]">{label}</div><div className="mt-2 text-2xl font-semibold">{value}</div><div className="mt-1 text-[10px] text-[#5f6e94]">{hint}</div></div>
}
