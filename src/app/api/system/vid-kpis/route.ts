/**
 * /api/system/vid-kpis — VID Division KPIs (REAL DATA)
 *
 * Aggregates real portfolio metrics from the business-portfolio lib so the
 * VID tab can display live numbers instead of seeded placeholders.
 *
 * Response shape (all numbers are computed from real DB rows):
 * {
 *   ok: true,
 *   kpis: {
 *     businessesCreated:    number,  // total businesses ever created
 *     businessesValidated:  number,  // businesses past the validation stage
 *     businessesLaunched:   number,  // businesses with launchedAt set
 *     revenue:              number,  // sum of monthlyRevenue (MRR)
 *     portfolioROI:         number,  // sum(netRevenue) / sum(monthlyCost) — guarded
 *     successRate:          number,  // % of launched that hit $1K MRR
 *     timeToRevenueDays:    number,  // median days createdAt→launchedAt
 *     orgLearning:          number,  // sum of knowledgeAssets
 *     enterpriseValue:      number,  // from computeEnterpriseValue
 *     knowledgeTransferRate: number, // 0..1 — derived from automationLevel + knowledgeAssets + validation rate
 *   },
 *   portfolio: { count, activeCount, retiredCount },
 *   ventures: [{ id, name, type, lifecycle, mrr, customers, automationLevel, knowledgeAssets, score }]
 * }
 */
import { NextResponse } from 'next/server'
import { getPortfolio, getActiveBusinesses, computeEnterpriseValue } from '@/lib/business-portfolio'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

/** Compute median of an array of numbers (returns 0 for empty). */
function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

/** Map lifecycle stage to a numeric 0..1 progress score (idea → scaling). */
function lifecycleProgress(lifecycle: string | null | undefined): number {
  if (!lifecycle) return 0
  const map: Record<string, number> = {
    idea: 0.1,
    validating: 0.25,
    validated: 0.4,
    designing: 0.55,
    building: 0.7,
    launching: 0.85,
    launched: 0.9,
    scaling: 1.0,
    mature: 1.0,
    declining: 0.5,
    retired: 0,
  }
  return map[lifecycle.toLowerCase()] ?? 0.3
}

export async function GET() {
  try {
    const [allBusinesses, activeBusinesses, enterpriseValue] = await Promise.all([
      getPortfolio(),
      getActiveBusinesses(),
      computeEnterpriseValue(),
    ])

    const businessesCreated = allBusinesses.length
    const businessesLaunched = allBusinesses.filter((b: any) => !!b.launchedAt).length
    const businessesValidated = allBusinesses.filter((b: any) => {
      const lc = (b.lifecycle ?? '').toLowerCase()
      return !['idea', 'validating', 'retired'].includes(lc)
    }).length

    const revenue = activeBusinesses.reduce((sum: number, b: any) => sum + (Number(b.monthlyRevenue) || 0), 0)

    const totalCost = allBusinesses.reduce((s: number, b: any) => s + (Number(b.monthlyCost) || 0), 0)
    const totalNetRevenue = allBusinesses.reduce((s: number, b: any) => s + (Number(b.netRevenue) || 0), 0)
    const totalRevenue = allBusinesses.reduce((s: number, b: any) => s + (Number(b.totalRevenue) || 0), 0)
    const portfolioROI = totalCost > 0
      ? Number((totalNetRevenue / totalCost).toFixed(2))
      : (totalRevenue > 0 ? Number(((revenue * 12) / Math.max(totalRevenue, 1)).toFixed(2)) : 0)

    const successful = allBusinesses.filter((b: any) => Number(b.monthlyRevenue) >= 1000).length
    const successRate = businessesLaunched > 0
      ? Number((successful / businessesLaunched).toFixed(2))
      : 0

    const timeToRevenueDays = median(
      allBusinesses
        .filter((b: any) => b.launchedAt && b.createdAt)
        .map((b: any) => {
          const created = new Date(b.createdAt).getTime()
          const launched = new Date(b.launchedAt).getTime()
          return Math.max(0, Math.round((launched - created) / (1000 * 60 * 60 * 24)))
        })
    )

    const orgLearning = allBusinesses.reduce((s: number, b: any) => s + (Number(b.knowledgeAssets) || 0), 0)

    const activeCount = activeBusinesses.length
    const avgAutomation = activeCount > 0
      ? activeBusinesses.reduce((s: number, b: any) => s + (Number(b.automationLevel) || 0), 0) / activeCount / 100
      : 0
    const knowledgeShare = activeCount > 0
      ? Math.min(1, orgLearning / (activeCount * 5))
      : 0
    const validationRate = businessesCreated > 0
      ? businessesValidated / businessesCreated
      : 0
    const knowledgeTransferRate = Number(
      Math.min(1, Math.max(0, 0.4 * avgAutomation + 0.3 * knowledgeShare + 0.3 * validationRate)).toFixed(2)
    )

    const ventures = allBusinesses.map((b: any) => {
      const mrr = Number(b.monthlyRevenue) || 0
      const automation = Number(b.automationLevel) || 0
      const customers = Number(b.customerCount) || 0
      const progress = lifecycleProgress(b.lifecycle)
      const score = Math.round(
        Math.min(100,
          20 * progress +
          15 * (automation / 100) +
          15 * Math.min(1, mrr / 1000) +
          15 * Math.min(1, customers / 50) +
          10 * (mrr > 0 ? 1 : 0) +
          10 * ((Number(b.brandScore) || 0) / 100) +
          15 * (b.pricingModel ? 1 : 0)
        )
      )
      return {
        id: b.businessId,
        name: (b.name ?? '').slice(0, 80),
        type: b.type,
        lifecycle: b.lifecycle,
        mrr,
        customers,
        automationLevel: automation,
        knowledgeAssets: Number(b.knowledgeAssets) || 0,
        score,
      }
    })

    return NextResponse.json({
      ok: true,
      kpis: {
        businessesCreated,
        businessesValidated,
        businessesLaunched,
        revenue,
        portfolioROI,
        successRate,
        timeToRevenueDays,
        orgLearning,
        enterpriseValue: Number(enterpriseValue.totalValue ?? 0),
        knowledgeTransferRate,
      },
      portfolio: {
        count: allBusinesses.length,
        activeCount: activeBusinesses.length,
        retiredCount: allBusinesses.length - activeBusinesses.length,
      },
      ventures,
      generatedAt: new Date().toISOString(),
    })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'Failed to compute VID KPIs' },
      { status: 500 }
    )
  }
}
