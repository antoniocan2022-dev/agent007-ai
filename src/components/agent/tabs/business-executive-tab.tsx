'use client'

import { useEffect, useMemo, useState } from 'react'
import { Activity, ArrowUpRight, BriefcaseBusiness, CircleAlert, RefreshCw, TrendingUp } from 'lucide-react'

type Business = {
  id?: string
  name?: string
  type?: string
  description?: string
  lifecycle?: string
  monthlyRevenue?: number
  monthlyCost?: number
  netRevenue?: number
  roi?: number
  customers?: number
  automationLevel?: number
  brandScore?: number
  launchedAt?: string | null
}

type EnterpriseValue = {
  score?: number
  total?: number
  dimensions?: Record<string, number>
}

const money = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 })

export function BusinessExecutiveTab() {
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [enterpriseValue, setEnterpriseValue] = useState<EnterpriseValue | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [portfolioResponse, valueResponse] = await Promise.all([
        fetch('/api/system/portfolio', { cache: 'no-store' }),
        fetch('/api/system/portfolio?value=true', { cache: 'no-store' }),
      ])
      if (!portfolioResponse.ok || !valueResponse.ok) throw new Error('Business portfolio data is unavailable.')
      const portfolio = await portfolioResponse.json()
      const value = await valueResponse.json()
      setBusinesses(Array.isArray(portfolio.businesses) ? portfolio.businesses : [])
      setEnterpriseValue(value)
      setUpdatedAt(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load business data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 30000)
    return () => window.clearInterval(timer)
  }, [])

  const active = useMemo(() => businesses.filter((b) => b.lifecycle !== 'retired'), [businesses])
  const revenue = active.reduce((sum, b) => sum + Number(b.monthlyRevenue || 0), 0)
  const cost = active.reduce((sum, b) => sum + Number(b.monthlyCost || 0), 0)
  const customers = active.reduce((sum, b) => sum + Number(b.customers || 0), 0)
  const avgRoi = active.length ? active.reduce((sum, b) => sum + Number(b.roi || 0), 0) / active.length : 0

  return (
    <section className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5" aria-label="Business portfolio">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-cyan-200 text-xs uppercase tracking-[0.18em]"><BriefcaseBusiness className="w-4 h-4" /> Businesses</div>
          <h2 className="mt-1 text-xl sm:text-2xl font-semibold text-[#e8edff]">Business Portfolio</h2>
          <p className="mt-1 text-xs sm:text-sm text-[#7c89b5]">Live portfolio data, enterprise value and business health.</p>
        </div>
        <button onClick={() => void load()} disabled={loading} className="h-9 px-3 rounded-lg glass border-cyan-400/20 text-cyan-200 text-xs flex items-center gap-2 disabled:opacity-50" title="Refresh business data">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-4 text-sm text-amber-100 flex gap-2"><CircleAlert className="w-4 h-4 shrink-0 mt-0.5" />{error}</div>}

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
        <Metric label="Active businesses" value={active.length.toString()} />
        <Metric label="Monthly revenue" value={money.format(revenue)} />
        <Metric label="Monthly cost" value={money.format(cost)} />
        <Metric label="Customers" value={customers.toLocaleString('en-CA')} />
        <Metric label="Avg. ROI" value={`${avgRoi.toFixed(1)}%`} />
      </div>

      <div className="grid xl:grid-cols-[1.4fr_.8fr] gap-4">
        <div className="rounded-2xl glass border border-cyan-400/15 overflow-hidden">
          <div className="px-4 py-3 border-b border-cyan-400/10 flex items-center justify-between">
            <span className="text-sm font-semibold text-[#dfe7ff]">Portfolio</span>
            <span className="text-[10px] text-[#5b6a92]">{updatedAt ? `Updated ${updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Loading'}</span>
          </div>
          {loading && businesses.length === 0 ? <div className="p-8 text-center text-xs text-[#7c89b5]">Loading live portfolio…</div> : active.length === 0 ? <div className="p-8 text-center text-xs text-[#7c89b5]">No active businesses yet.</div> : (
            <div className="divide-y divide-cyan-400/10">
              {active.map((business) => <BusinessRow key={business.id || business.name} business={business} />)}
            </div>
          )}
        </div>

        <div className="rounded-2xl glass border border-cyan-400/15 p-4 space-y-4">
          <div className="flex items-center gap-2"><TrendingUp className="w-4 h-4 text-cyan-300" /><span className="text-sm font-semibold text-[#dfe7ff]">Enterprise Value</span></div>
          <div className="text-3xl font-semibold text-cyan-200">{typeof enterpriseValue?.score === 'number' ? enterpriseValue.score.toFixed(1) : '—'}<span className="text-sm text-[#7c89b5]"> / 100</span></div>
          <div className="space-y-2">
            {Object.entries(enterpriseValue?.dimensions || {}).slice(0, 7).map(([name, value]) => (
              <div key={name}>
                <div className="flex justify-between text-[10px] text-[#7c89b5]"><span>{name}</span><span>{Number(value).toFixed(0)}</span></div>
                <div className="h-1.5 mt-1 rounded-full bg-white/5 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-purple-500" style={{ width: `${Math.max(0, Math.min(100, Number(value)))}%` }} /></div>
              </div>
            ))}
            {!Object.keys(enterpriseValue?.dimensions || {}).length && <div className="text-xs text-[#7c89b5]">Enterprise-value dimensions will appear when portfolio data is available.</div>}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-cyan-400/10 bg-cyan-400/[0.03] p-3 text-[11px] text-[#7181aa] flex gap-2"><Activity className="w-3.5 h-3.5 text-cyan-300 shrink-0" /> Metrics on this screen come from the live portfolio APIs. No projected revenue is presented as actual revenue.</div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl glass border border-cyan-400/10 p-3"><div className="text-[10px] uppercase tracking-wider text-[#5b6a92]">{label}</div><div className="mt-1 text-base sm:text-lg font-semibold text-[#e5ebff] truncate">{value}</div></div>
}

function BusinessRow({ business }: { business: Business }) {
  const revenue = Number(business.monthlyRevenue || 0)
  const roi = Number(business.roi || 0)
  const lifecycle = business.lifecycle || 'proposed'
  return <div className="px-4 py-3 flex items-center gap-3">
    <div className="w-8 h-8 rounded-lg bg-cyan-400/10 border border-cyan-400/20 flex items-center justify-center text-cyan-200"><BriefcaseBusiness className="w-4 h-4" /></div>
    <div className="min-w-0 flex-1"><div className="text-sm font-medium text-[#e2e8ff] truncate">{business.name || 'Unnamed business'}</div><div className="text-[10px] text-[#68779f] truncate">{business.type || 'Business'} • {lifecycle}</div></div>
    <div className="hidden sm:block text-right"><div className="text-xs text-[#cbd6ee]">{money.format(revenue)} / mo</div><div className={`text-[10px] ${roi >= 0 ? 'text-emerald-300' : 'text-amber-300'}`}>{roi.toFixed(1)}% ROI</div></div>
    <ArrowUpRight className="w-3.5 h-3.5 text-[#526184]" />
  </div>
}
