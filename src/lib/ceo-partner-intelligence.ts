import { db } from './db'

export type PartnerHealth = 'thriving' | 'stable' | 'at_risk' | 'dormant'

export interface PartnerRelationshipSignal {
  id: string
  partnerName: string
  partnerType: string
  status: string
  revenueGenerated: number
  commissionRate: number
  daysSinceUpdate: number
  health: PartnerHealth
}

export interface PartnerIntelligenceSummary {
  // Distinguishes "no partner data was fetched for this turn" from "fetched, and there are
  // genuinely zero partnerships" -- the same class of honesty gap fixed in ceo-world-model.ts's
  // system facet: a facet that always reads as empty regardless of the real underlying state.
  dataAvailable: boolean
  totalPartners: number
  activePartners: number
  atRiskCount: number
  dormantCount: number
  totalRevenueGenerated: number
  topPartners: readonly PartnerRelationshipSignal[]
  atRiskPartners: readonly PartnerRelationshipSignal[]
}

export const EMPTY_PARTNER_INTELLIGENCE: PartnerIntelligenceSummary = Object.freeze({
  dataAvailable: false,
  totalPartners: 0,
  activePartners: 0,
  atRiskCount: 0,
  dormantCount: 0,
  totalRevenueGenerated: 0,
  topPartners: [],
  atRiskPartners: [],
})

// Real classification from real signals already on the Partnership row, not a fabricated score:
// a non-active partnership (paused/ended/proposed) that hasn't been touched in a while is dormant,
// one still fresh is merely at_risk (it may just be newly proposed); an active partnership decays
// from thriving -> stable -> at_risk purely as a function of how long it's gone untouched, with
// generated revenue distinguishing a proven relationship from an unproven one at the healthy end.
export function classifyPartnerHealth(status: string, daysSinceUpdate: number, revenueGenerated: number): PartnerHealth {
  if (status !== 'active') return daysSinceUpdate > 60 ? 'dormant' : 'at_risk'
  if (daysSinceUpdate <= 30) return revenueGenerated > 0 ? 'thriving' : 'stable'
  if (daysSinceUpdate <= 90) return 'stable'
  return 'at_risk'
}

export async function getPartnerIntelligence(userId: string, now: number = Date.now()): Promise<PartnerIntelligenceSummary> {
  const partnerships = await db.partnership.findMany({ where: { userId } })
  if (!partnerships.length) return { ...EMPTY_PARTNER_INTELLIGENCE, dataAvailable: true }
  const signals: PartnerRelationshipSignal[] = partnerships.map((partnership) => {
    const daysSinceUpdate = Math.max(0, Math.floor((now - new Date(partnership.updatedAt).getTime()) / 86_400_000))
    return {
      id: partnership.id,
      partnerName: partnership.partnerName,
      partnerType: partnership.partnerType,
      status: partnership.status,
      revenueGenerated: partnership.revenueGenerated,
      commissionRate: partnership.commissionRate,
      daysSinceUpdate,
      health: classifyPartnerHealth(partnership.status, daysSinceUpdate, partnership.revenueGenerated),
    }
  })
  const activePartners = signals.filter((signal) => signal.status === 'active').length
  const atRiskPartners = signals.filter((signal) => signal.health === 'at_risk').sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate)
  const dormantCount = signals.filter((signal) => signal.health === 'dormant').length
  const totalRevenueGenerated = signals.reduce((sum, signal) => sum + signal.revenueGenerated, 0)
  const topPartners = [...signals].sort((a, b) => b.revenueGenerated - a.revenueGenerated).slice(0, 5)
  return {
    dataAvailable: true,
    totalPartners: signals.length,
    activePartners,
    atRiskCount: atRiskPartners.length,
    dormantCount,
    totalRevenueGenerated,
    topPartners,
    atRiskPartners: atRiskPartners.slice(0, 5),
  }
}

export function renderPartnerIntelligenceContext(summary: PartnerIntelligenceSummary): string {
  if (!summary.dataAvailable) return 'Partner relationship data was not fetched for this turn.'
  if (summary.totalPartners === 0) return 'No partnerships tracked yet.'
  const top = summary.topPartners.map((partner) => `${partner.partnerName} (${partner.health}, $${partner.revenueGenerated.toFixed(2)} generated)`).join('; ')
  const atRisk = summary.atRiskPartners.length ? ` At risk: ${summary.atRiskPartners.map((partner) => partner.partnerName).join(', ')}.` : ''
  return `${summary.totalPartners} partnership(s) tracked, ${summary.activePartners} active, $${summary.totalRevenueGenerated.toFixed(2)} total revenue generated. Top: ${top}.${atRisk}`
}
