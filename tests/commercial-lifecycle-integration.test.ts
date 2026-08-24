import { describe, expect, test } from 'bun:test'
import { canTransitionCustomerSuccess } from '../src/lib/customer-success'

const readRepoFile = (path: string) => Bun.file(new URL(`../${path}`, import.meta.url)).text()

describe('commercial lifecycle integration', () => {
  test('customer success lifecycle has governed transitions and no fabricated default health score', async () => {
    expect(canTransitionCustomerSuccess('ONBOARDING', 'ACTIVATING')).toBe(true)
    expect(canTransitionCustomerSuccess('ONBOARDING', 'RETAINED')).toBe(false)
    const source = await readRepoFile('src/lib/customer-success.ts')
    expect(source).toContain('CustomerSuccessState')
    expect(source).toContain("VALUES (${id},${ventureId},${customerId},'ONBOARDING','NOT_STARTED','UNKNOWN',NULL,NULL,NULL,NULL,NULL,${ownerUserId})")
    expect(source).toContain('healthScore: number | null')
  })

  test('portfolio intelligence uses relational commercial state rather than static portfolio performance fields', async () => {
    const source = await readRepoFile('src/lib/portfolio-intelligence-engine.ts')
    const adapter = await readRepoFile('src/lib/portfolio-commercial-intelligence.ts')
    expect(source).toContain('buildRelationalPortfolioMetrics')
    expect(source).not.toContain('getPortfolio()')
    expect(source).not.toContain('monthlyRevenue')
    expect(source).not.toContain('monthlyCost')
    expect(source).not.toContain('customerCount')
    expect(adapter).toContain('"Transaction"')
    expect(adapter).toContain('"Customer"')
    expect(adapter).toContain('"MarketingCampaign"')
    expect(adapter).toContain('tracked-campaign-spend-only')
  })

  test('mission-to-money uses the canonical relational transaction evidence boundary', async () => {
    const source = await readRepoFile('src/lib/mission-money-bridge.ts')
    const evidenceBoundary = await readRepoFile('src/lib/transaction-evidence-integrity.ts')
    expect(source).toContain("import { assertRealSucceededTransaction } from './transaction-evidence-integrity'")
    expect(source).toContain('const transaction = await assertRealSucceededTransaction({ ventureId, transactionId })')
    expect(source).toContain("type: 'TRANSACTION'")
    expect(source).toContain("type: 'REVENUE_RECOGNIZED'")
    expect(source).toContain('recordBusinessOutcome')
    expect(source).toContain('getMissionMoneySummary')

    // The evidence boundary intentionally uses the canonical Prisma client rather
    // than raw SQL. Test the semantic contract instead of coupling CI to a query
    // string that can legitimately change during a persistence refactor.
    expect(evidenceBoundary).toContain('db.transaction.findUnique')
    expect(evidenceBoundary).toContain('ventureId: true')
    expect(evidenceBoundary).toContain('customerId: true')
    expect(evidenceBoundary).toContain('status: true')
    expect(evidenceBoundary).toContain('db.customer.findUnique')
    expect(evidenceBoundary).toContain('customer.userId !== transaction.userId')
    expect(evidenceBoundary).toContain("transaction.status !== 'succeeded'")
    expect(evidenceBoundary).toContain('transaction.ventureId !== input.ventureId.trim()')
    expect(evidenceBoundary).toContain('transaction amount does not match supplied evidence')
    expect(evidenceBoundary).toContain('transaction currency does not match supplied evidence')
  })

  test('template certification requires real commercial lifecycle proof and never certifies structural shells', async () =>
    const source = await readRepoFile('src/lib/venture-template-validation.ts')
    const factory = await readRepoFile('src/lib/venture-factory.ts')
    expect(source).toContain("venture?.productionState === 'PRODUCTION'")
    expect(source).toContain('realCustomer: customerCount > 0')
    expect(source).toContain('successfulTransaction: transactionCount > 0')
    expect(source).toContain('settledInvoice: paidInvoiceCount > 0')
    expect(source).toContain('customerSuccessValue: success.valueRealized > 0')
    expect(source).toContain('missionToMoney: mission.missionIds.length > 0')
    expect(source).toContain('positiveRecognizedRevenue: mission.revenue > 0')
    expect(factory).toContain('certifyVentureFactoryTemplate')
  })

  test('commercial lifecycle schema is durable, unique, and venture-scoped', async () => {
    const source = await readRepoFile('src/lib/reconcile-production-schema.ts')
    expect(source).toContain('CustomerSuccessState_ventureId_customerId_key')
    expect(source).toContain('CustomerSuccessState_ventureId_fkey')
    expect(source).toContain('CustomerSuccessState_customerId_fkey')
    expect(source).toContain('CustomerSuccessState_ownerUserId_fkey')
    expect(source).toContain('Transaction_customerId_idx')
    expect(source).toContain('Transaction_customerId_fkey')
    expect(source).toContain('if (indexes.length !== 16)')
  })
})
