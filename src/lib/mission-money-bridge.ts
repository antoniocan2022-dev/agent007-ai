import { db } from './db'
import { recordBusinessOutcome, type BusinessOutcomeRecord } from './architecture-control-plane'
import { getVenture } from './venture-commercial-foundation'

export interface MissionMoneyAttribution {
  missionId: string
  ventureId: string
  transactionId: string
  customerId: string | null
  amount: number
  currency: string
  transactionOutcomeId: string
  revenueOutcomeId: string
  attributedAt: string
}

export interface MissionMoneySummary {
  missionId: string
  ventureId: string
  transactionCount: number
  revenueRecognized: number
  refundAmount: number
  netRevenue: number
  currency: string | null
  transactionIds: string[]
  outcomeIds: string[]
}

function clean(value: string): string {
  return value.trim()
}

async function getOutcomeRows(missionId: string, ventureId: string): Promise<BusinessOutcomeRecord[]> {
  const rows = await db.memory.findMany({ where: { category: 'architecture_business_outcome' }, take: 5000 })
  return rows.map((row) => {
    try { return JSON.parse(row.value) as BusinessOutcomeRecord } catch { return null }
  }).filter((value): value is BusinessOutcomeRecord => Boolean(value))
    .filter((value) => value.missionId === missionId && value.ventureId === ventureId)
}

export async function attributeMissionTransaction(input: {
  missionId: string
  ventureId: string
  transactionId: string
  source?: string
}): Promise<MissionMoneyAttribution> {
  const missionId = clean(input.missionId)
  const ventureId = clean(input.ventureId)
  const transactionId = clean(input.transactionId)
  const source = clean(input.source ?? 'mission-to-money')
  if (!missionId || !ventureId || !transactionId) throw new Error('missionId, ventureId, and transactionId are required.')
  if (!source) throw new Error('Attribution source is required.')
  if (!await getVenture(ventureId)) throw new Error(`Venture not found: ${ventureId}.`)

  const rows = await db.$queryRaw<Array<{ id: string; ventureId: string | null; customerId: string | null; amount: number; currency: string; status: string }>>`
    SELECT "id","ventureId","customerId","amount","currency","status"
    FROM "Transaction" WHERE "id"=${transactionId} LIMIT 1
  `
  const transaction = rows[0]
  if (!transaction) throw new Error(`Transaction not found: ${transactionId}.`)
  if (transaction.ventureId !== ventureId) throw new Error(`Transaction ${transactionId} is not scoped to venture ${ventureId}.`)
  if (transaction.status !== 'succeeded') throw new Error(`Transaction ${transactionId} is not a succeeded transaction.`)
  if (!Number.isFinite(transaction.amount) || transaction.amount <= 0) throw new Error(`Transaction ${transactionId} has no positive recognized amount.`)
  if (!/^[A-Z]{3}$/i.test(transaction.currency)) throw new Error(`Transaction ${transactionId} has an invalid currency code.`)

  const occurredAt = new Date().toISOString()
  const transactionOutcome = await recordBusinessOutcome({
    ventureId,
    missionId,
    type: 'TRANSACTION',
    transactionId: transaction.id,
    customerId: transaction.customerId,
    amount: Number(transaction.amount),
    currency: transaction.currency.toUpperCase(),
    source,
    occurredAt,
    metadata: { attribution: 'mission_to_money' },
  })
  const revenueOutcome = await recordBusinessOutcome({
    ventureId,
    missionId,
    type: 'REVENUE_RECOGNIZED',
    transactionId: transaction.id,
    customerId: transaction.customerId,
    amount: Number(transaction.amount),
    currency: transaction.currency.toUpperCase(),
    source,
    occurredAt,
    metadata: { attribution: 'mission_to_money' },
  })

  return {
    missionId,
    ventureId,
    transactionId: transaction.id,
    customerId: transaction.customerId,
    amount: Number(transaction.amount),
    currency: transaction.currency.toUpperCase(),
    transactionOutcomeId: transactionOutcome.outcomeId,
    revenueOutcomeId: revenueOutcome.outcomeId,
    attributedAt: occurredAt,
  }
}

export async function getMissionMoneySummary(missionId: string, ventureId: string): Promise<MissionMoneySummary> {
  const normalizedMissionId = clean(missionId)
  const normalizedVentureId = clean(ventureId)
  if (!normalizedMissionId || !normalizedVentureId) throw new Error('missionId and ventureId are required.')
  if (!await getVenture(normalizedVentureId)) throw new Error(`Venture not found: ${normalizedVentureId}.`)

  const outcomes = await getOutcomeRows(normalizedMissionId, normalizedVentureId)
  const transactions = outcomes.filter((outcome) => outcome.type === 'TRANSACTION' && outcome.transactionId)
  const revenue = outcomes.filter((outcome) => outcome.type === 'REVENUE_RECOGNIZED')
  const refunds = outcomes.filter((outcome) => outcome.type === 'REFUND')
  const currencies = [...new Set(revenue.map((outcome) => outcome.currency).filter((value): value is string => Boolean(value)))]
  if (currencies.length > 1) throw new Error(`Mission ${normalizedMissionId} contains multiple revenue currencies: ${currencies.join(', ')}.`)
  const transactionIds = [...new Set(transactions.map((outcome) => outcome.transactionId).filter((value): value is string => Boolean(value)))]
  const outcomeIds = [...new Set(outcomes.map((outcome) => outcome.outcomeId))]
  const revenueRecognized = revenue.reduce((sum, outcome) => sum + Number(outcome.amount ?? 0), 0)
  const refundAmount = refunds.reduce((sum, outcome) => sum + Number(outcome.amount ?? 0), 0)

  return {
    missionId: normalizedMissionId,
    ventureId: normalizedVentureId,
    transactionCount: transactionIds.length,
    revenueRecognized: Number(revenueRecognized.toFixed(2)),
    refundAmount: Number(refundAmount.toFixed(2)),
    netRevenue: Number((revenueRecognized - refundAmount).toFixed(2)),
    currency: currencies[0] ?? null,
    transactionIds,
    outcomeIds,
  }
}
