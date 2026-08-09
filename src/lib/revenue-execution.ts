import { db } from '@/lib/db'

export const REVENUE_EXECUTION_ACTIONS = [
  'prepare_offer',
  'prepare_outreach',
  'prepare_checkout',
  'prepare_fulfillment',
] as const

export type RevenueExecutionAction = (typeof REVENUE_EXECUTION_ACTIONS)[number]

export type RevenueExecutionStatus = 'pending' | 'approved' | 'executing' | 'done' | 'failed' | 'cancelled'

export type RevenueExecutionRequest = {
  action: RevenueExecutionAction
  customerId?: string
  serviceId?: string
  opportunityId?: string
  idempotencyKey: string
  payload?: Record<string, unknown>
}

function executionActionName(action: RevenueExecutionAction, key: string) {
  return `revenue.${action}:${key}`
}

async function audit(userId: string, action: string, entityId: string, description: string, metadata?: Record<string, unknown>) {
  await db.auditLog.create({
    data: {
      userId,
      action,
      entity: 'RevenueExecution',
      entityId,
      description,
      metadata: metadata ? JSON.stringify(metadata) : undefined,
    },
  })
}

export async function getRevenueExecutionQueue(userId: string, statuses: RevenueExecutionStatus[] = ['pending', 'approved', 'executing']) {
  const actions = await db.pendingManageAction.findMany({
    where: { userId, status: { in: statuses } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return actions
    .filter((item) => item.action.startsWith('revenue.'))
    .map((item) => ({
      id: item.id,
      action: item.action,
      status: item.status as RevenueExecutionStatus,
      attrs: safeParse(item.attrs),
      result: safeParse(item.result),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }))
}

export async function prepareRevenueExecution(userId: string, request: RevenueExecutionRequest) {
  if (!request.idempotencyKey.trim()) throw new Error('idempotencyKey is required')

  const action = executionActionName(request.action, request.idempotencyKey.trim())
  const existing = await db.pendingManageAction.findFirst({
    where: { userId, action },
    orderBy: { createdAt: 'desc' },
  })
  if (existing) return existing

  // Validate references before creating a durable action. This prevents an
  // approval queue from containing actions for another user's records.
  if (request.customerId) {
    const customer = await db.customer.findFirst({ where: { id: request.customerId, userId }, select: { id: true } })
    if (!customer) throw new Error('Customer not found for this operator')
  }
  if (request.serviceId) {
    const service = await db.servicePackage.findFirst({ where: { id: request.serviceId, userId, active: true }, select: { id: true } })
    if (!service) throw new Error('Active service package not found for this operator')
  }
  if (request.opportunityId) {
    const opportunity = await db.opportunity.findFirst({ where: { id: request.opportunityId, userId, status: { not: 'retired' } }, select: { id: true } })
    if (!opportunity) throw new Error('Opportunity not found for this operator')
  }

  const attrs = {
    source: 'first_revenue_engine',
    executionVersion: 1,
    idempotencyKey: request.idempotencyKey.trim(),
    customerId: request.customerId ?? null,
    serviceId: request.serviceId ?? null,
    opportunityId: request.opportunityId ?? null,
    payload: request.payload ?? {},
    externalSideEffect: false,
    revenueVerified: false,
    approvalRequired: true,
  }

  const created = await db.pendingManageAction.create({
    data: {
      userId,
      action,
      attrs: JSON.stringify(attrs),
      status: 'pending',
    },
  })

  await audit(userId, 'revenue.execution.prepared', created.id, `Prepared ${request.action} for explicit approval.`, attrs)
  return created
}

export async function approveRevenueExecution(userId: string, actionId: string) {
  const action = await db.pendingManageAction.findFirst({ where: { id: actionId, userId } })
  if (!action) throw new Error('Revenue execution action not found')
  if (action.status !== 'pending') throw new Error(`Action is ${action.status}; only pending actions can be approved.`)

  const updated = await db.pendingManageAction.update({
    where: { id: action.id },
    data: {
      status: 'approved',
      result: JSON.stringify({ approvedAt: new Date().toISOString(), execution: 'awaiting-authorized-executor' }),
    },
  })

  await audit(userId, 'revenue.execution.approved', updated.id, 'Revenue execution action approved; no external side effect was performed.', {
    action: updated.action,
    approvalBoundary: true,
    externalSideEffect: false,
  })

  return updated
}

function safeParse(value: string | null) {
  if (!value) return null
  try { return JSON.parse(value) } catch { return value }
}
