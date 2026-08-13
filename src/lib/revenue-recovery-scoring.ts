import { recordCommercialEvidence } from './commercial-control-plane'
import type { FunnelSnapshot, RecoveryOpportunity, RecoveryPlan } from './revenue-recovery-contract'

function money(value: number): number { return Math.round(Math.max(0, value) * 100) / 100 }
function makeOpportunity(snapshot: FunnelSnapshot, type: RecoveryOpportunity['type'], estimatedRevenue: number, rationale: string, action: string): RecoveryOpportunity {
  const revenue = money(estimatedRevenue)
  const margin = Math.max(0, Math.min(1, (snapshot.grossMarginPercent ?? 60) / 100))
  const confidence = Math.max(0.35, Math.min(0.98, snapshot.confidence * (revenue > 0 ? 1 : 0.7)))
  const weighted = revenue * confidence
  return {
    opportunityId: `${type}:${snapshot.snapshotId}`,
    tenantId: snapshot.tenantId,
    customerId: snapshot.customerId,
    type,
    priority: weighted >= 5000 ? 'critical' : weighted >= 2000 ? 'high' : weighted >= 500 ? 'medium' : 'low',
    estimatedRevenue: revenue,
    estimatedGrossProfit: money(revenue * margin),
    confidence: Math.round(confidence * 100) / 100,
    evidenceIds: [],
    rationale,
    recommendedAction: action,
    authorityLevel: 'guardrailed',
    createdAt: new Date().toISOString(),
  }
}

export function scoreRecoveryOpportunities(snapshot: FunnelSnapshot): RecoveryOpportunity[] {
  const result: RecoveryOpportunity[] = []
  const close = snapshot.closeRateAmongShows
  const show = snapshot.showRateAmongBooked
  const value = snapshot.averageTransactionValue
  const uncontacted = Math.max(0, snapshot.leadCount - snapshot.contactedCount)
  const unbooked = Math.max(0, snapshot.contactedCount - snapshot.bookedCount)
  if (uncontacted > 0 && close > 0) result.push(makeOpportunity(snapshot, 'uncontacted-leads', uncontacted * close * value, `${uncontacted} leads were not contacted; estimate uses the observed close rate.`, 'Use an approved, client-authorized follow-up sequence.'))
  if (unbooked > 0 && show > 0 && close > 0) result.push(makeOpportunity(snapshot, 'unbooked-leads', unbooked * show * close * value, `${unbooked} contacted leads did not book; estimate uses observed show and close rates.`, 'Test a booking recovery sequence using approved messaging.'))
  if (snapshot.noShowCount > 0 && close > 0) result.push(makeOpportunity(snapshot, 'no-show-recovery', snapshot.noShowCount * close * value, `${snapshot.noShowCount} booked leads were no-shows; estimate uses observed close rate.`, 'Run a client-approved rebooking workflow.'))
  if (snapshot.staleOpportunityCount > 0 && close > 0) result.push(makeOpportunity(snapshot, 'stalled-opportunities', snapshot.staleOpportunityCount * close * value, `${snapshot.staleOpportunityCount} opportunities are stalled; estimate uses observed close rate.`, 'Prioritize and reactivate stale opportunities with approved outreach.'))
  return result.sort((a, b) => (b.estimatedRevenue * b.confidence) - (a.estimatedRevenue * a.confidence))
}

export async function buildRecoveryPlan(input: { tenantId: string; customerId: string; snapshot: FunnelSnapshot }): Promise<RecoveryPlan> {
  if (input.snapshot.tenantId !== input.tenantId || input.snapshot.customerId !== input.customerId) throw new Error('Snapshot identity mismatch.')
  const raw = scoreRecoveryOpportunities(input.snapshot)
  const opportunities: RecoveryOpportunity[] = []
  for (const item of raw) {
    const evidence = await recordCommercialEvidence({ tenantId: input.tenantId, business: 'revenue-recovery', source: input.snapshot.source, type: 'analytics', statement: item.rationale, confidence: item.confidence, verified: true, observedAt: input.snapshot.observedAt, entityType: 'recovery_opportunity', entityId: item.opportunityId })
    opportunities.push({ ...item, evidenceIds: [evidence.evidenceId] })
  }
  const totalEstimatedRevenue = money(opportunities.reduce((sum, item) => sum + item.estimatedRevenue, 0))
  const totalEstimatedGrossProfit = money(opportunities.reduce((sum, item) => sum + item.estimatedGrossProfit, 0))
  return { planId: `rrp_${input.snapshot.snapshotId}`, tenantId: input.tenantId, customerId: input.customerId, snapshotId: input.snapshot.snapshotId, opportunities, totalEstimatedRevenue, totalEstimatedGrossProfit, topPriority: opportunities[0]?.priority ?? 'low', blockedActions: opportunities.map((item) => `${item.type}: external execution requires delegated authority validation.`), createdAt: new Date().toISOString() }
}
