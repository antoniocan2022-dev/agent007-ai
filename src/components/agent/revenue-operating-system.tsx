'use client'

import { useMemo, useState } from 'react'
import { ArrowRight, CheckCircle2, CircleDollarSign, Rocket, ShieldCheck, Target, Zap } from 'lucide-react'

type Business = {
  id?: string
  name?: string
  lifecycle?: string
  monthlyRevenue?: number
  monthlyCost?: number
  customers?: number
  roi?: number
}

const money = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 })

const stages = [
  ['Opportunity', 'Find a painful problem with reachable demand.'],
  ['Validation', 'Prove demand before spending time or money.'],
  ['Offer', 'Package a clear outcome people can buy.'],
  ['Acquisition', 'Reach qualified prospects and start conversations.'],
  ['Sale', 'Convert interest into a verified transaction.'],
  ['Fulfillment', 'Deliver the promised outcome reliably.'],
  ['Verified Revenue', 'Count only processor-confirmed or otherwise verifiable cash.'],
  ['Learning', 'Use results to scale, fix, or kill the business.'],
] as const

const milestones = [1, 100, 1000, 5000, 10000, 20000]

export function RevenueOperatingSystem({ businesses }: { businesses: Business[] }) {
  const [mission, setMission] = useState<string>('')
  const [running, setRunning] = useState(false)

  const active = useMemo(() => businesses.filter((b) => b.lifecycle !== 'retired'), [businesses])
  const portfolioRevenue = active.reduce((sum, b) => sum + Number(b.monthlyRevenue || 0), 0)
  const customers = active.reduce((sum, b) => sum + Number(b.customers || 0), 0)
  const nextMilestone = milestones.find((m) => portfolioRevenue < m) ?? 20000

  async function generateRevenueMission() {
    setRunning(true)
    try {
      const response = await fetch('/api/reality-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tool: 'mission_action_tick', action: 'plan' }),
      })
      const data = await response.json()
      setMission(data?.result || data?.preview || 'Revenue mission plan is unavailable.')
    } catch {
      setMission('Unable to generate the revenue mission plan. The existing mission endpoint may be unavailable.')
    } finally {
      setRunning(false)
    }
  }

  return (
    <section className="rounded-2xl glass border border-cyan-400/15 p-4 sm:p-5 space-y-5" aria-label="Revenue operating system">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-cyan-200 text-xs uppercase tracking-[0.18em]"><CircleDollarSign className="w-4 h-4" /> Revenue Operating System</div>
          <h3 className="mt-1 text-lg sm:text-xl font-semibold text-[#e8edff]">CEO priority: produce verified revenue</h3>
          <p className="mt-1 max-w-3xl text-xs sm:text-sm text-[#7c89b5]">Agent007 should optimize for the next highest-probability revenue action, not for more tools, more reports, or unverified projections.</p>
        </div>
        <button onClick={() => void generateRevenueMission()} disabled={running} className="h-9 shrink-0 px-3 rounded-lg bg-cyan-400/10 border border-cyan-400/25 text-cyan-100 text-xs flex items-center gap-2 disabled:opacity-50">
          <Rocket className={`w-3.5 h-3.5 ${running ? 'animate-pulse' : ''}`} /> {running ? 'Generating…' : 'Generate revenue mission'}
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric icon={<CircleDollarSign className="w-3.5 h-3.5" />} label="Portfolio revenue" value={money.format(portfolioRevenue)} />
        <Metric icon={<Target className="w-3.5 h-3.5" />} label="Next milestone" value={money.format(nextMilestone)} />
        <Metric icon={<CheckCircle2 className="w-3.5 h-3.5" />} label="Customers" value={customers.toLocaleString('en-CA')} />
        <Metric icon={<ShieldCheck className="w-3.5 h-3.5" />} label="Revenue truth" value="Verified only" />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2"><span className="text-xs font-semibold text-[#dfe7ff]">Revenue loop</span><span className="text-[10px] text-[#5b6a92]">Opportunity → cash → learning</span></div>
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-2">
          {stages.map(([name, description], index) => (
            <div key={name} className="rounded-xl border border-cyan-400/10 bg-white/[0.015] p-3 min-h-[86px]">
              <div className="flex items-center gap-2"><span className="w-5 h-5 rounded-full border border-cyan-400/20 text-[9px] flex items-center justify-center text-cyan-200">{index + 1}</span><span className="text-xs font-medium text-[#e1e8ff]">{name}</span></div>
              <p className="mt-2 text-[10px] leading-4 text-[#68779f]">{description}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-cyan-400/10 bg-cyan-400/[0.025] p-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#dfe7ff]"><Zap className="w-3.5 h-3.5 text-cyan-300" /> Revenue milestones</div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {milestones.map((amount, index) => <div key={amount} className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] border ${portfolioRevenue >= amount ? 'border-emerald-400/25 bg-emerald-400/5 text-emerald-200' : 'border-white/10 text-[#7181aa]'}`}><span>{portfolioRevenue >= amount ? '✓' : index + 1}</span>{money.format(amount)}{index < milestones.length - 1 && <ArrowRight className="w-3 h-3 opacity-40" />}</div>)}
        </div>
      </div>

      {mission && <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-cyan-400/10 bg-black/20 p-3 text-[10px] leading-4 text-[#9bb5d4]">{mission}</pre>}

      <div className="text-[10px] text-[#61709a] flex items-start gap-2"><ShieldCheck className="w-3.5 h-3.5 text-cyan-300 shrink-0" />No projected or auto-parsed amount is treated as cash by this surface. The revenue mission button requests the existing action-plan endpoint; it does not falsely claim that the plan has already executed.</div>
    </section>
  )
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="rounded-xl glass border border-cyan-400/10 p-3"><div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[#5b6a92]">{icon}{label}</div><div className="mt-1 text-base font-semibold text-[#e5ebff] truncate">{value}</div></div>
}
