import { db } from './db'
import { getVenture } from './venture-commercial-foundation'
import { getCustomerSuccessSnapshot } from './customer-success'
import { getMissionMoneySummary } from './mission-money-bridge'

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
  const missionIds = new Set<string>()
  let revenue = 0
  for (const row of rows) {
    try {
      const outcome = JSON.parse(row.value) as { ventureId?: string; missionId?: string | null; type?: string; amount?: number | null; transactionId?: string | null }
      if (outcome.ventureId !== ventureId || outcome.type !== 'REVENUE_RECOGNIZED' || !outcome.transactionId || !outcome.missionId) continue
      missionIds.add(outcome.missionId)
      if (Number.isFinite(Number(outcome.amount))) revenue += Number(outcome.amount)
    } catch {
      // Ignore malformed observational records; never treat them as proof.
    }
  }
  return { missionIds: [...missionIds], revenue: Number(revenue.toFixed(2)) }
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
  if (!requirements.missionToMoney) blockingReasons.push('No mission-to-money attribution links a mission to a transaction outcome.')
  if (!requirements.positiveRecognizedRevenue) blockingReasons.push('No positive recognized revenue is evidenced by mission-linked transaction outcomes.')

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
