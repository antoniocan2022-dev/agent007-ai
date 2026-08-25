import { db } from './db'
import { assertRealSucceededTransaction } from './transaction-evidence-integrity'
import { recordExperimentPaymentAttribution } from './portfolio-experiment-attribution'
import type { PortfolioBusiness } from './portfolio-intelligence-contract'

export interface VerifiedBusinessOutcome {
  id: string
  type: 'TRANSACTION' | 'REFUND'
  ventureId: string
  transactionId: string
  customerId: string | null
  amount: number
  currency: string
  source: 'stripe'
  occurredAt: string
  verifiedAt: string
  revenueCorrelationId?: string
  experimentId?: string
  experimentBusiness?: PortfolioBusiness
  experimentVariant?: string
}

export async function recordVerifiedTransactionOutcome(input: {
  ventureId: string
  transactionId: string
  amount?: number
  currency?: string
  revenueCorrelationId?: string
  experimentId?: string
  experimentBusiness?: PortfolioBusiness
  experimentVariant?: string
}): Promise<VerifiedBusinessOutcome> {
  const verified = await assertRealSucceededTransaction({ ventureId: input.ventureId, transactionId: input.transactionId, amount: input.amount, currency: input.currency })
  const now = new Date().toISOString()
  const key = `architecture_business_outcome:TRANSACTION:${verified.id}`
  const record: VerifiedBusinessOutcome = {
    id: key,
    type: 'TRANSACTION',
    ventureId: verified.ventureId,
    transactionId: verified.id,
    customerId: verified.customerId,
    amount: verified.amount,
    currency: verified.currency,
    source: 'stripe',
    occurredAt: verified.createdAt,
    verifiedAt: now,
    ...(input.revenueCorrelationId ? { revenueCorrelationId: input.revenueCorrelationId } : {}),
    ...(input.experimentId ? { experimentId: input.experimentId } : {}),
    ...(input.experimentBusiness ? { experimentBusiness: input.experimentBusiness } : {}),
    ...(input.experimentVariant ? { experimentVariant: input.experimentVariant } : {}),
  }
  await db.memory.upsert({ where: { key }, update: { value: JSON.stringify(record), category: 'architecture_business_outcome' }, create: { key, category: 'architecture_business_outcome', value: JSON.stringify(record) } })

  if (input.experimentId && input.experimentBusiness && input.experimentVariant) {
    await recordExperimentPaymentAttribution({ experimentId: input.experimentId, business: input.experimentBusiness, variant: input.experimentVariant, ventureId: verified.ventureId, transactionId: verified.id, evidenceId: key })
  }
  return record
}

export async function recordVerifiedRefundOutcome(input: { ventureId: string; transactionId: string; amount: number; currency?: string }): Promise<VerifiedBusinessOutcome> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('Refund amount must be positive and finite.')
  const verified = await assertRealSucceededTransaction({ ventureId: input.ventureId, transactionId: input.transactionId })
  if (input.amount > verified.amount) throw new Error('Refund amount exceeds the succeeded transaction amount.')
  if (input.currency && input.currency.toUpperCase() !== verified.currency) throw new Error('Refund currency does not match the transaction currency.')
  const id = `architecture_business_outcome:REFUND:${verified.id}:${input.amount.toFixed(2)}`
  const now = new Date().toISOString()
  const record: VerifiedBusinessOutcome = { id, type: 'REFUND', ventureId: verified.ventureId, transactionId: verified.id, customerId: verified.customerId, amount: input.amount, currency: verified.currency, source: 'stripe', occurredAt: now, verifiedAt: now }
  await db.memory.upsert({ where: { key: id }, update: { value: JSON.stringify(record), category: 'architecture_business_outcome' }, create: { key: id, category: 'architecture_business_outcome', value: JSON.stringify(record) } })
  return record
}
