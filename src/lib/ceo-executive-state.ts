import { db } from './db'
import { calculateOperationalKpis, type OperationalKpiSnapshot } from './operational-kpi-engine'
import { summarizeRecommendationLedger, type RecommendationLedgerSummary } from './ceo-outcome-learning'

export interface ExecutiveStrategyItem {
  id: string
  phase: string
  title: string
  status: string
  priority: string
  progress: number
  targetDate: string | null
}

export interface ExecutiveBusinessState {
  // No persisted vision/mission data source exists anywhere in this codebase -- only two
  // independently-drifted hardcoded prompt strings (agent.ts, autonomous-strategic-planner.ts),
  // neither of which is queryable data. Rendering one of them here as "the CEO's vision" would be
  // exactly the kind of fabricated-from-a-static-string gap this module exists to avoid, so this
  // dimension stays honestly unavailable until a real, single, editable vision record exists.
  vision: { dataAvailable: false }
  strategy: { dataAvailable: boolean; items: readonly ExecutiveStrategyItem[] }
  risk: { dataAvailable: boolean; ventureId?: string; status?: string; score?: number; threshold?: number; missingEvidence: readonly string[] }
  customers: { dataAvailable: boolean; ventureId?: string; totalCustomersWithState: number; atRisk: number; churned: number; averageHealthScore: number | null }
  resources: { dataAvailable: boolean; ventureId?: string; grossRevenue?: number; netRevenue?: number; currency?: string | null; autonomyMode?: string; leaseHealthy?: boolean }
  // Executive causal spine (2026-09-12): the durable recommendation/decision ledger already owned
  // by ceo-outcome-learning.ts, summarized here rather than duplicated -- see
  // summarizeRecommendationLedger's own comment for why "open" is correlation-based, not inferred.
  decisions: RecommendationLedgerSummary & { dataAvailable: boolean }
}

export const EMPTY_EXECUTIVE_BUSINESS_STATE: ExecutiveBusinessState = Object.freeze<ExecutiveBusinessState>({
  vision: { dataAvailable: false },
  strategy: { dataAvailable: false, items: [] },
  risk: { dataAvailable: false, missingEvidence: [] },
  customers: { dataAvailable: false, totalCustomersWithState: 0, atRisk: 0, churned: 0, averageHealthScore: null },
  resources: { dataAvailable: false },
  decisions: { dataAvailable: false, total: 0, open: 0, awaitingOutcome: 0, overdueReview: 0, reviewedCount: 0 },
})

// calculateOperationalKpis already computes venture readiness (risk), revenue/autonomy
// (resources) and customer-success health (customers) in one pass -- reusing it here instead of
// re-deriving any of those three dimensions independently.
async function getVentureExecutiveSlice(ventureId: string): Promise<Pick<ExecutiveBusinessState, 'risk' | 'customers' | 'resources'>> {
  let kpi: OperationalKpiSnapshot
  try {
    kpi = await calculateOperationalKpis(ventureId, 24)
  } catch {
    return { risk: EMPTY_EXECUTIVE_BUSINESS_STATE.risk, customers: EMPTY_EXECUTIVE_BUSINESS_STATE.customers, resources: EMPTY_EXECUTIVE_BUSINESS_STATE.resources }
  }
  return {
    risk: { dataAvailable: true, ventureId, status: kpi.readiness.status, score: kpi.readiness.score, threshold: kpi.readiness.threshold, missingEvidence: kpi.readiness.missingEvidence },
    customers: kpi.customerSuccess
      ? { dataAvailable: true, ventureId, totalCustomersWithState: kpi.customerSuccess.totalCustomersWithState, atRisk: kpi.customerSuccess.atRisk, churned: kpi.customerSuccess.churned, averageHealthScore: kpi.customerSuccess.averageHealthScore }
      : EMPTY_EXECUTIVE_BUSINESS_STATE.customers,
    resources: { dataAvailable: true, ventureId, grossRevenue: kpi.outcomes.grossRevenue, netRevenue: kpi.outcomes.netRevenue, currency: kpi.outcomes.currency, autonomyMode: kpi.autonomy.mode, leaseHealthy: kpi.autonomy.leaseHealthy },
  }
}

// BusinessStrategy.priority is a free-form string ('low'|'medium'|'high'), so Prisma's own
// `orderBy: priority desc` sorts it alphabetically (medium, low, high) rather than by actual
// importance -- ranked explicitly here instead, with an unrecognized value sorting last, not first.
const PRIORITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 }
function priorityRank(priority: string): number { return PRIORITY_RANK[priority] ?? 0 }

export async function getExecutiveBusinessState(input: { userId: string; ventureId?: string }): Promise<ExecutiveBusinessState> {
  const [strategyRows, ventureSlice, decisionSummary] = await Promise.all([
    db.businessStrategy.findMany({ where: { userId: input.userId, status: { in: ['planned', 'in_progress', 'active'] } }, orderBy: { updatedAt: 'desc' }, take: 20 }),
    input.ventureId ? getVentureExecutiveSlice(input.ventureId) : Promise.resolve(null),
    summarizeRecommendationLedger(input.ventureId ? { ventureId: input.ventureId } : {}),
  ])
  const strategy: ExecutiveStrategyItem[] = strategyRows
    .map((row) => ({ id: row.id, phase: row.phase, title: row.title, status: row.status, priority: row.priority, progress: row.progress, targetDate: row.targetDate ? row.targetDate.toISOString() : null }))
    .sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority))
  return {
    vision: { dataAvailable: false },
    strategy: { dataAvailable: true, items: strategy },
    risk: ventureSlice?.risk ?? EMPTY_EXECUTIVE_BUSINESS_STATE.risk,
    customers: ventureSlice?.customers ?? EMPTY_EXECUTIVE_BUSINESS_STATE.customers,
    resources: ventureSlice?.resources ?? EMPTY_EXECUTIVE_BUSINESS_STATE.resources,
    decisions: { dataAvailable: true, ...decisionSummary },
  }
}

export function renderExecutiveBusinessStateContext(state: ExecutiveBusinessState): string {
  const lines: string[] = []
  lines.push(
    state.strategy.dataAvailable
      ? state.strategy.items.length
        ? `Strategy: ${state.strategy.items.map((item) => `${item.title} (${item.status}, ${Math.round(item.progress * 100)}%)`).join('; ')}`
        : 'Strategy: no active strategy items tracked.'
      : 'Strategy: not fetched for this turn.',
  )
  lines.push(
    state.risk.dataAvailable
      ? `Risk/readiness: ${state.risk.status} (score ${state.risk.score}/${state.risk.threshold})${state.risk.missingEvidence.length ? `; missing evidence: ${state.risk.missingEvidence.join(', ')}` : ''}`
      : 'Risk/readiness: not evaluated for this turn (no venture in scope).',
  )
  lines.push(
    state.customers.dataAvailable
      ? `Customer relationships: ${state.customers.totalCustomersWithState} tracked, ${state.customers.atRisk} at risk, ${state.customers.churned} churned${state.customers.averageHealthScore != null ? `, avg health ${state.customers.averageHealthScore}` : ''}`
      : 'Customer relationships: not evaluated for this turn (no venture in scope).',
  )
  lines.push(
    state.resources.dataAvailable
      ? `Resources: $${state.resources.grossRevenue?.toFixed(2)} gross / $${state.resources.netRevenue?.toFixed(2)} net revenue (24h)${state.resources.currency ? ` ${state.resources.currency}` : ''}, autonomy ${state.resources.autonomyMode}${state.resources.leaseHealthy ? '' : ' (lease unhealthy)'}`
      : 'Resources: not evaluated for this turn (no venture in scope).',
  )
  lines.push(
    state.decisions.dataAvailable
      ? state.decisions.total
        ? `Executive decisions: ${state.decisions.total} recorded, ${state.decisions.open} open, ${state.decisions.awaitingOutcome} awaiting outcome${state.decisions.overdueReview ? `, ${state.decisions.overdueReview} overdue for review` : ''}${state.decisions.reviewedCount ? `, ${state.decisions.reviewedCount} reviewed by an owner` : ''}.`
        : 'Executive decisions: none recorded yet.'
      : 'Executive decisions: not evaluated for this turn.',
  )
  return lines.join('\n')
}
