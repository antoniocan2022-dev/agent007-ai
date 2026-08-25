import Stripe from 'stripe'
import { db } from '../src/lib/db'
import { assertRealSucceededTransaction } from '../src/lib/transaction-evidence-integrity'
import { calculateOperationalKpis } from '../src/lib/operational-kpi-engine'

const stripeSecret = process.env.STRIPE_TEST_SECRET_KEY?.trim()
const ownerUserId = process.env.REAL_MONEY_PROOF_OWNER_USER_ID?.trim()
const ventureId = process.env.REAL_MONEY_PROOF_VENTURE_ID?.trim()
const amountCents = Number(process.env.REAL_MONEY_PROOF_AMOUNT_CENTS ?? 100)
const correlationId = `real_money_proof_${Date.now()}`

if (!stripeSecret) throw new Error('STRIPE_TEST_SECRET_KEY is required.')
if (!ownerUserId) throw new Error('REAL_MONEY_PROOF_OWNER_USER_ID is required.')
if (!ventureId || !/^venture_\d{3}$/.test(ventureId)) throw new Error('REAL_MONEY_PROOF_VENTURE_ID must use venture_### format.')
if (!Number.isInteger(amountCents) || amountCents < 50) throw new Error('REAL_MONEY_PROOF_AMOUNT_CENTS must be an integer >= 50.')

const owner = await db.user.findUnique({ where: { id: ownerUserId }, select: { id: true } })
if (!owner) throw new Error(`Proof owner does not exist: ${ownerUserId}`)

const stripe = new Stripe(stripeSecret, { apiVersion: '2024-12-18.acacia' as any })
const paymentIntent = await stripe.paymentIntents.create({
  amount: amountCents,
  currency: 'usd',
  payment_method: 'pm_card_visa',
  confirm: true,
  description: 'Agent007 controlled real-money proof',
  metadata: {
    agent007UserId: ownerUserId,
    ventureId,
    revenueCorrelationId: correlationId,
    source: 'agent007-real-money-proof',
  },
})

if (paymentIntent.status !== 'succeeded') throw new Error(`Stripe test PaymentIntent did not succeed: ${paymentIntent.status}`)

const deadline = Date.now() + 90_000
let transaction: { id: string; providerTxId: string; status: string; ventureId: string | null; customerId: string | null; amount: number; currency: string } | null = null
while (Date.now() < deadline) {
  transaction = await db.transaction.findUnique({ where: { provider_providerTxId: { provider: 'stripe', providerTxId: paymentIntent.id } }, select: { id: true, providerTxId: true, status: true, ventureId: true, customerId: true, amount: true, currency: true } })
  if (transaction?.status === 'succeeded') break
  await new Promise((resolve) => setTimeout(resolve, 3000))
}
if (!transaction) throw new Error(`Stripe payment ${paymentIntent.id} succeeded, but no Agent007 Transaction was ingested within 90 seconds.`)
if (transaction.ventureId !== ventureId) throw new Error(`Transaction venture mismatch: expected ${ventureId}, received ${transaction.ventureId}`)
if (!transaction.customerId) throw new Error('Transaction succeeded but no customerId was recorded.')

const verified = await assertRealSucceededTransaction({ ventureId, transactionId: transaction.id, amount: amountCents / 100, currency: 'USD', customerId: transaction.customerId } as any)
const kpi = await calculateOperationalKpis(ventureId, 24)
if (kpi.controlHealth.syntheticRevenueDetected) throw new Error('Synthetic revenue was detected in the KPI proof snapshot.')
if (kpi.outcomes.grossRevenue < amountCents / 100) throw new Error(`KPI gross revenue did not include the proof payment. expected_at_least=${amountCents / 100}, actual=${kpi.outcomes.grossRevenue}`)

console.log(JSON.stringify({
  paymentIntentId: paymentIntent.id,
  transactionId: verified.id,
  ventureId: verified.ventureId,
  customerId: verified.customerId,
  amount: verified.amount,
  currency: verified.currency,
  kpiGrossRevenue: kpi.outcomes.grossRevenue,
  syntheticRevenueDetected: kpi.controlHealth.syntheticRevenueDetected,
  correlationId,
}, null, 2))

await db.$disconnect()
