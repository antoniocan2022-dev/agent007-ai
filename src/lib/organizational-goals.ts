/**
 * organizational-goals.ts — UPGRADE #230
 *
 * The 6 Organizational Goals — permanent business objectives that every
 * subsystem understands and aligns with.
 *
 * Unlike mission telemetry (which tracks individual missions), these
 * goals track ORGANIZATIONAL PROGRESS over time.
 *
 * Each goal has:
 * - Mission (what the goal is about)
 * - KPI (how it's measured)
 * - Target (where we want to be)
 * - Current (where we are now)
 * - Trend (improving / declining / stable)
 */

import { db } from './db'

export const runtime = 'nodejs'

export type GoalTrend = 'improving' | 'declining' | 'stable' | 'not-started'

export interface OrgGoal {
  id: number
  name: string
  mission: string
  kpi: string
  target: string
  currentValue: string
  targetValue: string
  progress: number  // 0-100
  trend: GoalTrend
  milestones: Array<{ label: string; target: string; achieved: boolean }>
}

/**
 * Get all 6 organizational goals with current progress.
 * Pulls real data from the portfolio, evolution engine, and telemetry.
 */
export async function getOrganizationalGoals(): Promise<OrgGoal[]> {
  // Get enterprise value for financial data
  let totalRevenue = 0
  let activeBusinesses = 0
  let retiredBusinesses = 0
  try {
    const { computeEnterpriseValue } = await import('./business-portfolio')
    const value = await computeEnterpriseValue()
    totalRevenue = value.totalMonthlyRevenue
    activeBusinesses = value.activeBusinesses
    retiredBusinesses = value.retiredBusinesses
  } catch {}

  // Get Org IQ for intelligence goal
  let orgIQ = 0
  let orgIQTrend: GoalTrend = 'not-started'
  try {
    const { computeOrganizationalIQ } = await import('./evolution-engine')
    const iq = await computeOrganizationalIQ()
    orgIQ = iq.totalScore
    orgIQTrend = iq.trend === 'improving' ? 'improving' : iq.trend === 'declining' ? 'declining' : 'stable'
  } catch {}

  // Get telemetry for operational metrics
  let avgConfidence = 0
  let avgDuration = 0
  let verificationRate = 0
  let correctionRate = 0
  let totalMissions = 0
  try {
    const records = await db.memory.findMany({
      where: { category: 'mission_telemetry' },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }).catch(() => [])
    const missions = records.map(r => { try { return JSON.parse(r.value) } catch { return null } }).filter(Boolean)
    totalMissions = missions.length
    if (missions.length > 0) {
      avgConfidence = missions.reduce((s: number, m: any) => s + (m.confidence || 0), 0) / missions.length
      avgDuration = missions.reduce((s: number, m: any) => s + (m.duration || 0), 0) / missions.length
      const verified = missions.filter((m: any) => m.verificationPassed).length
      verificationRate = (verified / missions.length) * 100
      const corrected = missions.filter((m: any) => m.executiveCorrections > 0).length
      correctionRate = (corrected / missions.length) * 100
    }
  } catch {}

  // Get org KB for knowledge growth
  let knowledgeEntries = 0
  try {
    const records = await db.memory.findMany({ where: { category: 'org_knowledge' } }).catch(() => [])
    knowledgeEntries = records.length
  } catch {}

  // Get portfolio for opportunity discovery
  let proposedBusinesses = 0
  let validatedBusinesses = 0
  let launchedBusinesses = 0
  let revenueBusinesses = 0
  try {
    const { getPortfolio } = await import('./business-portfolio')
    const all = await getPortfolio()
    proposedBusinesses = all.filter(b => b.lifecycle === 'proposed').length
    validatedBusinesses = all.filter(b => b.lifecycle === 'validated').length
    launchedBusinesses = all.filter(b => ['launched', 'active', 'scaling', 'automated'].includes(b.lifecycle)).length
    revenueBusinesses = all.filter(b => b.monthlyRevenue > 0).length
  } catch {}

  // ═══ GOAL 1: Financial Growth ═══
  const revenueTarget = 20000
  const revenueProgress = Math.min(100, (totalRevenue / revenueTarget) * 100)
  const goal1: OrgGoal = {
    id: 1,
    name: 'Financial Growth',
    mission: 'Generate sustainable recurring revenue through autonomous AI-operated businesses',
    kpi: 'Monthly recurring revenue',
    currentValue: `$${totalRevenue.toFixed(2)}`,
    target: "",
    targetValue: '$20,000+',
    progress: Math.round(revenueProgress),
    trend: totalRevenue > 0 ? 'improving' : 'not-started',
    milestones: [
      { label: 'Month 1', target: '$500', achieved: totalRevenue >= 500 },
      { label: 'Month 2', target: '$2,000', achieved: totalRevenue >= 2000 },
      { label: 'Month 3', target: '$5,000', achieved: totalRevenue >= 5000 },
      { label: 'Month 6', target: '$10,000', achieved: totalRevenue >= 10000 },
      { label: 'Month 12', target: '$20,000+', achieved: totalRevenue >= 20000 },
    ],
  }

  // ═══ GOAL 2: Autonomous Business Creation ═══
  const totalBusinesses = proposedBusinesses + validatedBusinesses + launchedBusinesses
  const businessProgress = Math.min(100, (launchedBusinesses / 5) * 100) // 5 launched = 100%
  const goal2: OrgGoal = {
    id: 2,
    name: 'Autonomous Business Creation',
    mission: 'Continuously identify, validate, launch, and improve new digital income streams',
    kpi: 'Businesses proposed / validated / launched / producing revenue',
    currentValue: `${proposedBusinesses} proposed / ${validatedBusinesses} validated / ${launchedBusinesses} launched / ${revenueBusinesses} revenue`,
    target: "",
    targetValue: '5+ active businesses generating revenue',
    progress: Math.round(businessProgress),
    trend: totalBusinesses > 0 ? 'improving' : 'not-started',
    milestones: [
      { label: 'First business proposed', target: '1', achieved: proposedBusinesses >= 1 },
      { label: 'First business validated', target: '1', achieved: validatedBusinesses >= 1 },
      { label: 'First business launched', target: '1', achieved: launchedBusinesses >= 1 },
      { label: 'First revenue', target: '$1+', achieved: revenueBusinesses >= 1 },
      { label: '5 businesses active', target: '5', achieved: launchedBusinesses >= 5 },
    ],
  }

  // ═══ GOAL 3: Continuous Opportunity Discovery ═══
  const opportunityProgress = Math.min(100, (proposedBusinesses / 10) * 100) // 10 proposed = 100%
  const goal3: OrgGoal = {
    id: 3,
    name: 'Continuous Opportunity Discovery',
    mission: 'Always search for new markets, products, customer pain points, competitor weaknesses, automation opportunities, and emerging AI trends',
    kpi: 'Opportunities found per week',
    currentValue: `${proposedBusinesses} total opportunities identified`,
    target: "",
    targetValue: '10+ opportunities per week',
    progress: Math.round(opportunityProgress),
    trend: proposedBusinesses > 0 ? 'improving' : 'not-started',
    milestones: [
      { label: 'First opportunity', target: '1', achieved: proposedBusinesses >= 1 },
      { label: '5 opportunities', target: '5', achieved: proposedBusinesses >= 5 },
      { label: '10 opportunities', target: '10', achieved: proposedBusinesses >= 10 },
    ],
  }

  // ═══ GOAL 4: Organizational Intelligence ═══ (was Goal 4 in analyst's proposal)
  const intelligenceProgress = orgIQ
  const goal4: OrgGoal = {
    id: 4,
    name: 'Organizational Intelligence',
    mission: 'Every week Agent007 should become smarter. If Organizational IQ decreases, immediately investigate.',
    kpi: 'Organizational IQ (Executive + Leader + Cognitive + Behavioral + Operational + Learning)',
    currentValue: `${orgIQ}/100`,
    target: "",
    targetValue: '90+ (improving trend)',
    progress: orgIQ,
    trend: orgIQTrend,
    milestones: [
      { label: 'IQ > 50', target: '50', achieved: orgIQ >= 50 },
      { label: 'IQ > 70', target: '70', achieved: orgIQ >= 70 },
      { label: 'IQ > 85', target: '85', achieved: orgIQ >= 85 },
      { label: 'IQ > 90', target: '90', achieved: orgIQ >= 90 },
    ],
  }

  // ═══ GOAL 5: Operational Excellence ═══
  const opQuality = Math.round((avgConfidence + verificationRate + (100 - correctionRate)) / 3)
  const opProgress = Math.min(100, opQuality)
  const goal5: OrgGoal = {
    id: 5,
    name: 'Operational Excellence',
    mission: 'Every mission should improve quality, speed, accuracy, cost, and automation. No mission should make the organization worse.',
    kpi: 'Quality (confidence), Speed (duration), Accuracy (verification), Cost (tokens), Automation (level)',
    currentValue: `Confidence ${avgConfidence.toFixed(0)}%, Verification ${verificationRate.toFixed(0)}%, Corrections ${correctionRate.toFixed(0)}%, Duration ${(avgDuration / 1000).toFixed(1)}s`,
    target: "",
    targetValue: 'All metrics improving or stable at high levels',
    progress: opProgress,
    trend: opProgress >= 70 ? 'improving' : opProgress > 0 ? 'stable' : 'not-started',
    milestones: [
      { label: 'Confidence > 70%', target: '70%', achieved: avgConfidence >= 70 },
      { label: 'Verification > 80%', target: '80%', achieved: verificationRate >= 80 },
      { label: 'Corrections < 10%', target: '<10%', achieved: correctionRate < 10 },
      { label: 'Duration < 30s', target: '<30s', achieved: avgDuration > 0 && avgDuration < 30000 },
    ],
  }

  // ═══ GOAL 6: Executive Trust ═══
  const trustScore = Math.round((avgConfidence + verificationRate + (100 - correctionRate) + (orgIQ * 0.5)) / 3.5)
  const goal6: OrgGoal = {
    id: 6,
    name: 'Executive Trust',
    mission: 'Build and maintain trust through consistency, reliability, explainability, predictability, and confidence. Trust is the highest non-financial metric.',
    kpi: 'Consistency, Reliability, Explainability, Predictability, Confidence',
    currentValue: `Trust Score: ${trustScore}/100`,
    target: "",
    targetValue: '90+ (all dimensions high)',
    progress: Math.min(100, trustScore),
    trend: trustScore >= 70 ? 'improving' : trustScore > 0 ? 'stable' : 'not-started',
    milestones: [
      { label: 'Trust > 50', target: '50', achieved: trustScore >= 50 },
      { label: 'Trust > 70', target: '70', achieved: trustScore >= 70 },
      { label: 'Trust > 85', target: '85', achieved: trustScore >= 85 },
      { label: 'Trust > 90', target: '90', achieved: trustScore >= 90 },
    ],
  }

  return [goal1, goal2, goal3, goal4, goal5, goal6]
}

/**
 * Get a summary of all goals for dashboards.
 */
export async function getGoalsSummary(): Promise<{
  totalGoals: number
  goalsAchieved: number
  avgProgress: number
  overallTrend: GoalTrend
  goals: OrgGoal[]
}> {
  const goals = await getOrganizationalGoals()
  const achieved = goals.filter(g => g.progress >= 100).length
  const avgProgress = goals.reduce((s, g) => s + g.progress, 0) / goals.length

  const trends = goals.map(g => g.trend)
  const improving = trends.filter(t => t === 'improving').length
  const declining = trends.filter(t => t === 'declining').length
  const overallTrend: GoalTrend = declining > improving ? 'declining' : improving > 0 ? 'improving' : 'stable'

  return {
    totalGoals: goals.length,
    goalsAchieved: achieved,
    avgProgress: Math.round(avgProgress),
    overallTrend,
    goals,
  }
}
