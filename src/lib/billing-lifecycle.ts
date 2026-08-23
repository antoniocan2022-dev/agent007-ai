import { db } from './db'
import { getVenture } from './venture-commercial-foundation'

export type InvoiceSettlementResult = { invoiceId: string; status: 'paid'; transactionId: string; paidAt: string }

export async function settleInvoiceFromTransaction(invoiceId: string, transactionId: string): Promise<InvoiceSettlementResult> {
  const invoiceRows = await db.$queryRaw<Array<{ id:string; ventureId:string; customerId:string; amount:number; currency:string; status:string }>>`
    SELECT "id","ventureId","customerId","amount","currency","status" FROM "Invoice" WHERE "id"=${invoiceId} LIMIT 1
  `
  const invoice = invoiceRows[0]
  if (!invoice) throw new Error(`Invoice not found: ${invoiceId}.`)
  if (invoice.status === 'paid') return { invoiceId, status: 'paid', transactionId, paidAt: new Date().toISOString() }
  if (invoice.status === 'refunded' || invoice.status === 'cancelled') throw new Error(`Invoice ${invoiceId} is terminal in ${invoice.status} state.`)

  const txRows = await db.$queryRaw<Array<{ id:string; ventureId:string|null; amount:number; currency:string; status:string; createdAt:Date }>>`
    SELECT "id","ventureId","amount","currency","status","createdAt" FROM "Transaction" WHERE "id"=${transactionId} LIMIT 1
  `
  const tx = txRows[0]
  if (!tx) throw new Error(`Transaction not found: ${transactionId}.`)
  if (tx.ventureId !== invoice.ventureId) throw new Error('Invoice and transaction belong to different ventures.')
  if (tx.status !== 'succeeded') throw new Error('Only a succeeded transaction can settle an invoice.')
  if (Number(tx.amount) !== Number(invoice.amount) || tx.currency.toUpperCase() !== invoice.currency.toUpperCase()) throw new Error('Transaction amount/currency does not match invoice.')

  const paidAt = new Date().toISOString()
  await db.$executeRaw`
    UPDATE "Invoice" SET "status"='paid', "paidAt"=${paidAt}, "transactionId"=${transactionId}, "updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${invoiceId}
  `
  return { invoiceId, status: 'paid', transactionId, paidAt }
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
  await db.$executeRaw`UPDATE "Subscription" SET "status"='active', "currentPeriodStart"=${new Date(nextPeriodStart).toISOString()}, "currentPeriodEnd"=${new Date(nextPeriodEnd).toISOString()}, "cancelAtPeriodEnd"=FALSE, "updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${subscriptionId}`
}
