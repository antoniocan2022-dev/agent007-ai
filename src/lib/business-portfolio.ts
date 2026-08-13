/**
 * Business Portfolio — canonical portfolio persistence + Flywheel + Dual Missions.
 * Venture OS owns executive policy and strategic decisions; this module owns
 * business records and deterministic lifecycle primitives.
 */

import { db } from './db'
import { callLlmWithRetry } from './agent'

export const runtime = 'nodejs'

export type BusinessLifecycle = 'proposed' | 'validated' | 'launched' | 'active' | 'scaling' | 'automated' | 'retired'
export type BusinessType = 'saas' | 'affiliate' | 'digital_product' | 'content' | 'consulting' | 'etsy' | 'api' | 'subscription' | 'marketplace' | 'other'

export interface Business {
  businessId: string
  name: string
  type: BusinessType
  description: string
  lifecycle: BusinessLifecycle
  createdAt: string
  launchedAt: string | null
  retiredAt: string | null
  monthlyRevenue: number
  totalRevenue: number
  monthlyCost: number
  netRevenue: number
  roi: number
  customerCount: number
  emailListSize: number
  automationLevel: number
  knowledgeAssets: number
  brandScore: number
  targetMarket: string
  pricingModel: string
  automationNotes: string
  retirementReason: string | null
}

export interface EnterpriseValue {
  totalValue: number
  components: { recurringRevenue: number; businessAssets: number; automationScore: number; knowledgeGrowth: number; customerGrowth: number; brandAuthority: number; organizationalIQ: number }
  totalMonthlyRevenue: number
  totalCustomers: number
  totalEmails: number
  activeBusinesses: number
  retiredBusinesses: number
}

function normalizeBusinessName(name: string): string { return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase() }
function parseBusiness(value: string): Business | null { try { return JSON.parse(value) as Business } catch { return null } }

async function findBusinessByName(name: string): Promise<Business | null> {
  const normalized = normalizeBusinessName(name)
  if (!normalized) return null
  const records = await db.memory.findMany({ where: { category: 'business_portfolio' } })
  return records.map((record) => parseBusiness(record.value)).find((business): business is Business => business !== null && normalizeBusinessName(business.name) === normalized) ?? null
}

export async function createBusiness(input: { name: string; type: BusinessType; description: string; targetMarket?: string; pricingModel?: string }): Promise<Business> {
  const name = input.name.trim()
  if (!name) throw new Error('Business name is required.')
  const existing = await findBusinessByName(name)
  if (existing) return existing

  const business: Business = {
    businessId: `biz_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
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
    targetMarket: input.targetMarket ?? '',
    pricingModel: input.pricingModel ?? '',
    automationNotes: '',
    retirementReason: null,
  }

  try {
    await db.memory.create({ data: { key: business.businessId, value: JSON.stringify(business), category: 'business_portfolio' } })
    return business
  } catch (error) {
    const concurrent = await findBusinessByName(name)
    if (concurrent) return concurrent
    throw error
  }
}

export async function updateBusiness(businessId: string, updates: Partial<Business>): Promise<Business | null> {
  try {
    const record = await db.memory.findFirst({ where: { key: businessId, category: 'business_portfolio' } })
    if (!record) return null
    const current = parseBusiness(record.value)
    if (!current) return null
    const business: Business = { ...current, ...updates }
    business.netRevenue = business.monthlyRevenue - business.monthlyCost
    business.roi = business.monthlyCost > 0 ? (business.netRevenue / business.monthlyCost) * 100 : 0
    await db.memory.update({ where: { id: record.id }, data: { value: JSON.stringify(business) } })
    return business
  } catch (error) {
    console.error('[portfolio] Failed to update business:', error instanceof Error ? error.message : error)
    return null
  }
}

export async function retireBusiness(businessId: string, reason: string): Promise<void> {
  const record = await db.memory.findFirst({ where: { key: businessId, category: 'business_portfolio' } })
  if (!record) return
  const business = parseBusiness(record.value)
  if (!business || business.lifecycle === 'retired') return
  business.lifecycle = 'retired'
  business.retiredAt = new Date().toISOString()
  business.retirementReason = reason
  await db.memory.update({ where: { id: record.id }, data: { value: JSON.stringify(business) } })
}

async function recoverResources(business: Business): Promise<void> {
  const key = `recovered_${business.businessId}`
  try {
    if (await db.memory.findUnique({ where: { key } })) return
    await db.memory.create({ data: { key, category: 'business_retirement_log', value: JSON.stringify({ businessName: business.name, businessType: business.type, retirementReason: business.retirementReason, finalRevenue: business.monthlyRevenue, finalROI: business.roi, customerCount: business.customerCount, automationLevel: business.automationLevel, targetMarket: business.targetMarket, pricingModel: business.pricingModel, lesson: `Business "${business.name}" (${business.type}) retired at ROI ${business.roi}%.`, recoveredAt: new Date().toISOString() }) } })
  } catch (error) {
    console.error('[portfolio] Resource recovery failed:', error instanceof Error ? error.message : error)
  }
}

export async function checkPortfolioHealth(): Promise<{ checked: number; retired: number; warnings: string[] }> {
  const active = (await getActiveBusinesses()).filter((business) => business.lifecycle === 'active' || business.lifecycle === 'scaling')
  const warnings: string[] = []
  let retired = 0
  for (const business of active) {
    if (business.roi < -50 && business.monthlyRevenue > 0) {
      await retireBusiness(business.businessId, `Financial safety floor: ROI ${business.roi}%`)
      await recoverResources(business)
      retired++
      warnings.push(`Auto-retired by safety floor: ${business.name} (ROI: ${business.roi}%)`)
    } else if (business.roi < -20 && business.monthlyRevenue > 0) warnings.push(`Declining: ${business.name} (ROI: ${business.roi}%)`)
  }
  return { checked: active.length, retired, warnings }
}

export interface CrossBusinessInsight { insightId: string; sourceBusinessId: string; sourceBusinessName: string; targetBusinessType: BusinessType; insight: string; confidence: number; createdAt: string; applied: boolean }
function insightKey(sourceBusinessId: string, targetType: BusinessType, kind: string): string { return `cross_insight:${sourceBusinessId}:${targetType}:${kind}` }

export async function shareBusinessInsights(sourceBusinessId: string): Promise<CrossBusinessInsight[]> {
  const sourceRecord = await db.memory.findFirst({ where: { key: sourceBusinessId, category: 'business_portfolio' } })
  if (!sourceRecord) return []
  const source = parseBusiness(sourceRecord.value)
  if (!source || (source.monthlyRevenue < 100 && source.customerCount < 5)) return []
  const targets = (await getActiveBusinesses()).filter((business) => business.businessId !== sourceBusinessId)
  const insightTypes = [
    { kind: 'automation', condition: source.automationLevel > 50, text: `Business "${source.name}" achieved ${source.automationLevel}% automation; reuse its automation patterns where applicable.` },
    { kind: 'customer_acquisition', condition: source.customerCount > 10, text: `Business "${source.name}" acquired ${source.customerCount} customers; test transferable acquisition patterns for similar markets.` },
    { kind: 'pricing', condition: source.monthlyRevenue > 500, text: `Business "${source.name}" generates $${source.monthlyRevenue}/month with pricing model "${source.pricingModel}"; test this model where evidence supports transfer.` },
    { kind: 'brand', condition: source.brandScore > 50, text: `Business "${source.name}" has brand score ${source.brandScore}/100; reuse relevant brand patterns in adjacent markets.` },
  ]
  const insights: CrossBusinessInsight[] = []
  const confidence = Math.min(100, source.monthlyRevenue / 10 + 30)
  for (const type of insightTypes) {
    if (!type.condition) continue
    for (const target of targets) {
      const key = insightKey(source.businessId, target.type, type.kind)
      if (await db.memory.findUnique({ where: { key } })) continue
      const record: CrossBusinessInsight = { insightId: key, sourceBusinessId: source.businessId, sourceBusinessName: source.name, targetBusinessType: target.type, insight: type.text, confidence, createdAt: new Date().toISOString(), applied: false }
      await db.memory.create({ data: { key, value: JSON.stringify(record), category: 'cross_business_insight' } })
      insights.push(record)
    }
  }
  return insights
}

export async function getCrossBusinessInsights(limit: number = 50): Promise<CrossBusinessInsight[]> {
  const records = await db.memory.findMany({ where: { category: 'cross_business_insight' }, orderBy: { createdAt: 'desc' }, take: Math.max(1, Math.min(100, limit)) })
  return records.map((record) => {
    try { return JSON.parse(record.value) as CrossBusinessInsight } catch { return null }
  }).filter((record): record is CrossBusinessInsight => record !== null)
}

export async function getPortfolio(): Promise<Business[]> {
  try {
    const records = await db.memory.findMany({ where: { category: 'business_portfolio' }, orderBy: { createdAt: 'desc' } })
    return records.map((record) => parseBusiness(record.value)).filter((business): business is Business => business !== null)
  } catch { return [] }
}
export async function getActiveBusinesses(): Promise<Business[]> { return (await getPortfolio()).filter((business) => business.lifecycle !== 'retired') }

export async function computeEnterpriseValue(): Promise<EnterpriseValue> {
  const all = await getPortfolio()
  const active = all.filter((business) => business.lifecycle === 'active' || business.lifecycle === 'scaling' || business.lifecycle === 'automated')
  const retired = all.filter((business) => business.lifecycle === 'retired')
  const totalRevenue = active.reduce((sum, business) => sum + business.monthlyRevenue, 0)
  const totalCustomers = active.reduce((sum, business) => sum + business.customerCount, 0)
  const totalEmails = active.reduce((sum, business) => sum + business.emailListSize, 0)
  const avgAutomation = active.length ? active.reduce((sum, business) => sum + business.automationLevel, 0) / active.length : 0
  const totalKnowledge = active.reduce((sum, business) => sum + business.knowledgeAssets, 0)
  const avgBrand = active.length ? active.reduce((sum, business) => sum + business.brandScore, 0) / active.length : 0
  let organizationalIQ = 0
  try {
    const { computeOrganizationalIQ } = await import('./evolution-engine')
    organizationalIQ = (await computeOrganizationalIQ()).totalScore
  } catch {}
  const recurringRevenue = Math.min(100, (totalRevenue / 20000) * 100)
  const businessAssets = Math.min(100, active.length * 20)
  const knowledgeGrowth = Math.min(100, totalKnowledge * 5)
  const customerGrowth = Math.min(100, totalCustomers * 2)
  const totalValue = Math.round(recurringRevenue * 0.25 + businessAssets * 0.15 + avgAutomation * 0.15 + knowledgeGrowth * 0.10 + customerGrowth * 0.15 + avgBrand * 0.10 + organizationalIQ * 0.10)
  return { totalValue, components: { recurringRevenue: Math.round(recurringRevenue), businessAssets: Math.round(businessAssets), automationScore: Math.round(avgAutomation), knowledgeGrowth: Math.round(knowledgeGrowth), customerGrowth: Math.round(customerGrowth), brandAuthority: Math.round(avgBrand), organizationalIQ: Math.round(organizationalIQ) }, totalMonthlyRevenue: totalRevenue, totalCustomers, totalEmails, activeBusinesses: active.length, retiredBusinesses: retired.length }
}

export type FlywheelStage = 'observe' | 'identify_opportunity' | 'estimate_value' | 'validate' | 'build_mvp' | 'acquire_customers' | 'learn' | 'automate' | 'scale' | 'standardize' | 'teach_organization'
export interface FlywheelResult { cycleId: string; startedAt: string; completedAt: string | null; currentStage: FlywheelStage; stages: Array<{ stage: FlywheelStage; status: 'pending' | 'running' | 'complete'; output: string }>; opportunity: string | null; businessId: string | null; estimatedValue: number | null; validated: boolean | null; learnings: string[]; status: 'running' | 'complete' | 'failed' }
const FLYWHEEL_STAGES: Array<{ stage: FlywheelStage; description: string }> = [
  { stage: 'observe', description: 'Observe market trends, customer pain points, competitor weaknesses.' },
  { stage: 'identify_opportunity', description: 'Identify a specific business opportunity.' },
  { stage: 'estimate_value', description: 'Estimate enterprise value from evidence and explicit assumptions.' },
  { stage: 'validate', description: 'Validate demand using external evidence; no synthetic validation is permitted.' },
  { stage: 'build_mvp', description: 'Build the minimum viable commercial asset.' },
  { stage: 'acquire_customers', description: 'Run acquisition experiments; launch status requires verified evidence.' },
  { stage: 'learn', description: 'Learn from customer feedback and actual usage data.' },
  { stage: 'automate', description: 'Automate repetitive processes.' },
  { stage: 'scale', description: 'Scale only when real revenue/customer evidence supports it.' },
  { stage: 'standardize', description: 'Standardize successful patterns into reusable processes.' },
  { stage: 'teach_organization', description: 'Feed verified learnings back to the Organizational Knowledge Base.' },
]

export async function runFlywheel(mode: 'full' | 'single' = 'full', startStage?: FlywheelStage): Promise<FlywheelResult> {
  const cycleId = `flywheel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const result: FlywheelResult = { cycleId, startedAt: new Date().toISOString(), completedAt: null, currentStage: 'observe', stages: FLYWHEEL_STAGES.map(({ stage }) => ({ stage, status: 'pending' as const, output: '' })), opportunity: null, businessId: null, estimatedValue: null, validated: null, learnings: [], status: 'running' }
  const stagesToRun = mode === 'single' && startStage ? FLYWHEEL_STAGES.filter(({ stage }) => stage === startStage) : FLYWHEEL_STAGES
  for (const { stage, description } of stagesToRun) {
    result.currentStage = stage
    const entry = result.stages.find((item) => item.stage === stage)
    if (!entry) continue
    entry.status = 'running'
    try { entry.output = await executeFlywheelStage(stage, result, description); entry.status = 'complete' }
    catch (error) { entry.status = 'complete'; entry.output = `Error: ${error instanceof Error ? error.message.slice(0, 120) : 'unknown error'}`; result.learnings.push(`Stage ${stage} encountered an error.`) }
    if (mode === 'single') break
  }
  result.completedAt = new Date().toISOString()
  result.currentStage = stagesToRun[stagesToRun.length - 1]?.stage ?? 'observe'
  result.status = result.learnings.some((item) => item.includes('error')) ? 'failed' : 'complete'
  try { await db.memory.create({ data: { key: cycleId, value: JSON.stringify(result), category: 'flywheel_cycle' } }) } catch {}
  return result
}

async function executeFlywheelStage(stage: FlywheelStage, context: FlywheelResult, _description: string): Promise<string> {
  switch (stage) {
    case 'observe': return 'Observation stage completed; external market-research capabilities should provide the evidence feed.'
    case 'identify_opportunity': {
      const completion = await callLlmWithRetry([{ role: 'system', content: 'You are Agent007 Venture Studio. Identify one specific digital business opportunity suitable for rapid evidence-based validation. Do not claim validation or revenue.' }, { role: 'user', content: 'Identify the strongest current opportunity candidate and explain the target customer problem.' }])
      const opportunity = completion?.choices?.[0]?.message?.content?.trim() || 'No opportunity identified.'
      context.opportunity = opportunity
      return opportunity
    }
    case 'estimate_value': return 'Value estimate requires explicit assumptions and evidence; no synthetic numeric score is generated by the Flywheel.'
    case 'validate': context.validated = false; return 'Validation is pending verified market evidence. The Flywheel will not self-certify demand.'
    case 'build_mvp':
      if (!context.opportunity) return 'MVP build skipped — no opportunity identified.'
      {
        const business = await createBusiness({ name: context.opportunity.slice(0, 50), type: 'saas', description: context.opportunity, targetMarket: 'AI-savvy entrepreneurs and small businesses', pricingModel: 'subscription' })
        context.businessId = business.businessId
        return `MVP business record prepared: ${business.name} (${business.businessId}).`
      }
    case 'acquire_customers': return context.businessId ? 'Acquisition experiment definition created. Launch and customer status require verified external evidence.' : 'Customer acquisition skipped — no business exists.'
    case 'learn': context.learnings.push('Customer feedback, conversion, retention and satisfaction must be recorded as external evidence.'); return 'Learning requirements recorded; no synthetic customer outcome created.'
    case 'automate':
      if (context.businessId) { await updateBusiness(context.businessId, { automationLevel: 40 }); return 'Baseline automation state recorded at 40%; production automation evidence can raise this value.' }
      return 'Automation skipped — no business exists.'
    case 'scale': return context.businessId ? 'Scale gate reached. Real revenue/customer evidence is required before scaling lifecycle or metrics.' : 'Scaling skipped — no business exists.'
    case 'standardize': context.learnings.push('Only verified successful patterns should be standardized for reuse.'); return 'Standardization requirements recorded.'
    case 'teach_organization':
      try {
        const { ingestMission } = await import('./organizational-knowledge-base')
        const { startMissionTelemetry, completeMissionTelemetry } = await import('./mission-telemetry')
        const telemetry = startMissionTelemetry(`Flywheel cycle: ${context.opportunity || 'unknown opportunity'}`)
        telemetry.leadersUsed = ['venture_studio']
        telemetry.confidence = context.validated ? 75 : 50
        telemetry.verificationPassed = false
        telemetry.verificationScore = 0
        await completeMissionTelemetry(telemetry, 'completed')
        await ingestMission(telemetry)
        return 'Flywheel learning recorded without falsely claiming verified market success.'
      } catch { return 'Knowledge transfer unavailable; no false success claim emitted.' }
  }
}

export interface DualMission { leaderId: string; missionA: { description: string; kpis: string[] }; missionB: { description: string; kpis: string[] } }
export const DUAL_MISSIONS: DualMission[] = [
  { leaderId: 'ceo', missionA: { description: 'Grow the organization', kpis: ['Strategic decisions', 'Mission success', 'Revenue growth', 'Organizational IQ'] }, missionB: { description: 'Increase organizational knowledge about strategic decision-making patterns', kpis: ['Decision patterns documented', 'Strategy learnings stored'] } },
  { leaderId: 'quantum', missionA: { description: 'Increase revenue', kpis: ['Investment quality', 'Business ROI', 'Profitability'] }, missionB: { description: 'Increase organizational knowledge about financial systems and revenue patterns', kpis: ['Financial patterns learned', 'Revenue model insights'] } },
  { leaderId: 'forge', missionA: { description: 'Reduce manual work', kpis: ['Processes automated', 'Hours saved'] }, missionB: { description: 'Increase organizational knowledge about automation patterns and reusable code', kpis: ['Automation patterns documented', 'Reusable components created'] } },
  { leaderId: 'scout', missionA: { description: 'Find opportunities', kpis: ['Qualified opportunities', 'Market analyses', 'Validated ideas'] }, missionB: { description: 'Increase organizational knowledge about market analysis and opportunity validation', kpis: ['Market patterns learned', 'Opportunity signals documented'] } },
  { leaderId: 'echo', missionA: { description: 'Protect quality', kpis: ['Errors prevented', 'Hallucinations caught', 'Verification score'] }, missionB: { description: 'Increase organizational knowledge about error patterns and quality verification', kpis: ['Error patterns documented', 'Quality rules learned'] } },
  { leaderId: 'aurora', missionA: { description: 'Create content that generates revenue', kpis: ['Content published', 'Engagement rate', 'Conversion rate'] }, missionB: { description: 'Increase organizational knowledge about content patterns and audience preferences', kpis: ['Content patterns learned', 'Audience insights documented'] } },
  { leaderId: 'hunt', missionA: { description: 'Find freelance and gig opportunities', kpis: ['Gigs identified', 'Gigs won', 'Revenue generated'] }, missionB: { description: 'Increase organizational knowledge about freelance market dynamics', kpis: ['Freelance patterns learned', 'Platform insights documented'] } },
  { leaderId: 'trader', missionA: { description: 'Generate trading revenue', kpis: ['Trade success rate', 'Portfolio growth', 'Risk-adjusted returns'] }, missionB: { description: 'Increase organizational knowledge about market dynamics and trading patterns', kpis: ['Market patterns learned', 'Risk insights documented'] } },
  { leaderId: 'venture_studio', missionA: { description: 'Create and launch new businesses', kpis: ['Businesses proposed', 'Businesses validated', 'Businesses launched'] }, missionB: { description: 'Increase organizational knowledge about business creation patterns and venture lifecycle', kpis: ['Venture patterns learned', 'Success factors documented'] } },
]
export function getDualMissions(): DualMission[] { return DUAL_MISSIONS }
export function getDualMission(leaderId: string): DualMission | null { return DUAL_MISSIONS.find((mission) => mission.leaderId === leaderId) || null }
