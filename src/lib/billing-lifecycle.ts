import { db } from './db'
import { getVenture } from './venture-commercial-foundation'
import { assertRealSucceededTransaction } from './transaction-evidence-integrity'

export type InvoiceSettlementResult = { invoiceId: string; status: 'paid'; transactionId: string; paidAt: string }

export async function settleInvoiceFromTransaction(invoiceId: string, transactionId: string): Promise<InvoiceSettlementResult> {
  const invoiceRows = await db.$queryRaw<Array<{ id:string; ventureId:string; customerId:string; amount:number; currency:string; status:string; transactionId:string|null; paidAt:Date|null }>>`
    SELECT "id","ventureId","customerId","amount","currency","status","transactionId","paidAt" FROM "Invoice" WHERE "id"=${invoiceId} LIMIT 1
  `
  const invoice = invoiceRows[0]
  if (!invoice) throw new Error(`Invoice not found: ${invoiceId}.`)
  const requestedTransactionId = transactionId.trim()
  if (!requestedTransactionId) throw new Error('transactionId is required.')

  if (invoice.status === 'paid') {
    if (invoice.transactionId !== requestedTransactionId) throw new Error(`Invoice ${invoiceId} is already paid by transaction ${invoice.transactionId ?? 'unknown'}, not ${requestedTransactionId}.`)
    const verified = await assertRealSucceededTransaction({ ventureId: invoice.ventureId, transactionId: requestedTransactionId, amount: Number(invoice.amount), currency: invoice.currency })
    return { invoiceId, status: 'paid', transactionId: verified.id, paidAt: invoice.paidAt ? new Date(invoice.paidAt).toISOString() : new Date().toISOString() }
  }
  if (invoice.status === 'refunded' || invoice.status === 'cancelled') throw new Error(`Invoice ${invoiceId} is terminal in ${invoice.status} state.`)

  const tx = await assertRealSucceededTransaction({ ventureId: invoice.ventureId, transactionId: requestedTransactionId, amount: Number(invoice.amount), currency: invoice.currency })
  if (tx.customerId && tx.customerId !== invoice.customerId) throw new Error(`Invoice ${invoiceId} belongs to customer ${invoice.customerId}, not transaction customer ${tx.customerId}.`)

  const paidAt = new Date().toISOString()
  const updated = await db.$executeRaw`
    UPDATE "Invoice"
    SET "status"='paid', "paidAt"=${paidAt}, "transactionId"=${tx.id}, "updatedAt"=CURRENT_TIMESTAMP
    WHERE "id"=${invoiceId} AND "status" NOT IN ('paid','refunded','cancelled')
  `
  if (updated !== 1) {
    const current = await db.$queryRaw<Array<{ status:string; transactionId:string|null; paidAt:Date|null }>>`SELECT "status","transactionId","paidAt" FROM "Invoice" WHERE "id"=${invoiceId} LIMIT 1`
    if (current[0]?.status === 'paid' && current[0].transactionId === tx.id) return { invoiceId, status:'paid', transactionId:tx.id, paidAt: current[0].paidAt ? new Date(current[0].paidAt).toISOString() : paidAt }
    throw new Error(`Invoice ${invoiceId} could not be settled because its state changed concurrently.`)
  }
  return { invoiceId, status: 'paid', transactionId: tx.id, paidAt }
}

export async function cancelSubscription(subscriptionId: string): Promise<void> {
  const rows = await db.$queryRaw<Array<{ id:string; ventureId:string; status:string }>>`SELECT "id","ventureId","status" FROM "Subscription" WHERE "id"=${subscriptionId} LIMIT 1`
  const subscription = rows[0]
  if (!subscription) throw new Error(`Subscription not found: ${subscriptionId}.`)
  if (!await getVenture(subscription.ventureId)) throw new Error(`Relational venture not found for subscription ${subscriptionId}.`)
  if (subscription.status === 'cancelled' || subscription.status === 'expired') return
  await db.$executeRaw`UPDATE "Subscription" SET "status"='cancelled', "cancelAtPeriodEnd"=TRUE, "updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${subscriptionId}`
}

export async function markSubscriptionPastDue(subscriptionId: string): Promise<void> {
  const rows = await db.$queryRaw<Array<{ id:string; ventureId:string; status:string }>>`SELECT "id","ventureId","status" FROM "Subscription" WHERE "id"=${subscriptionId} LIMIT 1`
  if (!rows[0]) throw new Error(`Subscription not found: ${subscriptionId}.`)
  if (!await getVenture(rows[0].ventureId)) throw new Error(`Relational venture not found for subscription ${subscriptionId}.`)
  if (['cancelled','expired'].includes(rows[0].status)) throw new Error(`Subscription ${subscriptionId} cannot become past_due from ${rows[0].status}.`)
  await db.$executeRaw`UPDATE "Subscription" SET "status"='past_due', "updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${subscriptionId}`
}

export async function activateSubscriptionFromPaidInvoice(subscriptionId: string, nextPeriodStart: string, nextPeriodEnd: string): Promise<void> {
  const rows = await db.$queryRaw<Array<{ id:string; ventureId:string; status:string }>>`SELECT "id","ventureId","status" FROM "Subscription" WHERE "id"=${subscriptionId} LIMIT 1`
  if (!rows[0]) throw new Error(`Subscription not found: ${subscriptionId}.`)
  if (!await getVenture(rows[0].ventureId)) throw new Error(`Relational venture not found for subscription ${subscriptionId}.`)
  if (!Number.isFinite(Date.parse(nextPeriodStart)) || !Number.isFinite(Date.parse(nextPeriodEnd))) throw new Error('Subscription period timestamps are invalid.')
  if (Date.parse(nextPeriodEnd) <= Date.parse(nextPeriodStart)) throw new Error('Subscription next period must end after it starts.')
  const paidInvoice = await db.$queryRaw<Array<{ id:string; transactionId:string|null }>>`
    SELECT "id","transactionId" FROM "Invoice" WHERE "subscriptionId"=${subscriptionId} AND "status"='paid' ORDER BY "paidAt" DESC NULLS LAST LIMIT 1
  `
  if (!paidInvoice[0]?.transactionId) throw new Error(`Subscription ${subscriptionId} cannot be activated without a paid invoice linked to a transaction.`)
  await db.$executeRaw`UPDATE "Subscription" SET "status"='active', "currentPeriodStart"=${new Date(nextPeriodStart).toISOString()}, "currentPeriodEnd"=${new Date(nextPeriodEnd).toISOString()}, "cancelAtPeriodEnd"=FALSE, "updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${subscriptionId}`
}
