import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  assertCompletionEvidence,
  executionActionName,
  type RevenueRequest,
  type RevenueStatus,
  validateRevenueRequest,
} from '@/lib/revenue-execution-guard'

async function writeAudit(
  tx: Prisma.TransactionClient,
  userId: string,
  action: string,
  entityId: string,
  description: string,
  metadata?: Record<string, unknown>,
) {
  await tx.auditLog.create({
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

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agent007:revenue:${userId}:${normalized.idempotencyKey}`}))`

    const existing = await tx.pendingManageAction.findFirst({ where: { userId, action }, orderBy: { createdAt: 'desc' } })
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

    const created = await tx.pendingManageAction.create({
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

    await writeAudit(tx, userId, 'revenue.execution.prepared', created.id, 'Prepared revenue action; explicit approval is required before any external execution.', {
      action: created.action,
      approvalRequired: true,
      externalSideEffect: false,
    })

    return created
  })
}

export async function approveRevenueApproval(userId: string, actionId: string) {
  return db.$transaction(async (tx) => {
    const current = await tx.pendingManageAction.findFirst({ where: { id: actionId, userId } })
    if (!current) throw new Error('Revenue approval action not found')
    if (!current.action.startsWith('revenue.')) throw new Error('Action is outside the revenue approval boundary')
    if (current.status === 'approved') return current
    if (current.status !== 'pending') throw new Error(`Action is ${current.status}; only pending actions can be approved.`)

    const result = await tx.pendingManageAction.updateMany({
      where: { id: actionId, userId, status: 'pending' },
      data: { status: 'approved', result: JSON.stringify({ approvedAt: new Date().toISOString(), externalSideEffect: false }) },
    })
    if (result.count !== 1) throw new Error('Approval state changed concurrently; no duplicate approval was issued')

    const updated = await tx.pendingManageAction.findUniqueOrThrow({ where: { id: actionId } })
    await writeAudit(tx, userId, 'revenue.execution.approved', updated.id, 'Revenue action approved; this boundary performs no provider or payment call.', {
      action: updated.action,
      externalSideEffect: false,
    })
    return updated
  })
}

export async function claimRevenueApproval(userId: string, actionId: string) {
  return db.$transaction(async (tx) => {
    const result = await tx.pendingManageAction.updateMany({
      where: { id: actionId, userId, status: 'approved', action: { startsWith: 'revenue.' } },
      data: { status: 'executing', result: JSON.stringify({ claimedAt: new Date().toISOString(), externalSideEffect: false }) },
    })
    if (result.count !== 1) {
      const current = await tx.pendingManageAction.findFirst({ where: { id: actionId, userId } })
      if (!current) throw new Error('Revenue approval action not found')
      throw new Error(`Action is ${current.status}; only approved actions can be claimed.`)
    }

    const action = await tx.pendingManageAction.findUniqueOrThrow({ where: { id: actionId } })
    await writeAudit(tx, userId, 'revenue.execution.claimed', action.id, 'Revenue action claimed by the authorized executor boundary; no provider call is made here.', {
      action: action.action,
      externalSideEffect: false,
    })
    return action
  })
}

export async function completeRevenueApproval(
  userId: string,
  actionId: string,
  completion: { externalSideEffect: boolean; provider?: string; providerReference?: string; revenueVerified?: boolean; result?: Record<string, unknown> },
) {
  assertCompletionEvidence(completion)

  return db.$transaction(async (tx) => {
    const result = await tx.pendingManageAction.updateMany({
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

    const action = await tx.pendingManageAction.findUniqueOrThrow({ where: { id: actionId } })
    await writeAudit(tx, userId, 'revenue.execution.completed', action.id, 'Revenue execution completed with explicit provider evidence.', {
      action: action.action,
      externalSideEffect: completion.externalSideEffect,
      provider: completion.provider?.trim() || null,
      providerReference: completion.providerReference?.trim() || null,
      revenueVerified: completion.revenueVerified ?? false,
    })
    return action
  })
}

export async function cancelRevenueApproval(userId: string, actionId: string, reason = 'Cancelled by operator') {
  const normalized = reason.trim() || 'Cancelled by operator'
  if (normalized.length > 500) throw new Error('Cancellation reason is too long')

  return db.$transaction(async (tx) => {
    const result = await tx.pendingManageAction.updateMany({
      where: { id: actionId, userId, status: { in: ['pending', 'approved'] }, action: { startsWith: 'revenue.' } },
      data: { status: 'cancelled', result: JSON.stringify({ cancelledAt: new Date().toISOString(), reason: normalized }) },
    })
    if (result.count !== 1) throw new Error('Only pending or approved revenue actions can be cancelled')

    const action = await tx.pendingManageAction.findUniqueOrThrow({ where: { id: actionId } })
    await writeAudit(tx, userId, 'revenue.execution.cancelled', action.id, 'Revenue execution action cancelled before external execution.', {
      action: action.action,
    })
    return action
  })
}

function safeJson(value: string | null) {
  if (!value) return null
  try { return JSON.parse(value) } catch { return value }
}
