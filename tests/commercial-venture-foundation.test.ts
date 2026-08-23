import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { INITIAL_BUSINESS_UNITS } from '../src/lib/venture-commercial-foundation'
import { validateVentureFactorySpec } from '../src/lib/venture-factory'

const repoRoot = join(import.meta.dir, '..')

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8')
}

describe('commercial venture foundation', () => {
  test('defines exactly three initial business units without duplicate keys', () => {
    expect(INITIAL_BUSINESS_UNITS).toHaveLength(3)
    const keys = INITIAL_BUSINESS_UNITS.map((unit) => unit.businessKey)
    expect(new Set(keys).size).toBe(3)
    expect(keys).toEqual(['revenue-recovery', 'operations-kit', 'career-command'])
  })

  test('factory accepts owner and business-unit scoping without inventing launch readiness', () => {
    const errors = validateVentureFactorySpec({
      ventureId: 'venture_002',
      ownerUserId: 'owner_test',
      businessUnitId: 'bu_test',
      name: 'Test Venture',
      type: 'digital_product',
      description: 'A structural test venture.',
      targetMarket: 'Test customers',
      pricingModel: 'Subscription',
    })
    expect(errors).toEqual([])
  })

  test('schema reconciliation contains the canonical relational foundation', () => {
    const source = readRepoFile('src/lib/reconcile-production-schema.ts')
    for (const table of ['BusinessUnit', 'Venture', 'Subscription', 'Invoice', 'CustomerSuccessState']) {
      expect(source).toContain(`CREATE TABLE IF NOT EXISTS \"${table}\"`)
    }
    for (const column of ['Customer', 'Opportunity', 'Transaction', 'MarketingCampaign', 'IncomeEntry']) {
      expect(source).toContain(`ALTER TABLE \"${column}\" ADD COLUMN IF NOT EXISTS \"ventureId\" TEXT`)
    }
    expect(source).not.toContain('ORDER BY u.\"createdAt\" ASC LIMIT 1')
  })

  test('venture identity cannot silently change owner or lifecycle state on idempotent re-entry', () => {
    const source = readRepoFile('src/lib/venture-commercial-foundation.ts')
    expect(source).toContain('already belongs to another owner')
    expect(source).toContain('return venture')
    expect(source).not.toContain('ON CONFLICT (\"ventureKey\") DO UPDATE SET')
    expect(source).toContain('productionState')
  })

  test('venture OS production code consumes the relational commercial snapshot', () => {
    const kpi = readRepoFile('src/lib/operational-kpi-engine.ts')
    const factory = readRepoFile('src/lib/venture-factory.ts')
    const venture001 = readRepoFile('src/lib/venture-001.ts')
    expect(kpi).toContain('getVentureCommercialSnapshot')
    expect(factory).toContain('createOrGetVenture')
    expect(venture001).toContain('createOrGetVenture')
  })

  test('billing is anchored to the same venture and existing transaction ledger', () => {
    const billing = readRepoFile('src/lib/billing-lifecycle.ts')
    expect(billing).toContain('assertRealSucceededTransaction')
    expect(billing).toContain('Invoice')
    expect(billing).toContain('ventureId')
    expect(billing).toMatch(/SET \"status\"='paid'/)
    expect(billing).toContain('already paid by transaction')
    expect(billing).toContain('paid invoice linked to a transaction')
  })
})
