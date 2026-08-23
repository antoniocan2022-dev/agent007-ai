import { db } from './db'
import { getVenture } from './venture-commercial-foundation'
import { getCustomerSuccessSnapshot } from './customer-success'
import { assertRealSucceededTransaction } from './transaction-evidence-integrity'

export interface VentureTemplateProof {
  ventureId: string
  proven: boolean
  checkedAt: string
  requirements: {
    relationalVenture: boolean
    productionState: boolean
    realCustomer: boolean
    successfulTransaction: boolean
    settledInvoice: boolean
    customerSuccessValue: boolean
    missionToMoney: boolean
    positiveRecognizedRevenue: boolean
  }
  evidence: {
    customerCount: number
    transactionCount: number
    paidInvoiceCount: number
    valueRealizedCustomers: number
    attributedMissionCount: number
    recognizedRevenue: number
  }
  blockingReasons: string[]
}

async function countMissionRevenueLinks(ventureId: string): Promise<{ missionIds: string[]; revenue: number }> {
  const rows = await db.memory.findMany({ where: { category: 'architecture_business_outcome' }, take: 10000 })
  const outcomes: Array<{ ventureId?: string; missionId?: string | null; type?: string; amount?: number | null; currency?: string | null; transactionId?: string | null }> = []
  for (const row of rows) {
    try { outcomes.push(JSON.parse(row.value) as typeof outcomes[number]) } catch { /* malformed observational rows are never proof */ }
  }

  const transactionOutcomeKeys = new Set(
    outcomes
      .filter((o) => o.ventureId === ventureId && o.type === 'TRANSACTION' && o.missionId && o.transactionId)
      .map((o) => `${o.missionId}:${o.transactionId}`),
  )
  const candidates = outcomes.filter((o) => o.ventureId === ventureId && o.type === 'REVENUE_RECOGNIZED' && o.missionId && o.transactionId && transactionOutcomeKeys.has(`${o.missionId}:${o.transactionId}`))
  const missionIds = new Set<string>()
  const verifiedTransactions = new Map<string, { amount: number; currency: string }>()

  await Promise.all([...new Set(candidates.map((o) => String(o.transactionId).trim()))].map(async (transactionId) => {
    const candidate = candidates.find((o) => String(o.transactionId).trim() === transactionId)
    try {
      const transaction = await assertRealSucceededTransaction({
        ventureId,
        transactionId,
        amount: candidate && Number.isFinite(Number(candidate.amount)) && Number(candidate.amount) > 0 ? Number(candidate.amount) : undefined,
        currency: typeof candidate?.currency === 'string' ? candidate.currency : undefined,
      })
      verifiedTransactions.set(transactionId, { amount: transaction.amount, currency: transaction.currency })
    } catch {
      // A revenue outcome that cannot reconcile to the relational Transaction ledger is not proof.
    }
  }))

  const verifiedCandidates = candidates.filter((o) => verifiedTransactions.has(String(o.transactionId).trim()))
  for (const outcome of verifiedCandidates) missionIds.add(String(outcome.missionId))
  const revenue = Number([...verifiedTransactions.values()].reduce((sum, item) => sum + item.amount, 0).toFixed(2))
  return { missionIds: [...missionIds], revenue }
}

export async function evaluateVentureTemplateProof(ventureId: string): Promise<VentureTemplateProof> {
  const blockingReasons: string[] = []
  const venture = await getVenture(ventureId)
  const relationalVenture = Boolean(venture)
  const productionState = venture?.productionState === 'PRODUCTION'
  if (!relationalVenture) blockingReasons.push('Relational Venture record is missing.')
  if (!productionState) blockingReasons.push('Venture has not reached relational PRODUCTION state.')

  if (!venture) {
    return {
      ventureId,
      proven: false,
      checkedAt: new Date().toISOString(),
      requirements: {
        relationalVenture: false,
        productionState: false,
        realCustomer: false,
        successfulTransaction: false,
        settledInvoice: false,
        customerSuccessValue: false,
        missionToMoney: false,
        positiveRecognizedRevenue: false,
      },
      evidence: { customerCount: 0, transactionCount: 0, paidInvoiceCount: 0, valueRealizedCustomers: 0, attributedMissionCount: 0, recognizedRevenue: 0 },
      blockingReasons,
    }
  }

  const [customerRows, transactionRows, invoiceRows] = await Promise.all([
    db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "Customer" WHERE "ventureId"=${ventureId}`,
    db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "Transaction" WHERE "ventureId"=${ventureId} AND "status"='succeeded'`,
    db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "Invoice" i
      INNER JOIN "Transaction" t ON t."id"=i."transactionId"
      WHERE i."ventureId"=${ventureId} AND i."status"='paid' AND t."ventureId"=${ventureId} AND t."status"='succeeded'
    `,
  ])
  const customerCount = Number(customerRows[0]?.count ?? 0)
  const transactionCount = Number(transactionRows[0]?.count ?? 0)
  const paidInvoiceCount = Number(invoiceRows[0]?.count ?? 0)
  const success = await getCustomerSuccessSnapshot(ventureId)
  const mission = await countMissionRevenueLinks(ventureId)

  const requirements = {
    relationalVenture,
    productionState,
    realCustomer: customerCount > 0,
    successfulTransaction: transactionCount > 0,
    settledInvoice: paidInvoiceCount > 0,
    customerSuccessValue: success.valueRealized > 0,
    missionToMoney: mission.missionIds.length > 0,
    positiveRecognizedRevenue: mission.revenue > 0,
  }

  if (!requirements.realCustomer) blockingReasons.push('No real customer is attached to the venture.')
  if (!requirements.successfulTransaction) blockingReasons.push('No succeeded transaction is attached to the venture.')
  if (!requirements.settledInvoice) blockingReasons.push('No paid invoice is linked to a succeeded transaction for the venture.')
  if (!requirements.customerSuccessValue) blockingReasons.push('No customer has reached a value-realized or retained lifecycle state.')
  if (!requirements.missionToMoney) blockingReasons.push('No verified mission-to-money attribution links a mission to a real succeeded transaction.')
  if (!requirements.positiveRecognizedRevenue) blockingReasons.push('No positive recognized revenue is evidenced by reconciled mission-linked transaction outcomes.')

  return {
    ventureId,
    proven: Object.values(requirements).every(Boolean),
    checkedAt: new Date().toISOString(),
    requirements,
    evidence: {
      customerCount,
      transactionCount,
      paidInvoiceCount,
      valueRealizedCustomers: success.valueRealized,
      attributedMissionCount: mission.missionIds.length,
      recognizedRevenue: mission.revenue,
    },
    blockingReasons,
  }
}

export async function assertVentureTemplateProven(ventureId: string): Promise<VentureTemplateProof> {
  const proof = await evaluateVentureTemplateProof(ventureId)
  if (!proof.proven) throw new Error(`Venture template proof failed for ${ventureId}: ${proof.blockingReasons.join(' | ')}`)
  return proof
}

export async function getNventureTemplateCertification(ventureId = 'venture_001') {
  const proof = await evaluateVentureTemplateProof(ventureId)
  return {
    certification: proof.proven ? 'PROVEN_REUSABLE_TEMPLATE' as const : 'NOT_PROVEN' as const,
    proof,
    statement: proof.proven
      ? `Venture ${ventureId} completed the required commercial lifecycle with real evidence; the Venture Factory may be treated as a reusable N-venture template.`
      : `The Venture Factory remains structural-only; reusable N-venture status is not certified until a real venture completes the required lifecycle.`,
  }
}
