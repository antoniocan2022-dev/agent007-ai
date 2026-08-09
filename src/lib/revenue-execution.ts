import { db } from '@/lib/db'
import { getRevenueExecutor } from '@/lib/revenue-executors'

export const REVENUE_EXECUTION_ACTIONS = ['prepare_offer', 'prepare_outreach', 'prepare_checkout', 'prepare_fulfillment'] as const
export type RevenueExecutionAction = (typeof REVENUE_EXECUTION_ACTIONS)[number]
export type RevenueExecutionStatus = 'pending' | 'approved' | 'executing' | 'done' | 'failed' | 'cancelled'
export type RevenueExecutionRequest = { action: RevenueExecutionAction; customerId?: string; serviceId?: string; opportunityId?: string; idempotencyKey: string; payload?: Record<string, unknown> }

function executionActionName(action: RevenueExecutionAction, key: string) { return `revenue.${action}:${key}` }
function parseExecutionAction(action: string): RevenueExecutionAction | null {
  const value = action.replace(/^revenue\./, '').split(':', 1)[0]
  return REVENUE_EXECUTION_ACTIONS.includes(value as RevenueExecutionAction) ? value as RevenueExecutionAction : null
}
async function audit(userId: string, action: string, entityId: string, description: string, metadata?: Record<string, unknown>) {
  await db.auditLog.create({ data: { userId, action, entity: 'RevenueExecution', entityId, description, metadata: metadata ? JSON.stringify(metadata) : undefined } })
}
export async function getRevenueExecutionQueue(userId: string, statuses: RevenueExecutionStatus[] = ['pending', 'approved', 'executing']) {
  const actions = await db.pendingManageAction.findMany({ where: { userId, status: { in: statuses } }, orderBy: { createdAt: 'desc' }, take: 100 })
  return actions.filter((item) => item.action.startsWith('revenue.')).map((item) => ({ id: item.id, action: item.action, status: item.status as RevenueExecutionStatus, attrs: safeParse(item.attrs), result: safeParse(item.result), createdAt: item.createdAt, updatedAt: item.updatedAt }))
}
export async function prepareRevenueExecution(userId: string, request: RevenueExecutionRequest) {
  if (!request.idempotencyKey.trim()) throw new Error('idempotencyKey is required')
  const action = executionActionName(request.action, request.idempotencyKey.trim())
  const existing = await db.pendingManageAction.findFirst({ where: { userId, action }, orderBy: { createdAt: 'desc' } })
  if (existing) return existing
  if (request.customerId) { const customer = await db.customer.findFirst({ where: { id: request.customerId, userId }, select: { id: true } }); if (!customer) throw new Error('Customer not found for this operator') }
  if (request.serviceId) { const service = await db.servicePackage.findFirst({ where: { id: request.serviceId, userId, active: true }, select: { id: true } }); if (!service) throw new Error('Active service package not found for this operator') }
  if (request.opportunityId) { const opportunity = await db.opportunity.findFirst({ where: { id: request.opportunityId, userId, status: { not: 'retired' } }, select: { id: true } }); if (!opportunity) throw new Error('Opportunity not found for this operator') }
  const attrs = { source: 'first_revenue_engine', executionVersion: 1, idempotencyKey: request.idempotencyKey.trim(), customerId: request.customerId ?? null, serviceId: request.serviceId ?? null, opportunityId: request.opportunityId ?? null, payload: request.payload ?? {}, externalSideEffect: false, revenueVerified: false, approvalRequired: true }
  const created = await db.pendingManageAction.create({ data: { userId, action, attrs: JSON.stringify(attrs), status: 'pending' } })
  await audit(userId, 'revenue.execution.prepared', created.id, `Prepared ${request.action} for explicit approval.`, attrs)
  return created
}
export async function approveRevenueExecution(userId: string, actionId: string) {
  const updatedAt = new Date()
  const claimed = await db.pendingManageAction.updateMany({
    where: { id: actionId, userId, status: 'pending' },
    data: { status: 'approved', result: JSON.stringify({ approvedAt: updatedAt.toISOString(), execution: 'awaiting-authorized-executor' }) },
  })
  if (claimed.count === 0) {
    const action = await db.pendingManageAction.findFirst({ where: { id: actionId, userId }, select: { status: true } })
    if (!action) throw new Error('Revenue execution action not found')
    throw new Error(`Action is ${action.status}; only pending actions can be approved.`)
  }
  const updated = await db.pendingManageAction.findFirst({ where: { id: actionId, userId } })
  if (!updated) throw new Error('Revenue execution action disappeared after approval.')
  await audit(userId, 'revenue.execution.approved', updated.id, 'Revenue execution action approved; no external side effect was performed.', { action: updated.action, approvalBoundary: true, externalSideEffect: false })
  return updated
}
export async function executeApprovedRevenueExecution(userId: string, actionId: string) {
  const existing = await db.pendingManageAction.findFirst({ where: { id: actionId, userId } })
  if (!existing) throw new Error('Revenue execution action not found')
  if (existing.status !== 'approved') throw new Error(`Action is ${existing.status}; only approved actions can be executed.`)
  const revenueAction = parseExecutionAction(existing.action)
  if (!revenueAction) throw new Error('Unsupported revenue execution action.')
  const executor = getRevenueExecutor(revenueAction)
  if (!executor || !executor.enabled) throw new Error(`No authorized executor is configured for ${revenueAction}.`)

  const startedAt = new Date()
  const claimed = await db.pendingManageAction.updateMany({
    where: { id: existing.id, userId, status: 'approved' },
    data: { status: 'executing', result: JSON.stringify({ startedAt: startedAt.toISOString(), executorId: executor.id }) },
  })
  if (claimed.count !== 1) throw new Error('Revenue execution action was already claimed by another executor attempt.')

  const attrs = safeParse(existing.attrs)
  const contextAttrs = attrs && typeof attrs === 'object' && !Array.isArray(attrs) ? attrs as Record<string, unknown> : {}
  await audit(userId, 'revenue.execution.started', existing.id, `Started ${revenueAction} with ${executor.id}.`, { executorId: executor.id, externalSideEffect: false })
  try {
    const result = await executor.execute({ actionId: existing.id, action: revenueAction, attrs: contextAttrs })
    const finalStatus: RevenueExecutionStatus = result.externalSideEffect ? 'done' : 'failed'
    const updated = await db.pendingManageAction.update({ where: { id: existing.id }, data: { status: finalStatus, result: JSON.stringify({ completedAt: new Date().toISOString(), executorId: executor.id, ...result }) } })
    await audit(userId, `revenue.execution.${finalStatus}`, existing.id, `Executor ${executor.id} completed with status ${finalStatus}.`, result.details)
    return updated
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Executor failed.'
    const updated = await db.pendingManageAction.update({ where: { id: existing.id }, data: { status: 'failed', result: JSON.stringify({ failedAt: new Date().toISOString(), executorId: executor.id, error: message }) } })
    await audit(userId, 'revenue.execution.failed', existing.id, message, { executorId: executor.id, failClosed: true })
    throw Object.assign(new Error(message), { action: updated })
  }
}
function safeParse(value: string | null) { if (!value) return null; try { return JSON.parse(value) } catch { return value } }
