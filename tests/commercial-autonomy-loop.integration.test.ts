import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { db } from '../src/lib/db'
import { ensureInitialBusinessUnits, createOrGetVenture, linkCustomerToVenture } from '../src/lib/venture-commercial-foundation'
import { recordVerifiedTransactionOutcome } from '../src/lib/business-outcome-integrity'
import { calculateOperationalKpis } from '../src/lib/operational-kpi-engine'
import { formatCeoVentureEvidence } from '../src/lib/ceo-venture-state'
import { activatePortfolioExperiment } from '../src/lib/portfolio-experiments'
import { listExperimentPaymentAttribution } from '../src/lib/portfolio-experiment-attribution'
import { toHealthDecision, toPortfolioDecision } from '../src/lib/portfolio-decision-contract'
import type { PortfolioOperationalDecision } from '../src/lib/portfolio-decision-contract'

const suiteSuffix = `${Date.now()}_${randomUUID().slice(0, 8)}`

interface ProofFixture {
  userId: string
  customerId: string
  ventureId: string
  transactionId: string
}

async function cleanupFixture(fixture: Partial<ProofFixture>, experimentId?: string): Promise<void> {
  if (experimentId) {
    await db.memory.delete({ where: { key: `experiment_attribution_${experimentId}_${fixture.transactionId ?? ''}` } }).catch(() => undefined)
    await db.memory.delete({ where: { key: experimentId } }).catch(() => undefined)
  }
  if (fixture.transactionId) {
    await db.memory.delete({ where: { key: `architecture_business_outcome:TRANSACTION:${fixture.transactionId}` } }).catch(() => undefined)
    await db.transaction.delete({ where: { id: fixture.transactionId } }).catch(() => undefined)
  }
  if (fixture.customerId) await db.customer.delete({ where: { id: fixture.customerId } }).catch(() => undefined)
  if (fixture.ventureId) await db.$executeRaw`DELETE FROM "Venture" WHERE "id"=${fixture.ventureId}`.catch(() => undefined)
  if (fixture.userId) await db.user.delete({ where: { id: fixture.userId } }).catch(() => undefined)
}

async function createRealizedTransaction(amount = 17.5): Promise<ProofFixture> {
  const unique = `${suiteSuffix}_${randomUUID().slice(0, 8)}`
  const fixture: Partial<ProofFixture> = {}
  try {
    const user = await db.user.create({ data: { email: `autonomy-proof-${unique}@example.com`, passwordHash: 'ci-test-password', name: 'Autonomy Proof' }, select: { id: true } })
    fixture.userId = user.id

    const customer = await db.customer.create({ data: { userId: user.id, name: 'Proof Customer', email: `autonomy-proof-${unique}@example.com`, status: 'customer' }, select: { id: true } })
    fixture.customerId = customer.id

    const units = await ensureInitialBusinessUnits(user.id)
    const venture = await createOrGetVenture({
      ventureKey: `venture_autonomy_ci_${unique.replace(/[^a-z0-9]/gi, '').toLowerCase()}`,
      businessUnitId: units[0].id,
      ownerUserId: user.id,
      name: 'Autonomy Proof Venture',
      type: 'integration-test',
      description: 'Ephemeral commercial autonomy integration-test venture.',
      targetMarket: 'CI',
      pricingModel: 'one-time',
      status: 'ACTIVE',
      productionState: 'PRODUCTION',
    })
    fixture.ventureId = venture.id
    await linkCustomerToVenture(customer.id, venture.id)

    const transaction = await db.transaction.create({
      data: {
        userId: user.id,
        provider: 'stripe',
        providerTxId: `pi_ci_${unique}`,
        amount,
        currency: 'USD',
        status: 'succeeded',
        customerEmail: `autonomy-proof-${unique}@example.com`,
        customerName: 'Proof Customer',
        rawPayload: JSON.stringify({ test: true, unique }),
        ventureId: venture.id,
        customerId: customer.id,
      },
      select: { id: true },
    })
    fixture.transactionId = transaction.id
    return fixture as ProofFixture
  } catch (error) {
    await cleanupFixture(fixture)
    throw error
  }
}

describe('Commercial autonomy proof chain', () => {
  test('realized Transaction → verified BusinessOutcome → KPI → CEO evidence', async () => {
    const fixture = await createRealizedTransaction(17.5)
    try {
      const outcome = await recordVerifiedTransactionOutcome({ ventureId: fixture.ventureId, transactionId: fixture.transactionId, amount: 17.5, currency: 'USD', revenueCorrelationId: `proof_${suiteSuffix}` })
      expect(outcome.type).toBe('TRANSACTION')
      expect(outcome.transactionId).toBe(fixture.transactionId)
      expect(outcome.customerId).toBe(fixture.customerId)
      expect(outcome.source).toBe('stripe')
      const kpi = await calculateOperationalKpis(fixture.ventureId, 24)
      expect(kpi.outcomes.transactions).toBeGreaterThanOrEqual(1)
      expect(kpi.outcomes.grossRevenue).toBeGreaterThanOrEqual(17.5)
      expect(kpi.controlHealth.syntheticRevenueDetected).toBe(false)
      const evidence = formatCeoVentureEvidence({ ventureId: fixture.ventureId, venture: null, commercial: null, kpi, operationCheckpoint: null })
      expect(evidence).toContain('grossRevenue=17.50')
      expect(evidence).toContain('syntheticRevenueDetected=false')
      expect(evidence).toContain('TRUTH RULE')
    } finally {
      await cleanupFixture(fixture)
    }
  })

  test('experiment decision activates a controlled running experiment and attribution is transaction-backed', async () => {
    const fixture = await createRealizedTransaction(23)
    let experimentId = ''
    try {
      const experiment = await activatePortfolioExperiment({ business: 'revenue-recovery', decisionId: `decision_${suiteSuffix}_${fixture.transactionId}`, hypothesis: 'Increase verified conversion by testing a controlled offer variant.', metric: 'conversion_rate', baseline: 8, target: 10, budget: 0 })
      experimentId = experiment.experimentId
      expect(experiment.status).toBe('running')
      expect(experiment.variant).toContain('autonomous_variant')
      expect(experiment.controlVariant).toBe('current_baseline')
      const outcome = await recordVerifiedTransactionOutcome({ ventureId: fixture.ventureId, transactionId: fixture.transactionId, amount: 23, currency: 'USD', experimentId, experimentBusiness: 'revenue-recovery', experimentVariant: experiment.variant })
      expect(outcome.experimentId).toBe(experimentId)
      expect(outcome.experimentBusiness).toBe('revenue-recovery')
      const attribution = await listExperimentPaymentAttribution(experimentId)
      expect(attribution).toHaveLength(1)
      expect(attribution[0].transactionId).toBe(fixture.transactionId)
      expect(attribution[0].amount).toBe(23)
      expect(attribution[0].business).toBe('revenue-recovery')
    } finally {
      await cleanupFixture(fixture, experimentId)
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
