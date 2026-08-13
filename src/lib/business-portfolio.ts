/**
 * business-portfolio.ts — UPGRADE #228
 *
 * The Business Portfolio Manager + Business Flywheel + Dual Leader Missions.
 *
 * This remains the portfolio source of truth. Venture OS governs new venture
 * identity and strategic decisions; this module owns persistence and the
 * lower-level business lifecycle primitives.
 */

import { db } from './db'
import { callLlmWithRetry } from './agent'

export const runtime = 'nodejs'

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

function normalizeBusinessName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

/**
 * Create a business once. Same normalized name always resolves to the existing
 * portfolio record, including callers that bypass Venture OS (e.g. Flywheel).
 */
export async function createBusiness(input: {
  name: string
  type: BusinessType
  description: string
  targetMarket?: string
  pricingModel?: string
}): Promise<Business> {
  const normalizedName = normalizeBusinessName(input.name)
  if (!normalizedName) throw new Error('Business name is required.')

  const existing = await db.memory.findFirst({ where: { category: 'business_portfolio' } })
  // Avoid a broad scan for the common case; the existing Memory schema has no
  // normalized-name index, so reconcile against portfolio rows only once here.
  if (existing) {
    const records = await db.memory.findMany({ where: { category: 'business_portfolio' } })
    const duplicate = records.map((record) => {
      try { return JSON.parse(record.value) as Business } catch { return null }
    }).find((business): business is Business => !!business && normalizeBusinessName(business.name) === normalizedName)
    if (duplicate) return duplicate
  }

  const business: Business = {
    businessId: `biz_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: input.name.trim(),
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
    // Unique-key races may occur under concurrent creation. Reconcile by name.
    const records = await db.memory.findMany({ where: { category: 'business_portfolio' } })
    const duplicate = records.map((record) => {
      try { return JSON.parse(record.value) as Business } catch { return null }
    }).find((candidate): candidate is Business => !!candidate && normalizeBusinessName(candidate.name) === normalizedName)
    if (duplicate) return duplicate
    console.error('[portfolio] Failed to create business:', e?.message)
    throw e
  }

  return business
}

/** Update a business. Derived financial fields are recalculated here only. */
export async function updateBusiness(businessId: string, updates: Partial<Business>): Promise<Business | null> {
  try {
    const record = await db.memory.findFirst({ where: { key: businessId, category: 'business_portfolio' } })
    if (!record) return null

    const business: Business = { ...JSON.parse(record.value), ...updates }
    business.netRevenue = business.monthlyRevenue - business.monthlyCost
    business.roi = business.monthlyCost > 0 ? (business.netRevenue / business.monthlyCost) * 100 : 0

    await db.memory.update({
      where: { id: record.id },
      data: { value: JSON.stringify(business) },
    })

    if ((business.lifecycle === 'active' || business.lifecycle === 'scaling') && business.roi < -20 && business.monthlyRevenue > 0) {
      console.log(`[portfolio] Business ${business.name} has declining ROI (${business.roi}%) — warning; strategic decision engine remains authoritative for lifecycle action.`)
    }

    return business
  } catch (e: any) {
    console.error('[portfolio] Failed to update business:', e?.message)
    return null
  }
}

/** Retire a business (strategic kill decisions are coordinated by Venture OS). */
export async function retireBusiness(businessId: string, reason: string): Promise<void> {
  try {
    const record = await db.memory.findFirst({ where: { key: businessId, category: 'business_portfolio' } })
    if (!record) return

    const business: Business = JSON.parse(record.value)
    if (business.lifecycle === 'retired') return
    business.lifecycle = 'retired'
    business.retiredAt = new Date().toISOString()
    business.retirementReason = reason

    await db.memory.update({ where: { id: record.id }, data: { value: JSON.stringify(business) } })
    console.log(`[portfolio] Business retired: ${business.name} — reason: ${reason}`)
  } catch (e: any) {
    console.error('[portfolio] Failed to retire business:', e?.message)
    throw e
  }
}

/** Store a failure lesson once for each retired business. */
async function recoverResources(business: Business): Promise<void> {
  try {
    const key = `recovered_${business.businessId}`
    const existing = await db.memory.findUnique({ where: { key } })
    if (existing) return
    await db.memory.create({
      data: {
        key,
        value: JSON.stringify({
          businessName: business.name,
          businessType: business.type,
          retirementReason: business.retirementReason,
          finalRevenue: business.monthlyRevenue,
          finalROI: business.roi,
          customerCount: business.customerCount,
          automationLevel: business.automationLevel,
          targetMarket: business.targetMarket,
          pricingModel: business.pricingModel,
          lesson: `Business "${business.name}" (${business.type}) was retired with ROI ${business.roi}%. Avoid similar market/pricing combinations in future ventures.`,
          recoveredAt: new Date().toISOString(),
        }),
        category: 'business_retirement_log',
      },
    })
    console.log(`[portfolio] Resources recovered from ${business.name} — failure lesson stored`)
  } catch (e: any) {
    console.error('[portfolio] Resource recovery failed:', e?.message)
  }
}

/**
 * Portfolio safety sweep. This is a financial safety backstop, not the primary
 * strategic decision engine. It uses one hard floor and produces warnings.
 */
export async function checkPortfolioHealth(): Promise<{ checked: number; retired: number; warnings: string[] }> {
  const businesses = await getActiveBusinesses()
  const active = businesses.filter(b => b.lifecycle === 'active' || b.lifecycle === 'scaling')
  const warnings: string[] = []
  let retired = 0

  for (const business of active) {
    if (business.roi < -50 && business.monthlyRevenue > 0) {
      await retireBusiness(business.businessId, `Financial safety floor: ROI ${business.roi}%`)
      await recoverResources(business)
      retired++
      warnings.push(`Auto-retired by safety floor: ${business.name} (ROI: ${business.roi}%)`)
    } else if (business.roi < -20 && business.monthlyRevenue > 0) {
      warnings.push(`Declining: ${business.name} (ROI: ${business.roi}%)`)
    }
  }

  console.log(`[portfolio] Health check: ${active.length} checked, ${retired} retired, ${warnings.length} warnings`)
  return { checked: active.length, retired, warnings }
}
