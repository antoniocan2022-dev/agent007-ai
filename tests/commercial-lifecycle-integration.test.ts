import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { canTransitionCustomerSuccess } from '../src/lib/customer-success'

const repoRoot = join(import.meta.dir, '..')
const readRepoFile = (path: string) => readFileSync(join(repoRoot, path), 'utf8')

describe('commercial lifecycle integration', () => {
  test('customer success lifecycle has governed transitions and no fabricated default health score', () => {
    expect(canTransitionCustomerSuccess('ONBOARDING', 'ACTIVATING')).toBe(true)
    expect(canTransitionCustomerSuccess('ONBOARDING', 'RETAINED')).toBe(false)
    const source = readRepoFile('src/lib/customer-success.ts')
    expect(source).toContain('CustomerSuccessState')
    expect(source).toContain("VALUES (${id},${ventureId},${customerId},'ONBOARDING','NOT_STARTED','UNKNOWN',NULL,NULL,NULL,NULL,NULL,${ownerUserId})")
    expect(source).toContain('healthScore: number | null')
  })

  test('portfolio intelligence uses relational commercial state rather than static portfolio performance fields', () => {
    const source = readRepoFile('src/lib/portfolio-intelligence-engine.ts')
    const adapter = readRepoFile('src/lib/portfolio-commercial-intelligence.ts')
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

  test('mission-to-money requires a succeeded venture-scoped transaction and records canonical outcomes', () => {
    const source = readRepoFile('src/lib/mission-money-bridge.ts')
    expect(source).toContain('transaction.ventureId !== ventureId')
    expect(source).toContain("transaction.status !== 'succeeded'")
    expect(source).toContain("type: 'TRANSACTION'")
    expect(source).toContain("type: 'REVENUE_RECOGNIZED'")
    expect(source).toContain('recordBusinessOutcome')
    expect(source).toContain('getMissionMoneySummary')
  })

  test('template certification requires real commercial lifecycle proof and never certifies structural shells', () => {
    const source = readRepoFile('src/lib/venture-template-validation.ts')
    const factory = readRepoFile('src/lib/venture-factory.ts')
    expect(source).toContain("venture?.productionState === 'PRODUCTION'")
    expect(source).toContain('realCustomer: customerCount > 0')
    expect(source).toContain('successfulTransaction: transactionCount > 0')
    expect(source).toContain('settledInvoice: paidInvoiceCount > 0')
    expect(source).toContain('customerSuccessValue: success.valueRealized > 0')
    expect(source).toContain('missionToMoney: mission.missionIds.length > 0')
    expect(source).toContain('positiveRecognizedRevenue: mission.revenue > 0')
    expect(factory).toContain('certifyVentureFactoryTemplate')
  })

  test('commercial lifecycle schema is durable, unique, and venture-scoped', () => {
    const source = readRepoFile('src/lib/reconcile-production-schema.ts')
    expect(source).toContain('CustomerSuccessState_ventureId_customerId_key')
    expect(source).toContain('CustomerSuccessState_ventureId_fkey')
    expect(source).toContain('CustomerSuccessState_customerId_fkey')
    expect(source).toContain('CustomerSuccessState_ownerUserId_fkey')
    expect(source).toContain('if (indexes.length !== 15)')
  })
})
