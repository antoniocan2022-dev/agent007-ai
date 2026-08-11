import { db } from '@/lib/db'
import {
  assertCompletionEvidence,
  executionActionName,
  type RevenueAction,
  type RevenueRequest,
  type RevenueStatus,
  validateRevenueRequest,
} from '@/lib/revenue-execution-guard'

export async function listRevenueApprovals(userId: string, statuses: RevenueStatus[] = ['pending', 'approved', 'executing']) {
  const rows = await db.pendingManageAction.findMany({
    where: { userId, status: { in: statuses } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return rows
    .filter((row) => row.action.startsWith('revenue.'))
    .map((row) => ({
      id: row.id,
      action: row.action,
      status: row.status as RevenueStatus,
      attrs: safeJson(row.attrs),
      result: safeJson(row.result),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))
}

export async function prepareRevenueApproval(userId: string, request: RevenueRequest) {
  const normalized = validateRevenueRequest(request)
  const action = executionActionName(normalized.action, normalized.idempotencyKey)

  const created = await db.$transaction(async (tx) => {
    // PostgreSQL transaction-scoped advisory locks give us race-free idempotency
    // without coupling the application to a hosting provider.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`agent007:revenue:${userId}:${normalized.idempotencyKey}`}))`

    const existing = await tx.pendingManageAction.findFirst({
      where: { userId, action },
      orderBy: { createdAt: 'desc' },
    })
    if (existing) return existing

    if (normalized.customerId) {
      const customer = await tx.customer.findFirst({ where: { id: normalized.customerId, userId }, select: { id: true } })
      if (!customer) throw new Error('Customer not found for this operator')
    }
    if (normalized.serviceId) {
      const service = await tx.servicePackage.findFirst({ where: { id: normalized.serviceId, userId, active: true }, select: { id: true } })
      if (!service) throw new Error('Active service package not found for this operator')
    }
    if (normalized.opportunityId) {
      const opportunity = await tx.opportunity.findFirst({ where: { id: normalized.opportunityId, userId, status: { not: 'retired' } }, select: { id: true } })
      if (!opportunity) throw new Error('Opportunity not found for this operator')
    }

    return tx.pendingManageAction.create({
      data: {
        userId,
        action,
        attrs: JSON.stringify({
          schemaVersion: 1,
          action: normalized.action,
          idempotencyKey: normalized.idempotencyKey,
          customerId: normalized.customerId ?? null,
          serviceId: normalized.serviceId ?? null,
          opportunityId: normalized.opportunityId ?? null,
          payload: normalized.payload ?? {},
          approvalRequired: true,
          externalSideEffect: false,
          revenueVerified: false,
        }),
        status: 'pending',
      },
    })
  })

  await db.auditLog.create({
    data: {
      userId,
      action: 'revenue.execution.prepared',
      entity: 'RevenueExecution',
      entityId: created.id,
      description: 'Prepared revenue action; explicit approval is required before any external execution.',
      metadata: JSON.stringify({ action: created.action, approvalRequired: true, externalSideEffect: false }),
    },
  })

  return created
}

export async function approveRevenueApproval(userId: string, actionId: string) {
  const updated = await db.$transaction(async (tx) => {
    const current = await tx.pendingManageAction.findFirst({ where: { id: actionId, userId } })
    if (!current) throw new Error('Revenue approval action not found')
    if (!current.action.startsWith('revenue.')) throw new Error('Action is outside the revenue approval boundary')
    if (current.status === 'approved') return current
    if (current.status !== 'pending') throw new Error(`Action is ${current.status}; only pending actions can be approved.`)

    const result = await tx.pendingManageAction.updateMany({
      where: { id: actionId, userId, status: 'pending' },
      data: {
        status: 'approved',
        result: JSON.stringify({ approvedAt: new Date().toISOString(), externalSideEffect: false }),
      },
    })
    if (result.count !== 1) throw new Error('Approval state changed concurrently; no duplicate approval was issued')
    return tx.pendingManageAction.findUniqueOrThrow({ where: { id: actionId } })
  })

  await db.auditLog.create({
    data: {
      userId,
      action: 'revenue.execution.approved',
      entity: 'RevenueExecution',
      entityId: updated.id,
      description: 'Revenue action approved; this boundary performs no provider or payment call.',
      metadata: JSON.stringify({ action: updated.action, externalSideEffect: false }),
    },
  })

  return updated
}

export async function claimRevenueApproval(userId: string, actionId: string) {
  const result = await db.pendingManageAction.updateMany({
    where: { id: actionId, userId, status: 'approved', action: { startsWith: 'revenue.' } },
    data: { status: 'executing', result: JSON.stringify({ claimedAt: new Date().toISOString(), externalSideEffect: false }) },
  })
  if (result.count !== 1) {
    const current = await db.pendingManageAction.findFirst({ where: { id: actionId, userId } })
    if (!current) throw new Error('Revenue approval action not found')
    throw new Error(`Action is ${current.status}; only approved actions can be claimed.`)
  }

  return db.pendingManageAction.findUniqueOrThrow({ where: { id: actionId } })
}

export async function completeRevenueApproval(
  userId: string,
  actionId: string,
  completion: { externalSideEffect: boolean; provider?: string; providerReference?: string; revenueVerified?: boolean; result?: Record<string, unknown> },
) {
  assertCompletionEvidence(completion)

  const result = await db.pendingManageAction.updateMany({
    where: { id: actionId, userId, status: 'executing', action: { startsWith: 'revenue.' } },
    data: {
      status: 'done',
      result: JSON.stringify({
        completedAt: new Date().toISOString(),
        externalSideEffect: completion.externalSideEffect,
        provider: completion.provider?.trim() || null,
        providerReference: completion.providerReference?.trim() || null,
        revenueVerified: completion.revenueVerified ?? false,
        result: completion.result ?? {},
      }),
    },
  })
  if (result.count !== 1) throw new Error('Only executing revenue actions can be completed')

  return db.pendingManageAction.findUniqueOrThrow({ where: { id: actionId } })
}

export async function cancelRevenueApproval(userId: string, actionId: string, reason = 'Cancelled by operator') {
  const normalized = reason.trim() || 'Cancelled by operator'
  if (normalized.length > 500) throw new Error('Cancellation reason is too long')

  const result = await db.pendingManageAction.updateMany({
    where: { id: actionId, userId, status: { in: ['pending', 'approved'] }, action: { startsWith: 'revenue.' } },
    data: { status: 'cancelled', result: JSON.stringify({ cancelledAt: new Date().toISOString(), reason: normalized }) },
  })
  if (result.count !== 1) throw new Error('Only pending or approved revenue actions can be cancelled')
  return db.pendingManageAction.findUniqueOrThrow({ where: { id: actionId } })
}

function safeJson(value: string | null) {
  if (!value) return null
  try { return JSON.parse(value) } catch { return value }
}
