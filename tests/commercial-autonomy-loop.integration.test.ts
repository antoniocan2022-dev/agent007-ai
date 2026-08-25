import { describe, expect, test } from 'bun:test'
import { db } from '../src/lib/db'
import { recordVerifiedTransactionOutcome } from '../src/lib/business-outcome-integrity'
import { calculateOperationalKpis } from '../src/lib/operational-kpi-engine'
import { formatCeoVentureEvidence } from '../src/lib/ceo-venture-state'
import { activatePortfolioExperiment } from '../src/lib/portfolio-experiments'
import { listExperimentPaymentAttribution } from '../src/lib/portfolio-experiment-attribution'
import { toHealthDecision, toPortfolioDecision } from '../src/lib/portfolio-decision-contract'
import type { PortfolioOperationalDecision } from '../src/lib/portfolio-decision-contract'

const suiteSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const ventureId = 'venture_001'

async function createRealizedTransaction(amount = 17.5) {
  const unique = `${suiteSuffix}_${Math.random().toString(36).slice(2, 8)}`
  const email = `autonomy-proof-${unique}@example.com`
  const user = await db.user.create({ data: { email, passwordHash: 'ci-test-password', name: 'Autonomy Proof' } })
  const customer = await db.customer.create({ data: { userId: user.id, name: 'Proof Customer', email, status: 'customer' } })
  const transaction = await db.transaction.create({ data: { userId: user.id, provider: 'stripe', providerTxId: `pi_ci_${unique}`, amount, currency: 'USD', status: 'succeeded', customerEmail: email, customerName: 'Proof Customer', rawPayload: JSON.stringify({ test: true }), ventureId, customerId: customer.id } })
  return { user, customer, transaction }
}

describe('Commercial autonomy proof chain', () => {
  test('realized Transaction → verified BusinessOutcome → KPI → CEO evidence', async () => {
    const { user, customer, transaction } = await createRealizedTransaction(17.5)
    try {
      const outcome = await recordVerifiedTransactionOutcome({ ventureId, transactionId: transaction.id, amount: 17.5, currency: 'USD', revenueCorrelationId: `proof_${suiteSuffix}` })
      expect(outcome.type).toBe('TRANSACTION')
      expect(outcome.transactionId).toBe(transaction.id)
      expect(outcome.customerId).toBe(customer.id)
      expect(outcome.source).toBe('stripe')
      const kpi = await calculateOperationalKpis(ventureId, 24)
      expect(kpi.outcomes.transactions).toBeGreaterThanOrEqual(1)
      expect(kpi.outcomes.grossRevenue).toBeGreaterThanOrEqual(17.5)
      expect(kpi.controlHealth.syntheticRevenueDetected).toBe(false)
      const evidence = formatCeoVentureEvidence({ ventureId, venture: null, commercial: null, kpi, operationCheckpoint: null })
      expect(evidence).toContain('grossRevenue=17.50')
      expect(evidence).toContain('syntheticRevenueDetected=false')
      expect(evidence).toContain('TRUTH RULE')
    } finally {
      await db.memory.delete({ where: { key: `architecture_business_outcome:TRANSACTION:${transaction.id}` } }).catch(() => undefined)
      await db.transaction.delete({ where: { id: transaction.id } })
      await db.customer.delete({ where: { id: customer.id } })
      await db.user.delete({ where: { id: user.id } })
    }
  })

  test('experiment decision activates a controlled running experiment and attribution is transaction-backed', async () => {
    const { user, customer, transaction } = await createRealizedTransaction(23)
    let experimentId = ''
    try {
      const experiment = await activatePortfolioExperiment({ business: 'revenue-recovery', decisionId: `decision_${suiteSuffix}_${transaction.id}`, hypothesis: 'Increase verified conversion by testing a controlled offer variant.', metric: 'conversion_rate', baseline: 8, target: 10, budget: 0 })
      experimentId = experiment.experimentId
      expect(experiment.status).toBe('running')
      expect(experiment.variant).toContain('autonomous_variant')
      expect(experiment.controlVariant).toBe('current_baseline')
      const outcome = await recordVerifiedTransactionOutcome({ ventureId, transactionId: transaction.id, amount: 23, currency: 'USD', experimentId, experimentBusiness: 'revenue-recovery', experimentVariant: experiment.variant })
      expect(outcome.experimentId).toBe(experimentId)
      const attribution = await listExperimentPaymentAttribution(experimentId)
      expect(attribution).toHaveLength(1)
      expect(attribution[0].transactionId).toBe(transaction.id)
      expect(attribution[0].amount).toBe(23)
      expect(attribution[0].business).toBe('revenue-recovery')
    } finally {
      if (experimentId) await db.memory.delete({ where: { key: experimentId } }).catch(() => undefined)
      await db.memory.delete({ where: { key: `architecture_business_outcome:TRANSACTION:${transaction.id}` } }).catch(() => undefined)
      if (experimentId) await db.memory.delete({ where: { key: `experiment_attribution_${experimentId}_${transaction.id}` } }).catch(() => undefined)
      await db.transaction.delete({ where: { id: transaction.id } })
      await db.customer.delete({ where: { id: customer.id } })
      await db.user.delete({ where: { id: user.id } })
    }
  })

  test('decision taxonomies converge through the canonical contract without erasing lifecycle semantics', () => {
    const decisions: PortfolioOperationalDecision[] = ['scale', 'optimize', 'experiment', 'hold', 'pivot', 'kill']
    for (const decision of decisions) expect(toHealthDecision(decision)).toBeDefined()
    expect(toPortfolioDecision('launch_ready')).toBe('hold')
    expect(toPortfolioDecision('kill_or_pivot')).toBe('pivot')
    expect(toPortfolioDecision('experiment')).toBe('experiment')
  })
})
