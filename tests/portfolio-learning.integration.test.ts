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
    try {
      const experiment = await activatePortfolioExperiment({ business: 'revenue-recovery', decisionId: `learning_${fixture.ventureId}`, hypothesis: 'Variant improves verified revenue.', metric: 'revenue', baseline: 10, target: 12, budget: 0 })
      experimentId = experiment.experimentId
      const controlTx = await addTransaction(fixture, 10, `pi_learning_control_${fixture.ventureId}`)
      const variantTx = await addTransaction(fixture, 25, `pi_learning_variant_${fixture.ventureId}`)
      await recordVerifiedTransactionOutcome({ ventureId: fixture.ventureId, transactionId: controlTx, amount: 10, currency: 'USD', experimentId, experimentBusiness: 'revenue-recovery', experimentVariant: experiment.controlVariant })
      await recordVerifiedTransactionOutcome({ ventureId: fixture.ventureId, transactionId: variantTx, amount: 25, currency: 'USD', experimentId, experimentBusiness: 'revenue-recovery', experimentVariant: experiment.variant })

      const learning = await learnFromPortfolioExperiment(experiment)
      expect(learning.completed).toBe(true)
      expect(learning.status).toBe('variant_wins')
      expect(learning.winnerVariant).toBe(experiment.variant)
      expect(learning.controlRevenue).toBe(10)
      expect(learning.variantRevenue).toBe(25)
      expect(learning.confidence).toBeGreaterThan(0.5)

      const attribution = await listExperimentPaymentAttribution(experimentId)
      expect(attribution).toHaveLength(2)
      const persisted = await db.memory.findUnique({ where: { key: `portfolio_reallocation:revenue-recovery` } })
      expect(persisted).not.toBeNull()
    } finally {
      await cleanup(fixture, experimentId)
    }
  })

  test('one-sided verified evidence is recorded but does not close the experiment', async () => {
    const fixture = await createFixture()
    let experimentId = ''
    try {
      const experiment = await activatePortfolioExperiment({ business: 'revenue-recovery', decisionId: `learning_open_${fixture.ventureId}`, hypothesis: 'Keep running until both variants have evidence.', metric: 'revenue', baseline: 10, target: 12, budget: 0 })
      experimentId = experiment.experimentId
      const variantTx = await addTransaction(fixture, 20, `pi_learning_open_${fixture.ventureId}`)
      await recordVerifiedTransactionOutcome({ ventureId: fixture.ventureId, transactionId: variantTx, amount: 20, currency: 'USD', experimentId, experimentBusiness: 'revenue-recovery', experimentVariant: experiment.variant })
      const learning = await learnFromPortfolioExperiment(experiment)
      expect(learning.completed).toBe(false)
      expect(learning.status).toBe('insufficient_evidence')
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
      const first = await activatePortfolioExperiment({ business: 'revenue-recovery', decisionId: `learning_idempotent_${fixture.ventureId}_1`, hypothesis: 'One active test per business.', metric: 'revenue', baseline: 10, target: 11, budget: 0 })
      experimentId = first.experimentId
      const second = await activatePortfolioExperiment({ business: 'revenue-recovery', decisionId: `learning_idempotent_${fixture.ventureId}_2`, hypothesis: 'Another request must reuse the active experiment.', metric: 'revenue', baseline: 10, target: 12, budget: 0 })
      expect(second.experimentId).toBe(first.experimentId)
      expect(second.status).toBe('running')
    } finally {
      await cleanup(fixture, experimentId)
    }
  })
})
