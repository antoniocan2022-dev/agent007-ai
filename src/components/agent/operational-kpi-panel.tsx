'use client'

import { useCallback, useEffect, useState } from 'react'
import { Activity, RefreshCw, Target, WalletCards } from 'lucide-react'
import type { OperationalKpiSnapshot } from '@/lib/operational-kpis'

const money = (value: number) => `$${Math.round(value).toLocaleString('en-CA')}`
const percent = (value: number | null) => value === null ? '—' : `${value.toFixed(1)}%`

export function OperationalKpiPanel() {
  const [data, setData] = useState<OperationalKpiSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/operational-kpis', { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok || !payload?.ok) throw new Error(payload?.error ?? 'Operational KPI data is unavailable.')
      setData(payload.kpis as OperationalKpiSnapshot)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load operational KPIs.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 30000)
    return () => window.clearInterval(timer)
  }, [load])

  return (
    <section className="rounded-2xl glass border border-cyan-400/15 p-4 sm:p-5 space-y-4" aria-label="Operational KPIs">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-300" />
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-cyan-200">Operational KPIs</div>
            <div className="text-sm font-semibold text-[#dfe7ff]">Calculated from persisted system facts</div>
          </div>
        </div>
        <button onClick={() => void load()} disabled={loading} className="h-8 px-2.5 rounded-lg glass border-cyan-400/20 text-cyan-200 text-[10px] flex items-center gap-1.5 disabled:opacity-50" title="Refresh operational KPIs">
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />Refresh
        </button>
      </div>

      {error && <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.03] p-3 text-xs text-amber-100">{error}</div>}
      {!data && loading && <div className="text-xs text-[#7c89b5]">Calculating from persisted mission telemetry, portfolio records and verified-income evidence…</div>}

      {data && <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Kpi label="Active missions" value={String(data.missions.active)} hint={`${data.missions.total} persisted`} />
          <Kpi label="Mission success" value={percent(data.missions.successRate)} hint={`${data.missions.completed} completed / ${data.missions.failed} failed`} />
          <Kpi label="Active ventures" value={String(data.ventures.active)} hint={`${data.ventures.scaling} scaling`} />
          <Kpi label="Portfolio MRR" value={money(data.ventures.portfolioMrr)} hint="Reference venture excluded" />
          <Kpi label="30d real revenue" value={money(data.commercial.revenue30d)} hint={`${data.commercial.transactions30d} verified entries`} />
          <Kpi label="Monthly net" value={money(data.ventures.monthlyNetRevenue)} hint={`${money(data.ventures.monthlyCost)} active-venture cost`} />
          <Kpi label="Portfolio health" value={percent(data.ventures.averageHealth)} hint={`${percent(data.ventures.averageAutomation)} automation`} />
          <Kpi label="Open opportunities" value={String(data.commercial.openOpportunities)} hint="Operational pipeline records" />
        </div>

        <div className="grid xl:grid-cols-2 gap-3">
          <div className="rounded-xl border border-cyan-400/10 bg-white/[0.02] p-3">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-[#7181aa]"><WalletCards className="w-3.5 h-3.5" /> Commercial reality</div>
            <div className="grid grid-cols-3 gap-2 mt-2 text-center">
              <Mini label="Customers" value={String(data.commercial.customers)} />
              <Mini label="30d transactions" value={String(data.commercial.transactions30d)} />
              <Mini label="Avg ROI" value={data.ventures.averageRoi === null ? '—' : `${data.ventures.averageRoi.toFixed(1)}%`} />
            </div>
          </div>
          <div className="rounded-xl border border-purple-400/10 bg-white/[0.02] p-3">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-[#7181aa]"><Target className="w-3.5 h-3.5" /> Venture 001 reference</div>
            {data.referenceVenture001.exists ? <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              <Mini label="Lifecycle" value={data.referenceVenture001.lifecycle ?? '—'} />
              <Mini label="Score" value={data.referenceVenture001.ventureScore === null ? 'Pending evidence' : `${data.referenceVenture001.ventureScore}/100`} />
              <Mini label="MRR" value={money(data.referenceVenture001.monthlyRevenue)} />
            </div> : <div className="mt-2 text-xs text-[#7c89b5]">Reference implementation is available but not initialized. No synthetic performance is counted in the operational KPIs.</div>}
          </div>
        </div>

        <div className="text-[10px] text-[#5f6e94]">KPI engine v{data.version} · rolling {data.windowDays}d revenue window · as of {new Date(data.asOf).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      </>}
    </section>
  )
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <div className="rounded-xl border border-cyan-400/10 bg-white/[0.02] p-3"><div className="text-[9px] uppercase tracking-[0.12em] text-[#7181aa]">{label}</div><div className="mt-1 text-lg font-semibold text-[#dfe7ff]">{value}</div><div className="mt-1 text-[9px] text-[#5f6e94]">{hint}</div></div>
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[9px] text-[#5f6e94]">{label}</div><div className="text-sm font-semibold text-[#cfd9f0] mt-0.5">{value}</div></div>
}
