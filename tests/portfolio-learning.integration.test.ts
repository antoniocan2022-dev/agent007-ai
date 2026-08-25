import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { db } from '../src/lib/db'
import { ensureInitialBusinessUnits, createOrGetVenture, linkCustomerToVenture } from '../src/lib/venture-commercial-foundation'
import { recordVerifiedTransactionOutcome } from '../src/lib/business-outcome-integrity'
import { activatePortfolioExperiment } from '../src/lib/portfolio-experiments'
import { learnFromPortfolioExperiment } from '../src/lib/portfolio-learning'
import { listExperimentPaymentAttribution } from '../src/lib/portfolio-experiment-attribution'

interface Fixture { userId: string; customerId: string; ventureId: string; transactionIds: string[] }

async function createFixture(): Promise<Fixture> {
  const unique = `${Date.now()}_${randomUUID().slice(0, 8)}`
  const user = await db.user.create({ data: { email: `learning-${unique}@example.com`, passwordHash: 'ci-test-password', name: 'Learning Proof' }, select: { id: true } })
  const customer = await db.customer.create({ data: { userId: user.id, name: 'Learning Customer', email: `learning-${unique}@example.com`, status: 'customer' }, select: { id: true } })
  const units = await ensureInitialBusinessUnits(user.id)
  const venture = await createOrGetVenture({ ventureKey: `venture_learning_ci_${unique.replace(/[^a-z0-9]/gi, '').toLowerCase()}`, businessUnitId: units[0].id, ownerUserId: user.id, name: 'Learning Proof Venture', type: 'integration-test', description: 'Ephemeral learning integration-test venture.', targetMarket: 'CI', pricingModel: 'one-time', status: 'ACTIVE', productionState: 'PRODUCTION' })
  await linkCustomerToVenture(customer.id, venture.id)
  return { userId: user.id, customerId: customer.id, ventureId: venture.id, transactionIds: [] }
}

async function addTransaction(fixture: Fixture, amount: number, providerTxId: string): Promise<string> {
  const transaction = await db.transaction.create({ data: { userId: fixture.userId, provider: 'stripe', providerTxId, amount, currency: 'USD', status: 'succeeded', customerEmail: `learning-${fixture.userId}@example.com`, customerName: 'Learning Customer', rawPayload: JSON.stringify({ test: true }), ventureId: fixture.ventureId, customerId: fixture.customerId }, select: { id: true } })
  fixture.transactionIds.push(transaction.id)
  return transaction.id
}

async function cleanup(fixture: Fixture, experimentId?: string): Promise<void> {
  if (experimentId) {
    const rows = await db.memory.findMany({ where: { category: 'portfolio_experiment_attribution' } })
    for (const row of rows) {
      try { const parsed = JSON.parse(row.value) as { experimentId?: string }; if (parsed.experimentId === experimentId) await db.memory.delete({ where: { id: row.id } }) } catch {}
    }
    await db.memory.delete({ where: { key: `portfolio_learning_${experimentId}` } }).catch(() => undefined)
    await db.memory.delete({ where: { key: experimentId } }).catch(() => undefined)
  }
  for (const transactionId of fixture.transactionIds) {
    await db.memory.delete({ where: { key: `architecture_business_outcome:TRANSACTION:${transactionId}` } }).catch(() => undefined)
    await db.transaction.delete({ where: { id: transactionId } }).catch(() => undefined)
  }
  if (fixture.ventureId) await db.$executeRaw`DELETE FROM "Venture" WHERE "id"=${fixture.ventureId}`.catch(() => undefined)
  await db.customer.delete({ where: { id: fixture.customerId } }).catch(() => undefined)
  await db.user.delete({ where: { id: fixture.userId } }).catch(() => undefined)
}

describe('portfolio continuous learning loop', () => {
  test('verified variant/control payments complete an experiment and create a reallocation record', async () => {
    const fixture = await createFixture()
    let experimentId = ''
    let nextExperimentId = ''
    try {
      const experiment = await activatePortfolioExperiment({ business: 'revenue-recovery', decisionId: `learning_${fixture.ventureId}`, hypothesis: 'Variant improves verified revenue.', metric: 'revenue', baseline: 10, target: 12, budget: 0 })
      experimentId = experiment.experimentId
      const controlTx1 = await addTransaction(fixture, 10, `pi_learning_control_a_${fixture.ventureId}`)
      const controlTx2 = await addTransaction(fixture, 11, `pi_learning_control_b_${fixture.ventureId}`)
      const variantTx1 = await addTransaction(fixture, 25, `pi_learning_variant_a_${fixture.ventureId}`)
      const variantTx2 = await addTransaction(fixture, 26, `pi_learning_variant_b_${fixture.ventureId}`)
      for (const [transactionId, amount, variant] of [
        [controlTx1, 10, experiment.controlVariant],
        [controlTx2, 11, experiment.controlVariant],
        [variantTx1, 25, experiment.variant],
        [variantTx2, 26, experiment.variant],
      ] as const) {
        await recordVerifiedTransactionOutcome({ ventureId: fixture.ventureId, transactionId, amount, currency: 'USD', experimentId, experimentBusiness: 'revenue-recovery', experimentVariant: variant })
      }

      const learning = await learnFromPortfolioExperiment(experiment)
      expect(learning.completed).toBe(true)
      expect(learning.status).toBe('variant_wins')
      expect(learning.winnerVariant).toBe(experiment.variant)
      expect(learning.controlRevenue).toBe(21)
      expect(learning.variantRevenue).toBe(51)
      expect(learning.controlSampleSize).toBe(2)
      expect(learning.variantSampleSize).toBe(2)
      expect(learning.confidence).toBeGreaterThan(0.6)

      const attribution = await listExperimentPaymentAttribution(experimentId)
      expect(attribution).toHaveLength(4)
      const persisted = await db.memory.findUnique({ where: { key: `portfolio_reallocation:revenue-recovery` } })
      expect(persisted).not.toBeNull()

      const next = await activatePortfolioExperiment({ business: 'revenue-recovery', decisionId: `learning_followup_${fixture.ventureId}`, hypothesis: 'Use the verified winner as the next control baseline.', metric: 'revenue', baseline: 51, target: 56, budget: 0 })
      nextExperimentId = next.experimentId
      expect(next.controlVariant).toBe(experiment.variant)
      expect(next.variant).not.toBe(next.controlVariant)
    } finally {
      await db.memory.delete({ where: { key: `portfolio_reallocation:revenue-recovery` } }).catch(() => undefined)
      if (nextExperimentId) await db.memory.delete({ where: { key: nextExperimentId } }).catch(() => undefined)
      await cleanup(fixture, experimentId)
    }
  })

  test('one-sided verified evidence is recorded but does not close the experiment', async () => {
    const fixture = await createFixture()
    let experimentId = ''
    try {
      const experiment = await activatePortfolioExperiment({ business: 'operations-kit', decisionId: `learning_open_${fixture.ventureId}`, hypothesis: 'Keep running until both variants have sufficient evidence.', metric: 'revenue', baseline: 10, target: 12, budget: 0 })
      experimentId = experiment.experimentId
      const variantTx1 = await addTransaction(fixture, 20, `pi_learning_open_a_${fixture.ventureId}`)
      const variantTx2 = await addTransaction(fixture, 21, `pi_learning_open_b_${fixture.ventureId}`)
      await recordVerifiedTransactionOutcome({ ventureId: fixture.ventureId, transactionId: variantTx1, amount: 20, currency: 'USD', experimentId, experimentBusiness: 'operations-kit', experimentVariant: experiment.variant })
      await recordVerifiedTransactionOutcome({ ventureId: fixture.ventureId, transactionId: variantTx2, amount: 21, currency: 'USD', experimentId, experimentBusiness: 'operations-kit', experimentVariant: experiment.variant })
      const learning = await learnFromPortfolioExperiment(experiment)
      expect(learning.completed).toBe(false)
      expect(learning.status).toBe('insufficient_evidence')
      expect(learning.variantSampleSize).toBe(2)
      expect(learning.controlSampleSize).toBe(0)
      const persisted = await db.memory.findUnique({ where: { key: experimentId } })
      expect(persisted).not.toBeNull()
      expect(JSON.parse(persisted!.value).status).toBe('running')
    } finally {
      await cleanup(fixture, experimentId)
    }
  })

  test('activation is idempotent per business while an experiment is active', async () => {
    const fixture = await createFixture()
    let experimentId = ''
    try {
      const first = await activatePortfolioExperiment({ business: 'career-command', decisionId: `learning_idempotent_${fixture.ventureId}_1`, hypothesis: 'One active test per business.', metric: 'revenue', baseline: 10, target: 11, budget: 0 })
      experimentId = first.experimentId
      const second = await activatePortfolioExperiment({ business: 'career-command', decisionId: `learning_idempotent_${fixture.ventureId}_2`, hypothesis: 'Another request must reuse the active experiment.', metric: 'revenue', baseline: 10, target: 12, budget: 0 })
      expect(second.experimentId).toBe(first.experimentId)
      expect(second.status).toBe('running')
    } finally {
      await cleanup(fixture, experimentId)
    }
  })
})
