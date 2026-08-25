import { readFile } from 'node:fs/promises'
import { db } from '../src/lib/db'
import { assertRealSucceededTransaction } from '../src/lib/transaction-evidence-integrity'
import { calculateOperationalKpis } from '../src/lib/operational-kpi-engine'

const requiredFiles = [
  'src/app/api/checkout/route.ts',
  'src/app/api/webhooks/stripe/route.ts',
  'src/lib/business-outcome-integrity.ts',
  'src/lib/operational-kpi-engine.ts',
  'src/lib/ceo-venture-state.ts',
]

for (const file of requiredFiles) {
  await readFile(file, 'utf8')
}

const [checkout, webhook, outcome, kpi, ceo] = await Promise.all(requiredFiles.map((file) => readFile(file, 'utf8')))

const checks: Array<[string, boolean]> = [
  ['Checkout carries owner metadata', checkout.includes('agent007UserId')],
  ['Checkout supports canonical venture scope metadata', checkout.includes('ventureId')],
  ['Checkout supports experiment attribution metadata', checkout.includes('experimentId') && checkout.includes('experimentVariant')],
  ['Stripe webhook verifies the provider signature', webhook.includes('constructEvent')],
  ['Stripe webhook creates/updates a real Transaction', webhook.includes('db.transaction.create') && webhook.includes('db.transaction.update')],
  ['Stripe webhook emits verified BusinessOutcome evidence', webhook.includes('recordVerifiedTransactionOutcome')],
  ['BusinessOutcome requires verified succeeded Transaction evidence', outcome.includes('assertRealSucceededTransaction')],
  ['KPI engine consumes architecture_business_outcome', kpi.includes("r.category === 'architecture_business_outcome'")],
  ['KPI engine re-verifies revenue transactions', kpi.includes('assertRealSucceededTransaction')],
  ['CEO layer consumes the KPI evidence path', ceo.includes('calculateOperationalKpis')],
]

const failures = checks.filter(([, ok]) => !ok).map(([name]) => name)
if (failures.length) throw new Error(`Real-money proof architecture is incomplete: ${failures.join('; ')}`)

const transactionId = process.env.REAL_MONEY_PROOF_TRANSACTION_ID?.trim()
const ventureId = process.env.REAL_MONEY_PROOF_VENTURE_ID?.trim()
if (transactionId || ventureId) {
  if (!transactionId || !ventureId) throw new Error('REAL_MONEY_PROOF_TRANSACTION_ID and REAL_MONEY_PROOF_VENTURE_ID must be supplied together.')
  const verified = await assertRealSucceededTransaction({ ventureId, transactionId })
  const kpiSnapshot = await calculateOperationalKpis(ventureId, 24)
  if (!kpiSnapshot.outcomes.transactions) throw new Error('The supplied real transaction did not produce a verified KPI outcome.')
  console.log(JSON.stringify({ mode: 'live-verification', transactionId: verified.id, ventureId: verified.ventureId, customerId: verified.customerId, amount: verified.amount, currency: verified.currency, kpiRevenue: kpiSnapshot.outcomes.grossRevenue, syntheticRevenueDetected: kpiSnapshot.controlHealth.syntheticRevenueDetected }, null, 2))
} else {
  console.log(JSON.stringify({ mode: 'architecture-only', message: 'Architecture is wired for real-money proof. Supply REAL_MONEY_PROOF_TRANSACTION_ID and REAL_MONEY_PROOF_VENTURE_ID after a controlled Stripe test payment has been ingested to perform the external payment verification.' }, null, 2))
}

await db.$disconnect()
