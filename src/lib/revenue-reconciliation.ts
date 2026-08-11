import { db } from '@/lib/db'

const OUTREACH_PREFIX = 'revenue.prepare_outreach:'
type JsonRecord = Record<string, unknown>

type TransactionRecord = Awaited<ReturnType<typeof db.transaction.findFirst>>

function parseJson(value: string | null): unknown {
  if (!value) return null
  try { return JSON.parse(value) } catch { return null }
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function payloadFrom(attrs: JsonRecord) {
  return asRecord(attrs.payload)
}

function correlationIdFrom(attrs: JsonRecord, result: JsonRecord) {
  const payload = payloadFrom(attrs)
  return stringValue(result.revenueCorrelationId) || stringValue(attrs.revenueCorrelationId) || stringValue(payload.revenueCorrelationId)
}

function transactionCorrelationId(transaction: { rawPayload: string }) {
  const payload = asRecord(parseJson(transaction.rawPayload))
  const data = asRecord(payload.data)
  const object = asRecord(data.object)
  const metadata = asRecord(object.metadata)
  return stringValue(metadata.revenueCorrelationId)
}

/**
 * Reconcile an outreach execution only when the processor transaction carries
 * an explicit correlation ID. Recipient-email + timestamp matching is not
 * sufficient evidence of causality: the same customer can purchase later from
 * another channel, which would otherwise create false verified revenue.
 */
export async function reconcileRevenueExecution(userId: string, limit = 100) {
  const actions = await db.pendingManageAction.findMany({
    where: { userId, status: 'done', action: { startsWith: OUTREACH_PREFIX } },
    orderBy: { updatedAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 250),
  })

  let checked = 0
  let verified = 0

  for (const action of actions) {
    checked += 1
    const attrs = asRecord(parseJson(action.attrs))
    const result = asRecord(parseJson(action.result))
    if (result.revenueVerified === true && stringValue(result.transactionId)) continue

    const correlationId = correlationIdFrom(attrs, result)
    if (!correlationId) continue

    let transaction: TransactionRecord = null
    const explicitTransactionId = stringValue(result.transactionId)
    if (explicitTransactionId) {
      transaction = await db.transaction.findFirst({
        where: { id: explicitTransactionId, userId, status: 'succeeded' },
      })
      if (transaction && transactionCorrelationId(transaction) !== correlationId) transaction = null
    }

    if (!transaction) {
      const candidates = await db.transaction.findMany({
        where: { userId, status: 'succeeded', createdAt: { gte: action.createdAt } },
        orderBy: { createdAt: 'asc' },
        take: 250,
      })
      transaction = candidates.find(candidate => transactionCorrelationId(candidate) === correlationId) ?? null
    }

    if (!transaction) continue

    await db.pendingManageAction.update({
      where: { id: action.id },
      data: {
        result: JSON.stringify({
          ...result,
          revenueVerified: true,
          transactionId: transaction.id,
          transactionProvider: transaction.provider,
          transactionProviderTxId: transaction.providerTxId,
          verifiedAt: new Date().toISOString(),
          verification: 'processor_transaction_correlation_match',
          revenueCorrelationId: correlationId,
        }),
      },
    })

    await db.auditLog.create({
      data: {
        userId,
        action: 'revenue.execution.reconciled',
        entity: 'RevenueExecution',
        entityId: action.id,
        description: 'Outreach execution reconciled to processor-backed transaction evidence using an explicit correlation ID.',
        metadata: JSON.stringify({
          transactionId: transaction.id,
          provider: transaction.provider,
          providerTxId: transaction.providerTxId,
          amount: transaction.amount,
          currency: transaction.currency,
          revenueCorrelationId: correlationId,
        }),
      },
    })
    verified += 1
  }

  return { checked, verified }
}

export function getOutreachDeliveryState(result: unknown) {
  const value = asRecord(result)
  const details = asRecord(value.details)
  const accepted = Array.isArray(details.accepted) ? details.accepted.length : 0
  const rejected = Array.isArray(details.rejected) ? details.rejected.length : 0
  if (rejected > 0 && accepted === 0) return 'rejected'
  if (accepted > 0) return 'accepted_by_smtp'
  return 'unknown'
}
