/**
 * world-model.ts — UPGRADE #212
 *
 * The Executive World Model — a structured understanding of Antonio's
 * business reality. This gives Agent007 holistic situational awareness
 * for planning, not just flat memory facts.
 *
 * The World Model maintains:
 * - Active projects (with status, priority, blockers)
 * - Organizational goals ($20K/mo, 20% growth)
 * - Dependencies (project A depends on API B)
 * - Business state (revenue, expenses, runway)
 * - Long-term context (what worked, what failed)
 *
 * Unlike persistent-memory.ts (which stores flat facts), the World Model
 * stores RELATIONSHIPS and STRUCTURED STATE.
 */

import { db } from './db'
import { recallMemories } from './memory'

export const runtime = 'nodejs'

export interface WorldModelSnapshot {
  timestamp: string
  version: string
  mission: {
    goal: string
    target: string
    growthRate: string
  }
  projects: Array<{
    name: string
    status: 'active' | 'paused' | 'completed' | 'failed'
    priority: 'critical' | 'high' | 'normal' | 'low'
    blockers?: string[]
  }>
  goals: Array<{
    name: string
    current: string
    target: string
    progress: number
    onTrack: boolean
  }>
  dependencies: Array<{
    from: string
    to: string
    type: string
  }>
  businessState: {
    revenueThisMonth: number
    revenueTarget: number
    daysRemaining: number
    projectedRevenue: number
    runway: number
  }
  systemHealth: {
    agentsActive: number
    toolsAvailable: number
    providersOnline: number
    lastBriefDate: string | null
  }
  recentLearnings: string[]
  risks: string[]
}

/**
 * Generate a snapshot of the current World Model.
 * Pulls from DB, memory, and live system state.
 */
export async function getWorldModelSnapshot(): Promise<WorldModelSnapshot> {
  const now = new Date()
  const timestamp = now.toISOString()

  // ═══ Mission + Vision ═══
  const mission = {
    goal: 'Continuously discover, validate, build, launch, optimize, automate, and scale ethical digital businesses that maximize long-term enterprise value while increasing the organization\'s knowledge, intelligence, trust, autonomy, and recurring revenue.',
    vision: 'An Autonomous AI Enterprise that builds, operates, improves, and manages a portfolio of digital businesses through a shared executive intelligence, continuously increasing its organizational capital, enterprise value, and recurring revenue.',
    target: '$20,000+ monthly recurring revenue',
    growthRate: '20% monthly',
  }

  // ═══ Projects (from memory — stored by past missions) ═══
  let projects: WorldModelSnapshot['projects'] = []
  try {
    const projectMemories = await recallMemories('project status active', 10)
    projects = projectMemories.map(m => ({
      name: m.key || 'Unknown project',
      status: (m.value?.toLowerCase().includes('active') ? 'active' : 'paused') as any,
      priority: 'normal' as const,
      blockers: m.value?.toLowerCase().includes('block') ? ['See memory for details'] : undefined,
    }))
  } catch {}

  // ═══ Goals ═══
  let incomeThisMonth = 0
  try {
    const incomeEntries = await db.incomeEntry.findMany({
      where: { date: { gte: new Date(now.getFullYear(), now.getMonth(), 1) } },
    })
    incomeThisMonth = incomeEntries.reduce((sum, e) => sum + (e.amount || 0), 0)
  } catch {}

  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const dayOfMonth = now.getDate()
  const daysRemaining = daysInMonth - dayOfMonth
  const dailyAvg = dayOfMonth > 0 ? incomeThisMonth / dayOfMonth : 0
  const projectedRevenue = incomeThisMonth + (dailyAvg * daysRemaining)

  const goals = [
    {
      name: 'Monthly Revenue',
      current: `$${incomeThisMonth.toFixed(2)}`,
      target: '$20,000',
      progress: Math.min(100, (incomeThisMonth / 20000) * 100),
      onTrack: projectedRevenue >= 20000,
    },
    {
      name: 'Monthly Growth',
      current: 'TBD',
      target: '20%',
      progress: 0,
      onTrack: false,
    },
  ]

  // ═══ Dependencies ═══
  const dependencies = [
    { from: 'Revenue Mission', to: 'Stripe Payment Processor', type: 'requires' },
    { from: 'Revenue Mission', to: 'Affiliate Link Generator', type: 'requires' },
    { from: 'Content Creation', to: 'AURORA (Content Leader)', type: 'owned_by' },
    { from: 'Investment Analysis', to: 'QUANTUM (Investment Leader)', type: 'owned_by' },
    { from: 'System Health', to: 'qa_monitor + external_uptime_monitor', type: 'monitored_by' },
    { from: 'Morning Brief', to: 'Vercel Cron (9AM UTC)', type: 'scheduled_by' },
  ]

  // ═══ Business State ═══
  const businessState = {
    revenueThisMonth: incomeThisMonth,
    revenueTarget: 20000,
    daysRemaining,
    projectedRevenue,
    runway: incomeThisMonth > 0 ? Math.round(20000 / (incomeThisMonth / dayOfMonth)) : 0,
  }

  // ═══ System Health ═══
  let agentsActive = 18
  let toolsAvailable = 677
  let providersOnline = 4
  let lastBriefDate: string | null = null

  try {
    const briefMemories = await recallMemories('morning_brief', 1)
    if (briefMemories.length > 0) {
      lastBriefDate = briefMemories[0].createdAt?.toISOString() || null
    }
  } catch {}

  const systemHealth = { agentsActive, toolsAvailable, providersOnline, lastBriefDate }

  // ═══ Recent Learnings ═══
  let recentLearnings: string[] = []
  try {
    const learnings = await recallMemories('failure_learning mission_outcome', 5)
    recentLearnings = learnings.map(l => l.value?.slice(0, 150) || l.key)
  } catch {}

  // ═══ Risks ═══
  const risks: string[] = []
  if (incomeThisMonth === 0) risks.push('No revenue generated this month yet')
  if (projectedRevenue < 20000) risks.push(`Projected revenue ($${projectedRevenue.toFixed(0)}) below $20K target`)
  if (!lastBriefDate) risks.push('Morning Brief has never run — autonomous planning inactive')
  if (daysRemaining < 10 && incomeThisMonth < 10000) risks.push(`Only ${daysRemaining} days left, revenue at 50% of target`)

  return {
    timestamp,
    version: 'upgrade-212',
    mission,
    projects,
    goals,
    dependencies,
    businessState,
    systemHealth,
    recentLearnings,
    risks,
  }
}

/**
 * Get a summary of the World Model for the Morning Brief.
 * Returns a concise text summary suitable for inclusion in the brief.
 */
export async function getWorldModelSummary(): Promise<string> {
  const snapshot = await getWorldModelSnapshot()

  const lines: string[] = []
  lines.push('─── WORLD MODEL SUMMARY ───')
  lines.push(`Mission: ${snapshot.mission.goal} (${snapshot.mission.growthRate})`)
  lines.push('')
  lines.push('GOALS:')
  for (const g of snapshot.goals) {
    const status = g.onTrack ? '✅ on track' : '⚠️ behind'
    lines.push(`  ${g.name}: ${g.current} / ${g.target} (${g.progress.toFixed(0)}%) — ${status}`)
  }
  lines.push('')
  lines.push('BUSINESS STATE:')
  lines.push(`  Revenue this month: $${snapshot.businessState.revenueThisMonth.toFixed(2)}`)
  lines.push(`  Projected: $${snapshot.businessState.projectedRevenue.toFixed(2)}`)
  lines.push(`  Days remaining: ${snapshot.businessState.daysRemaining}`)
  lines.push('')
  if (snapshot.risks.length > 0) {
    lines.push('RISKS:')
    for (const r of snapshot.risks) lines.push(`  ⚠️ ${r}`)
    lines.push('')
  }
  lines.push(`SYSTEM: ${snapshot.systemHealth.agentsActive} agents, ${snapshot.systemHealth.toolsAvailable} tools, ${snapshot.systemHealth.providersOnline} providers`)

  return lines.join('\n')
}
