'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, CircleDollarSign, Rocket, ShieldCheck, Target } from 'lucide-react'

type Mission = {
  stage: string
  goal: string
  nextAction: string
  blockers: string[]
  verifiedRevenue: number
  customerCount: number
  opportunityCount: number
  serviceCount: number
}

type Business = {
  id?: string
  name?: string
  lifecycle?: string
  monthlyRevenue?: number
  customers?: number
}

const money = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 2 })

const stageLabels: Record<string, string> = {
  opportunity: 'Opportunity',
  offer: 'Offer',
  acquisition: 'Acquisition',
  sale: 'Sale',
  fulfillment: 'Fulfillment',
  verified_revenue: 'Verified Revenue',
  learning: 'Learning',
}

export function RevenueOperatingSystem({ businesses }: { businesses: Business[] }) {
  const [mission, setMission] = useState<Mission | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void loadMission()
  }, [])

  async function loadMission() {
    try {
      const response = await fetch('/api/first-revenue', { cache: 'no-store' })
      const data = await response.json()
      if (data?.ok) setMission(data.mission)
    } catch {
      // The surrounding CEO page remains usable if the mission API is temporarily unavailable.
    }
  }

  async function initializeMission() {
    setRunning(true)
    setError('')
    try {
      const response = await fetch('/api/first-revenue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'initialize' }),
      })
      const data = await response.json()
      if (!response.ok || !data?.ok) throw new Error(data?.error || 'Unable to initialize the revenue mission.')
      setMission(data.mission)
    } catch (e: any) {
      setError(e?.message || 'Unable to initialize the revenue mission.')
    } finally {
      setRunning(false)
    }
  }

  const fallbackRevenue = businesses
    .filter((b) => b.lifecycle !== 'retired')
    .reduce((sum, b) => sum + Number(b.monthlyRevenue || 0), 0)

  const verifiedRevenue = mission?.verifiedRevenue ?? 0
  const revenueDisplay = mission ? money.format(verifiedRevenue) : money.format(fallbackRevenue)

  return (
    <section className="rounded-2xl glass border border-cyan-400/15 p-4 sm:p-5 space-y-5" aria-label="First verified revenue mission">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-cyan-200 text-xs uppercase tracking-[0.18em]"><CircleDollarSign className="w-4 h-4" /> Revenue Operating System</div>
          <h3 className="mt-1 text-lg sm:text-xl font-semibold text-[#e8edff]">CEO priority: first verified $1</h3>
          <p className="mt-1 max-w-3xl text-xs sm:text-sm text-[#7c89b5]">One offer, one customer acquisition loop, one verified payment. Projections and agent-generated amounts never count as revenue.</p>
        </div>
        <button onClick={() => void initializeMission()} disabled={running} className="h-9 shrink-0 px-3 rounded-lg bg-cyan-400/10 border border-cyan-400/25 text-cyan-100 text-xs flex items-center gap-2 disabled:opacity-50">
          <Rocket className={`w-3.5 h-3.5 ${running ? 'animate-pulse' : ''}`} /> {running ? 'Initializing…' : 'Start revenue mission'}
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-2 text-xs text-red-200">{error}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric icon={<CircleDollarSign className="w-3.5 h-3.5" />} label="Verified revenue" value={revenueDisplay} />
        <Metric icon={<Target className="w-3.5 h-3.5" />} label="Current stage" value={mission ? (stageLabels[mission.stage] || mission.stage) : 'Not initialized'} />
        <Metric icon={<CheckCircle2 className="w-3.5 h-3.5" />} label="Customers" value={String(mission?.customerCount ?? 0)} />
        <Metric icon={<ShieldCheck className="w-3.5 h-3.5" />} label="Revenue truth" value="Processor verified" />
      </div>

      {mission ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-cyan-400/10 bg-white/[0.015] p-3">
            <div className="text-[10px] uppercase tracking-wider text-[#5b6a92]">Next action</div>
            <div className="mt-1 text-sm text-[#e1e8ff]">{mission.nextAction}</div>
          </div>

          <div className="grid sm:grid-cols-3 gap-2">
            <SmallStat label="Opportunities" value={mission.opportunityCount} />
            <SmallStat label="Active offers" value={mission.serviceCount} />
            <SmallStat label="Verified revenue" value={money.format(mission.verifiedRevenue)} />
          </div>

          {mission.blockers.length > 0 && (
            <div className="rounded-xl border border-amber-400/10 bg-amber-400/[0.025] p-3">
              <div className="text-[10px] uppercase tracking-wider text-amber-200/70">What must happen next</div>
              <ul className="mt-1 space-y-1 text-xs text-[#aab5d4]">
                {mission.blockers.map((blocker) => <li key={blocker}>• {blocker}</li>)}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-cyan-400/10 bg-white/[0.015] p-4 text-xs text-[#7c89b5]">The first-revenue engine is ready. Start the mission to create the initial opportunity, offer, and strategy records.</div>
      )}

      <div className="text-[10px] text-[#61709a] flex items-start gap-2"><ShieldCheck className="w-3.5 h-3.5 text-cyan-300 shrink-0" />Revenue is verified only from successful transaction records. The mission engine does not create fake revenue, fake customers, or simulated payments.</div>
    </section>
  )
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="rounded-xl glass border border-cyan-400/10 p-3"><div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[#5b6a92]">{icon}{label}</div><div className="mt-1 text-base font-semibold text-[#e5ebff] truncate">{value}</div></div>
}

function SmallStat({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl border border-cyan-400/10 bg-white/[0.015] p-3"><div className="text-[10px] text-[#5b6a92]">{label}</div><div className="mt-1 text-sm font-semibold text-[#e5ebff]">{value}</div></div>
}
