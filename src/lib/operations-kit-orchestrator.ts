import {recordCommercialEvent} from './commercial-control-plane'
import {recordCommercialEvidence,evaluateDelegatedAuthority,auditCommercialAction} from './commercial-control-plane-governance'
import {buildProcessObservation,persistProcessObservation} from './operations-kit-measurement'
import {scoreOperationsOpportunity} from './operations-kit-rules'
import type {ProcessObservationInput,OperationsPlan} from './operations-kit-types'

export async function buildOperationsPlan(input: ProcessObservationInput): Promise<OperationsPlan> {
  const observation = buildProcessObservation(input)
  await persistProcessObservation(observation)
  const opportunity = scoreOperationsOpportunity(observation)
  const evidence = await recordCommercialEvidence({
    tenantId: observation.tenantId,
    business: 'operations-kit',
    source: observation.source,
    type: 'operations',
    statement: opportunity.rationale,
    confidence: observation.confidence,
    verified: false,
    observedAt: observation.observedAt,
    entityType: 'operations_opportunity',
    entityId: opportunity.opportunityId,
  })
  opportunity.evidenceId = evidence.evidenceId as never
  await recordCommercialEvent({
    tenantId: observation.tenantId,
    business: 'operations-kit',
    type: 'operations.plan.created',
    source: 'operations-kit',
    entityType: 'operations_opportunity',
    entityId: opportunity.opportunityId,
    occurredAt: new Date().toISOString(),
    payload: { customerId: observation.customerId, priority: opportunity.priority },
    idempotencyKey: `operations-plan:${observation.observationId}`,
  })
  return {
    planId: `opsp:${observation.observationId}`,
    tenantId: observation.tenantId,
    customerId: observation.customerId,
    observationId: observation.observationId,
    opportunities: [opportunity],
    totalMonthlyMinutesSaved: opportunity.estimatedMonthlyMinutesSaved,
    totalMonthlyValue: opportunity.estimatedMonthlyValue,
    topPriority: opportunity.priority,
    blockedActions: ['External workflow activation requires delegated authority verification.'],
    createdAt: new Date().toISOString(),
  }
}

export async function authorizeOperationsAction(input: { tenantId: string; action: string; spend?: number; channel?: string; opportunityId: string; customerId: string }) {
  const authority = await evaluateDelegatedAuthority({
    tenantId: input.tenantId,
    business: 'operations-kit',
    action: input.action,
    spend: input.spend,
    channel: input.channel,
  })
  await auditCommercialAction({
    tenantId: input.tenantId,
    business: 'operations-kit',
    action: input.action,
    actor: 'SMB_OPERATIONS_LEADER',
    entityType: 'operations_opportunity',
    entityId: input.opportunityId,
    allowed: authority.allowed,
    reason: authority.reason,
    metadata: { customerId: input.customerId },
  })
  return authority
}
