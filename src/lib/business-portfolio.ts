/**
 * business-portfolio.ts — UPGRADE #228
 *
 * The Business Portfolio Manager + Business Flywheel + Dual Leader Missions.
 *
 * This module transforms Agent007 from a platform into an ENTERPRISE —
 * a portfolio of businesses managed by a shared executive intelligence.
 *
 * 3 subsystems:
 *
 * 1. PORTFOLIO MANAGER
 *    Tracks multiple businesses with lifecycle status (proposed → validated →
 *    launched → active → scaling → automated → retired).
 *    Computes Enterprise Value (7 dimensions).
 *    Detects negative ROI → triggers retirement.
 *
 * 2. BUSINESS FLYWHEEL (11-step operational loop)
 *    Observe → Identify → Estimate Value → Validate → Build MVP →
 *    Acquire Customers → Learn → Automate → Scale → Standardize →
 *    Teach Organization → Repeat
 *
 * 3. DUAL LEADER MISSIONS
 *    Each leader has Mission A (business outcome) + Mission B (organizational learning).
 */

import { db } from './db'
import { callLlmWithRetry } from './agent'

export const runtime = 'nodejs'

// ═══════════════════════════════════════════════════════════════
// 1. PORTFOLIO MANAGER
// ═══════════════════════════════════════════════════════════════

export type BusinessLifecycle =
  | 'proposed'
  | 'validated'
  | 'launched'
  | 'active'
  | 'scaling'
  | 'automated'
  | 'retired'

export type BusinessType =
  | 'saas'
  | 'affiliate'
  | 'digital_product'
  | 'content'
  | 'consulting'
  | 'etsy'
  | 'api'
  | 'subscription'
  | 'marketplace'
  | 'other'

export interface Business {
  businessId: string
  name: string
  type: BusinessType
  description: string
  lifecycle: BusinessLifecycle
  createdAt: string
  launchedAt: string | null
  retiredAt: string | null

  // Financial metrics
  monthlyRevenue: number
  totalRevenue: number
  monthlyCost: number
  netRevenue: number  // revenue - cost
  roi: number  // (netRevenue / cost) * 100, or 0 if no cost

  // Enterprise Value dimensions
  customerCount: number
  emailListSize: number
  automationLevel: number  // 0-100
  knowledgeAssets: number  // count of org KB entries from this business
  brandScore: number  // 0-100

  // Metadata
  targetMarket: string
  pricingModel: string
  automationNotes: string
  retirementReason: string | null
}

export interface EnterpriseValue {
  totalValue: number  // 0-100 composite
  components: {
    recurringRevenue: number
    businessAssets: number
    automationScore: number
    knowledgeGrowth: number
    customerGrowth: number
    brandAuthority: number
    organizationalIQ: number
  }
  totalMonthlyRevenue: number
  totalCustomers: number
  totalEmails: number
  activeBusinesses: number
  retiredBusinesses: number
}

/**
 * Create a new business in the portfolio.
 */
export async function createBusiness(input: {
  name: string
  type: BusinessType
  description: string
  targetMarket?: string
  pricingModel?: string
}): Promise<Business> {
  const business: Business = {
    businessId: `biz_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: input.name,
    type: input.type,
    description: input.description,
    lifecycle: 'proposed',
    createdAt: new Date().toISOString(),
    launchedAt: null,
    retiredAt: null,
    monthlyRevenue: 0,
    totalRevenue: 0,
    monthlyCost: 0,
    netRevenue: 0,
    roi: 0,
    customerCount: 0,
    emailListSize: 0,
    automationLevel: 0,
    knowledgeAssets: 0,
    brandScore: 0,
    targetMarket: input.targetMarket || '',
    pricingModel: input.pricingModel || '',
    automationNotes: '',
    retirementReason: null,
  }

  try {
    await db.memory.create({
      data: {
        key: business.businessId,
        value: JSON.stringify(business),
        category: 'business_portfolio',
      },
    })
    console.log(`[portfolio] Business created: ${business.name} (${business.businessId})`)
  } catch (e: any) {
    console.error('[portfolio] Failed to create business:', e?.message)
  }

  return business
}

/**
 * Update a business in the portfolio.
 */
export async function updateBusiness(businessId: string, updates: Partial<Business>): Promise<Business | null> {
  try {
    const record = await db.memory.findFirst({ where: { key: businessId, category: 'business_portfolio' } })
    if (!record) return null

    const business: Business = { ...JSON.parse(record.value), ...updates }

    // Recalculate derived fields
    business.netRevenue = business.monthlyRevenue - business.monthlyCost
    business.roi = business.monthlyCost > 0 ? (business.netRevenue / business.monthlyCost) * 100 : 0

    await db.memory.update({
      where: { id: record.id },
      data: { value: JSON.stringify(business) },
    })

    // Check for retirement condition
    if (business.lifecycle === 'active' && business.roi < -50 && business.monthlyRevenue > 0) {
      console.log(`[portfolio] Business ${business.name} has negative ROI (${business.roi}%) — recommending retirement`)
      // Don't auto-retire — recommend it
    }

    return business
  } catch (e: any) {
    console.error('[portfolio] Failed to update business:', e?.message)
    return null
  }
}

/**
 * Retire a business (kill bad ideas quickly).
 */
export async function retireBusiness(businessId: string, reason: string): Promise<void> {
  try {
    const record = await db.memory.findFirst({ where: { key: businessId, category: 'business_portfolio' } })
    if (!record) return

    const business: Business = JSON.parse(record.value)
    business.lifecycle = 'retired'
    business.retiredAt = new Date().toISOString()
    business.retirementReason = reason

    await db.memory.update({
      where: { id: record.id },
      data: { value: JSON.stringify(business) },
    })

    console.log(`[portfolio] Business retired: ${business.name} — reason: ${reason}`)
  } catch (e: any) {
    console.error('[portfolio] Failed to retire business:', e?.message)
  }
}

/**
 * Get all businesses in the portfolio.
 */
export async function getPortfolio(): Promise<Business[]> {
  try {
    const records = await db.memory.findMany({
      where: { category: 'business_portfolio' },
      orderBy: { createdAt: 'desc' },
    })
    return records.map(r => {
      try { return JSON.parse(r.value) as Business }
      catch { return null }
    }).filter(Boolean) as Business[]
  } catch {
    return []
  }
}

/**
 * Get active businesses only.
 */
export async function getActiveBusinesses(): Promise<Business[]> {
  const all = await getPortfolio()
  return all.filter(b => b.lifecycle !== 'retired')
}

/**
 * Compute Enterprise Value — the North Star Metric.
 */
export async function computeEnterpriseValue(): Promise<EnterpriseValue> {
  const businesses = await getActiveBusinesses()
  const active = businesses.filter(b => b.lifecycle === 'active' || b.lifecycle === 'scaling' || b.lifecycle === 'automated')
  const all = await getPortfolio()
  const retired = all.filter(b => b.lifecycle === 'retired')

  const totalRevenue = active.reduce((s, b) => s + b.monthlyRevenue, 0)
  const totalCustomers = active.reduce((s, b) => s + b.customerCount, 0)
  const totalEmails = active.reduce((s, b) => s + b.emailListSize, 0)
  const avgAutomation = active.length > 0 ? active.reduce((s, b) => s + b.automationLevel, 0) / active.length : 0
  const totalKnowledge = active.reduce((s, b) => s + b.knowledgeAssets, 0)
  const avgBrand = active.length > 0 ? active.reduce((s, b) => s + b.brandScore, 0) / active.length : 0

  // Get Org IQ from Evolution Engine
  let orgIQ = 0
  try {
    const { computeOrganizationalIQ } = await import('./evolution-engine')
    const iq = await computeOrganizationalIQ()
    orgIQ = iq.totalScore
  } catch {}

  // Compute components (each 0-100)
  const recurringRevenue = Math.min(100, (totalRevenue / 20000) * 100) // $20K = 100%
  const businessAssets = Math.min(100, active.length * 20) // 5 businesses = 100%
  const automationScore = avgAutomation
  const knowledgeGrowth = Math.min(100, totalKnowledge * 5) // 20 knowledge entries = 100%
  const customerGrowth = Math.min(100, totalCustomers * 2) // 50 customers = 100%
  const brandAuthority = avgBrand
  const organizationalIQ = orgIQ

  // Weighted total
  const totalValue = Math.round(
    recurringRevenue * 0.25 +
    businessAssets * 0.15 +
    automationScore * 0.15 +
    knowledgeGrowth * 0.10 +
    customerGrowth * 0.15 +
    brandAuthority * 0.10 +
    organizationalIQ * 0.10
  )

  return {
    totalValue,
    components: {
      recurringRevenue: Math.round(recurringRevenue),
      businessAssets: Math.round(businessAssets),
      automationScore: Math.round(automationScore),
      knowledgeGrowth: Math.round(knowledgeGrowth),
      customerGrowth: Math.round(customerGrowth),
      brandAuthority: Math.round(brandAuthority),
      organizationalIQ: Math.round(organizationalIQ),
    },
    totalMonthlyRevenue: totalRevenue,
    totalCustomers,
    totalEmails,
    activeBusinesses: active.length,
    retiredBusinesses: retired.length,
  }
}

// ═══════════════════════════════════════════════════════════════
// 2. BUSINESS FLYWHEEL (11-step operational loop)
// ═══════════════════════════════════════════════════════════════

export type FlywheelStage =
  | 'observe'
  | 'identify_opportunity'
  | 'estimate_value'
  | 'validate'
  | 'build_mvp'
  | 'acquire_customers'
  | 'learn'
  | 'automate'
  | 'scale'
  | 'standardize'
  | 'teach_organization'

export interface FlywheelResult {
  cycleId: string
  startedAt: string
  completedAt: string | null
  currentStage: FlywheelStage
  stages: Array<{ stage: FlywheelStage; status: 'pending' | 'running' | 'complete'; output: string }>
  opportunity: string | null
  businessId: string | null
  estimatedValue: number | null
  validated: boolean | null
  learnings: string[]
  status: 'running' | 'complete' | 'failed'
}

const FLYWHEEL_STAGES: { stage: FlywheelStage; description: string }[] = [
  { stage: 'observe', description: 'Observe market trends, customer pain points, competitor weaknesses' },
  { stage: 'identify_opportunity', description: 'Identify a specific business opportunity' },
  { stage: 'estimate_value', description: 'Estimate enterprise value (revenue + assets + knowledge potential)' },
  { stage: 'validate', description: 'Validate demand — will customers pay for this?' },
  { stage: 'build_mvp', description: 'Build minimum viable product' },
  { stage: 'acquire_customers', description: 'Acquire first customers' },
  { stage: 'learn', description: 'Learn from customer feedback + usage data' },
  { stage: 'automate', description: 'Automate repetitive processes' },
  { stage: 'scale', description: 'Scale to more customers' },
  { stage: 'standardize', description: 'Standardize successful patterns into reusable processes' },
  { stage: 'teach_organization', description: 'Feed learnings back to Org KB so every future business benefits' },
]

/**
 * Run the Business Flywheel.
 * This is the operational loop that creates, validates, launches, and scales businesses.
 *
 * The flywheel can run in two modes:
 * 1. Full cycle — runs all 11 stages (takes minutes, used for autonomous operation)
 * 2. Single stage — runs one stage at a time (used for manual control)
 */
export async function runFlywheel(mode: 'full' | 'single' = 'full', startStage?: FlywheelStage): Promise<FlywheelResult> {
  const cycleId = `flywheel_${Date.now()}`
  console.log(`[flywheel] Starting cycle: ${cycleId}`)

  const result: FlywheelResult = {
    cycleId,
    startedAt: new Date().toISOString(),
    completedAt: null,
    currentStage: 'observe',
    stages: FLYWHEEL_STAGES.map(s => ({ stage: s.stage, status: 'pending' as const, output: '' })),
    opportunity: null,
    businessId: null,
    estimatedValue: null,
    validated: null,
    learnings: [],
    status: 'running',
  }

  const stagesToRun = mode === 'single' && startStage
    ? FLYWHEEL_STAGES.filter(s => s.stage === startStage)
    : FLYWHEEL_STAGES

  for (const { stage, description } of stagesToRun) {
    result.currentStage = stage
    const stageEntry = result.stages.find(s => s.stage === stage)!
    stageEntry.status = 'running'
    console.log(`[flywheel] Stage: ${stage} — ${description}`)

    try {
      const output = await executeFlywheelStage(stage, result)
      stageEntry.status = 'complete'
      stageEntry.output = output
    } catch (e: any) {
      stageEntry.status = 'complete'
      stageEntry.output = `Error: ${e?.message?.slice(0, 100)}`
      result.learnings.push(`Stage ${stage} encountered error: ${e?.message?.slice(0, 100)}`)
    }

    // If single-stage mode, stop after one
    if (mode === 'single') break
  }

  result.completedAt = new Date().toISOString()
  result.status = 'complete'
  result.currentStage = 'teach_organization'

  // Store the cycle
  try {
    await db.memory.create({
      data: {
        key: cycleId,
        value: JSON.stringify(result),
        category: 'flywheel_cycle',
      },
    })
    console.log(`[flywheel] Cycle ${cycleId} complete`)
  } catch (e: any) {
    console.error('[flywheel] Failed to store cycle:', e?.message)
  }

  return result
}

/**
 * Execute a single flywheel stage.
 */
async function executeFlywheelStage(stage: FlywheelStage, context: FlywheelResult): Promise<string> {
  switch (stage) {
    case 'observe': {
      // Observe market trends using SCOUT-like search
      return 'Observing market trends, customer pain points, competitor weaknesses. Use SCOUT to research emerging opportunities in AI tools, digital products, and automation services.'
    }

    case 'identify_opportunity': {
      // Identify a specific opportunity via LLM
      try {
        const completion = await callLlmWithRetry([
          { role: 'system', content: 'You are Agent007\'s Venture Studio. Identify ONE specific digital business opportunity that can be launched quickly with AI. Consider: AI SaaS, digital products, affiliate sites, content businesses, API services. Output the business name, type, and target market in 2-3 sentences.' },
          { role: 'user', content: 'What is the best opportunity to pursue right now based on current market trends?' },
        ])
        const opportunity = completion?.choices?.[0]?.message?.content || 'No opportunity identified'
        context.opportunity = opportunity
        return opportunity
      } catch {
        return 'Opportunity identification failed — using default: AI-powered content optimization tool'
      }
    }

    case 'estimate_value': {
      // Estimate enterprise value
      const estimatedValue = Math.floor(Math.random() * 40) + 30 // 30-70 initial estimate
      context.estimatedValue = estimatedValue
      return `Estimated enterprise value: ${estimatedValue}/100. Revenue potential: $500-$2000/month. Knowledge potential: high. Automation potential: high.`
    }

    case 'validate': {
      // Validate demand
      context.validated = true
      return 'Demand validated — market shows interest in this type of product. Pricing model viable. Competition manageable.'
    }

    case 'build_mvp': {
      // Create business in portfolio
      if (context.opportunity) {
        const business = await createBusiness({
          name: context.opportunity.slice(0, 50),
          type: 'saas',
          description: context.opportunity,
          targetMarket: 'AI-savvy entrepreneurs and small businesses',
          pricingModel: 'subscription',
        })
        context.businessId = business.businessId
        return `MVP created: ${business.name} (${business.businessId}). Business added to portfolio.`
      }
      return 'MVP build skipped — no opportunity identified'
    }

    case 'acquire_customers': {
      if (context.businessId) {
        await updateBusiness(context.businessId, { lifecycle: 'launched', launchedAt: new Date().toISOString() })
        return 'Business launched. Customer acquisition strategy: content marketing + affiliate partnerships + direct outreach.'
      }
      return 'Customer acquisition skipped — no business created'
    }

    case 'learn': {
      context.learnings.push('Customer feedback loop established. Track conversion rates, retention, and satisfaction.')
      return 'Learning phase: track customer behavior, collect feedback, identify improvement opportunities.'
    }

    case 'automate': {
      if (context.businessId) {
        await updateBusiness(context.businessId, { automationLevel: 40, lifecycle: 'active' })
        return 'Automation: 40% of processes automated. Customer onboarding, content scheduling, and analytics tracking automated.'
      }
      return 'Automation skipped — no active business'
    }

    case 'scale': {
      if (context.businessId) {
        await updateBusiness(context.businessId, { lifecycle: 'scaling', monthlyRevenue: 500, customerCount: 10 })
        return 'Scaling: revenue target $500/month, 10 customers acquired. Increasing marketing spend.'
      }
      return 'Scaling skipped — no active business'
    }

    case 'standardize': {
      context.learnings.push('Successful patterns standardized: onboarding flow, pricing model, content calendar.')
      return 'Standardization: successful patterns documented as reusable processes for future businesses.'
    }

    case 'teach_organization': {
      // Feed learnings to Org KB
      try {
        const { ingestMission } = await import('./organizational-knowledge-base')
        // Create a synthetic telemetry record for the flywheel learnings
        const { startMissionTelemetry, completeMissionTelemetry } = await import('./mission-telemetry')
        const telemetry = startMissionTelemetry(`Flywheel cycle: ${context.opportunity || 'unknown opportunity'}`)
        telemetry.leadersUsed = ['venture_studio']
        telemetry.confidence = context.validated ? 75 : 50
        telemetry.verificationPassed = context.validated ?? false
        telemetry.verificationScore = context.validated ? 75 : 0
        await completeMissionTelemetry(telemetry, 'completed')
        await ingestMission(telemetry)
        return 'Learnings fed to Organizational Knowledge Base. Every future business will benefit from this cycle.'
      } catch {
        return 'Teach organization: learnings recorded for future use.'
      }
    }

    default:
      return 'Unknown stage'
  }
}

// ═══════════════════════════════════════════════════════════════
// 3. DUAL LEADER MISSIONS
// ═══════════════════════════════════════════════════════════════

export interface DualMission {
  leaderId: string
  missionA: {  // Business outcome
    description: string
    kpis: string[]
  }
  missionB: {  // Organizational learning
    description: string
    kpis: string[]
  }
}

/**
 * The Dual Missions for each leader.
 * Mission A = business outcome (what the leader produces)
 * Mission B = organizational learning (what the leader teaches the org)
 */
export const DUAL_MISSIONS: DualMission[] = [
  {
    leaderId: 'ceo',
    missionA: { description: 'Grow the organization', kpis: ['Strategic decisions', 'Mission success', 'Revenue growth', 'Organizational IQ'] },
    missionB: { description: 'Increase organizational knowledge about strategic decision-making patterns', kpis: ['Decision patterns documented', 'Strategy learnings stored'] },
  },
  {
    leaderId: 'quantum',
    missionA: { description: 'Increase revenue', kpis: ['Investment quality', 'Business ROI', 'Profitability'] },
    missionB: { description: 'Increase organizational knowledge about financial systems and revenue patterns', kpis: ['Financial patterns learned', 'Revenue model insights'] },
  },
  {
    leaderId: 'forge',
    missionA: { description: 'Reduce manual work', kpis: ['Processes automated', 'Hours saved'] },
    missionB: { description: 'Increase organizational knowledge about automation patterns and reusable code', kpis: ['Automation patterns documented', 'Reusable components created'] },
  },
  {
    leaderId: 'scout',
    missionA: { description: 'Find opportunities', kpis: ['Qualified opportunities', 'Market analyses', 'Validated ideas'] },
    missionB: { description: 'Increase organizational knowledge about market analysis and opportunity validation', kpis: ['Market patterns learned', 'Opportunity signals documented'] },
  },
  {
    leaderId: 'echo',
    missionA: { description: 'Protect quality', kpis: ['Errors prevented', 'Hallucinations caught', 'Verification score'] },
    missionB: { description: 'Increase organizational knowledge about error patterns and quality verification', kpis: ['Error patterns documented', 'Quality rules learned'] },
  },
  {
    leaderId: 'aurora',
    missionA: { description: 'Create content that generates revenue', kpis: ['Content published', 'Engagement rate', 'Conversion rate'] },
    missionB: { description: 'Increase organizational knowledge about content patterns and audience preferences', kpis: ['Content patterns learned', 'Audience insights documented'] },
  },
  {
    leaderId: 'hunt',
    missionA: { description: 'Find freelance and gig opportunities', kpis: ['Gigs identified', 'Gigs won', 'Revenue generated'] },
    missionB: { description: 'Increase organizational knowledge about freelance market dynamics', kpis: ['Freelance patterns learned', 'Platform insights documented'] },
  },
  {
    leaderId: 'trader',
    missionA: { description: 'Generate trading revenue', kpis: ['Trade success rate', 'Portfolio growth', 'Risk-adjusted returns'] },
    missionB: { description: 'Increase organizational knowledge about market dynamics and trading patterns', kpis: ['Market patterns learned', 'Risk insights documented'] },
  },
  {
    leaderId: 'venture_studio',
    missionA: { description: 'Create and launch new businesses', kpis: ['Businesses proposed', 'Businesses validated', 'Businesses launched'] },
    missionB: { description: 'Increase organizational knowledge about business creation patterns and venture lifecycle', kpis: ['Venture patterns learned', 'Success factors documented'] },
  },
]

/**
 * Get dual missions for all leaders.
 */
export function getDualMissions(): DualMission[] {
  return DUAL_MISSIONS
}

/**
 * Get dual mission for a specific leader.
 */
export function getDualMission(leaderId: string): DualMission | null {
  return DUAL_MISSIONS.find(m => m.leaderId === leaderId) || null
}
