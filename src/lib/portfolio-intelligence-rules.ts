import { CEO_VENTURE_MANDATE } from './venture-mandate'
import type { PortfolioOperationalDecision } from './portfolio-decision-contract'
import type { AllocationRecommendation, PortfolioMetric } from './portfolio-intelligence-types'

const c = (n: number) => Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0
const minConfidence = CEO_VENTURE_MANDATE.validationConfidenceMinimum * 100

export function normalizeMetric(m: PortfolioMetric): PortfolioMetric {
  return { ...m, revenue: Math.max(0, m.revenue), cost: Math.max(0, m.cost), customers: Math.max(0, m.customers), leads: m.leads === null ? null : Math.max(0, m.leads), conversions: m.conversions === null ? null : Math.max(0, m.conversions), automation: m.automation === null ? null : c(m.automation), satisfaction: m.satisfaction === null ? null : c(m.satisfaction), confidence: c(m.confidence), observedPeriods: Math.max(0, Math.floor(m.observedPeriods)), evidenceIds: [...(m.evidenceIds ?? [])] }
}

export function healthScore(m: PortfolioMetric) {
  const a: number[] = []
  if (m.revenue > 0) a.push(c((m.revenue - m.cost) / m.revenue * 100))
  if (m.leads !== null && m.conversions !== null && m.leads > 0) a.push(c(m.conversions / m.leads * 100))
  if (m.automation !== null) a.push(c(m.automation))
  if (m.satisfaction !== null) a.push(c(m.satisfaction))
  a.push(c(m.confidence))
  return a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0
}

export function optimize(m: PortfolioMetric): AllocationRecommendation {
  const s = healthScore(m)
  const q = c(m.confidence)
  const ids = [...(m.evidenceIds ?? [])]
  let d: PortfolioOperationalDecision = 'hold'
  if (q < minConfidence) d = 'hold'
  else if (s >= CEO_VENTURE_MANDATE.scaleHealthMinimum) d = 'scale'
  else if (s <= CEO_VENTURE_MANDATE.killHealthMaximum && m.observedPeriods >= 2) d = 'kill'
  else if (s < CEO_VENTURE_MANDATE.experimentHealthMinimum) d = 'experiment'
  else if (s < CEO_VENTURE_MANDATE.optimizeHealthMinimum) d = 'optimize'
  return { business: m.business, decision: d, score: s, confidence: q, rationale: `health=${s};confidence=${q};minimumConfidence=${minConfidence};periods=${m.observedPeriods};evidence=${ids.length}`, priority: s * q / 100, requiresHumanApproval: d === 'scale' || d === 'kill', evidenceIds: ids }
}
