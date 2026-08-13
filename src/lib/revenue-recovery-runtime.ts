import { createCommercialWorkflow, recordCommercialEvent, auditCommercialAction } from './commercial-control-plane'
import { evaluateDelegatedAuthority } from './commercial-control-plane-governance'
import type { RecoveryOutcome } from './revenue-recovery-contract'

export async function queueRecoveryExecution(input: { tenantId: string; customerId: string; opportunityId: string; action: string; spend?: number; channel?: string }): Promise<{ queued: boolean; workflowId: string | null; blockedReason?: string }> {
  const authority = await evaluateDelegatedAuthority({ tenantId: input.tenantId, business: 'revenue-recovery', action: input.action, spend: input.spend, channel: input.channel })
  await auditCommercialAction({ tenantId: input.tenantId, business: 'revenue-recovery', action: input.action, actor: 'REVENUE_RECOVERY_LEADER', entityType: 'recovery_opportunity', entityId: input.opportunityId, allowed: authority.allowed, reason: authority.reason, metadata: { customerId: input.customerId, channel: input.channel ?? null, spend: input.spend ?? 0 } })
  if (!authority.allowed) return { queued: false, workflowId: null, blockedReason: authority.reason }
  const event = await recordCommercialEvent({ tenantId: input.tenantId, business: 'revenue-recovery', type: 'recovery.execution.requested', source: 'revenue-recovery', entityType: 'recovery_opportunity', entityId: input.opportunityId, occurredAt: new Date().toISOString(), payload: { customerId: input.customerId, action: input.action, channel: input.channel ?? null, spend: input.spend ?? 0 }, idempotencyKey: `recovery-execution:${input.opportunityId}:${input.action}` })
  const workflow = await createCommercialWorkflow({ tenantId: input.tenantId, business: 'revenue-recovery', workflowType: 'recovery-execution', input: { customerId: input.customerId, opportunityId: input.opportunityId, action: input.action, channel: input.channel ?? null, spend: input.spend ?? 0, eventId: event.event.eventId }, maxRetries: 3, nextRunAt: new Date().toISOString(), idempotencyKey: `recovery-workflow:${input.opportunityId}:${input.action}` })
  return { queued: workflow.created, workflowId: workflow.workflow.workflowId }
}

export async function recordRecoveryOutcome(input: Omit<RecoveryOutcome, 'outcomeId' | 'recoveryRate' | 'createdAt'> & { outcomeId?: string }): Promise<{ created: boolean; outcome: RecoveryOutcome }> {
  if (!input.tenantId.trim() || !input.customerId.trim() || !input.opportunityId.trim()) throw new Error('tenantId, customerId, and opportunityId are required.')
  const expectedRevenue = Math.max(0, Number.isFinite(input.expectedRevenue) ? input.expectedRevenue : 0)
  const recoveredRevenue = Math.min(expectedRevenue, Math.max(0, Number.isFinite(input.recoveredRevenue) ? input.recoveredRevenue : 0))
  const outcome: RecoveryOutcome = { ...input, outcomeId: input.outcomeId?.trim() || `rro_${input.opportunityId}`, expectedRevenue, recoveredRevenue, recoveryRate: expectedRevenue > 0 ? Math.round((recoveredRevenue / expectedRevenue) * 10000) / 10000 : 0, observedSource: input.observedSource.trim(), createdAt: new Date().toISOString() }
  const key = `revenue_recovery_outcome:${input.tenantId}:${input.customerId}:${input.opportunityId}`
  const { db } = await import('./db')
  const existing = await db.memory.findUnique({ where: { key } })
  if (existing) return { created: false, outcome: JSON.parse(existing.value) as RecoveryOutcome }
  await db.memory.create({ data: { key, category: 'revenue_recovery_outcome', value: JSON.stringify(outcome) } })
  return { created: true, outcome }
}
