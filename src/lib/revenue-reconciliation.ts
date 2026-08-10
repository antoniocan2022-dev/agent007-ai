import { db } from '@/lib/db'

const OUTREACH_PREFIX = 'revenue.prepare_outreach:'
type JsonRecord = Record<string, unknown>
function parseJson(value: string | null): unknown { if (!value) return null; try { return JSON.parse(value) } catch { return null } }
function asRecord(value: unknown): JsonRecord { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {} }
function stringValue(value: unknown) { return typeof value === 'string' ? value.trim() : '' }
function payloadFrom(attrs: JsonRecord) { return asRecord(attrs.payload) }
export async function reconcileRevenueExecution(userId: string, limit = 100) {
  const actions = await db.pendingManageAction.findMany({ where: { userId, status: 'done', action: { startsWith: OUTREACH_PREFIX } }, orderBy: { updatedAt: 'desc' }, take: Math.min(Math.max(limit, 1), 250) })
  let checked = 0, verified = 0
  for (const action of actions) {
    checked += 1
    const attrs = asRecord(parseJson(action.attrs)), result = asRecord(parseJson(action.result))
    if (result.revenueVerified === true && stringValue(result.transactionId)) continue
    const payload = payloadFrom(attrs), recipient = stringValue(payload.to) || stringValue(attrs.to)
    if (!recipient) continue
    const transaction = await db.transaction.findFirst({ where: { userId, customerEmail: recipient, status: 'succeeded', createdAt: { gte: action.createdAt } }, orderBy: { createdAt: 'asc' } })
    if (!transaction) continue
    await db.pendingManageAction.update({ where: { id: action.id }, data: { result: JSON.stringify({ ...result, revenueVerified: true, transactionId: transaction.id, transactionProvider: transaction.provider, transactionProviderTxId: transaction.providerTxId, verifiedAt: new Date().toISOString(), verification: 'processor_transaction_match' }) } })
    await db.auditLog.create({ data: { userId, action: 'revenue.execution.reconciled', entity: 'RevenueExecution', entityId: action.id, description: 'Outreach execution reconciled to processor-backed transaction evidence.', metadata: JSON.stringify({ transactionId: transaction.id, provider: transaction.provider, providerTxId: transaction.providerTxId, amount: transaction.amount, currency: transaction.currency }) } })
    verified += 1
  }
  return { checked, verified }
}
export function getOutreachDeliveryState(result: unknown) { const value = asRecord(result), details = asRecord(value.details), accepted = Array.isArray(details.accepted) ? details.accepted.length : 0, rejected = Array.isArray(details.rejected) ? details.rejected.length : 0; if (rejected > 0 && accepted === 0) return 'rejected'; if (accepted > 0) return 'accepted_by_smtp'; return 'unknown' }
