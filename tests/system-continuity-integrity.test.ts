import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractVentureId, formatCeoVentureEvidence } from '../src/lib/ceo-venture-state'
import { validateTransactionEvidence } from '../src/lib/transaction-evidence-integrity'

const root = join(import.meta.dir, '..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('system continuity and commercial evidence integrity', () => {
  test('CEO resolves venture-specific requests through one read-only bridge', () => {
    expect(extractVentureId('How is Venture 001 doing?')).toBe('venture_001')
    expect(extractVentureId('How is the portfolio doing?')).toBeNull()
    const source = read('src/lib/ceo-cognitive-lifecycle.ts')
    expect(source).toContain("getCeoVentureEvidenceForObjective(objective)")
    expect(source).toContain('LIVE VENTURE STATE (READ ONLY)')
    expect(source).toContain('Do not invent missing values')
  })

  test('CEO evidence formatter labels provenance and refuses implied readiness', () => {
    const evidence = formatCeoVentureEvidence({
      ventureId: 'venture_001',
      venture: { name: 'Test', status: 'PROPOSED', productionState: 'STRUCTURAL_ONLY', ownerUserId: 'owner' } as any,
      commercial: null,
      kpi: null,
      operationCheckpoint: null,
    })
    expect(evidence).toContain('SOURCE: Agent007 live Venture OS read path')
    expect(evidence).toContain('Missing values must remain unknown')
  })

  test('transaction evidence validator blocks unsupported monetary claims', () => {
    expect(validateTransactionEvidence({ ventureId: '', transactionId: '' })).toHaveLength(2)
    expect(validateTransactionEvidence({ ventureId: 'venture_001', transactionId: 'tx_1', amount: 0 })).toContain('amount must be positive and finite when supplied.')
    expect(validateTransactionEvidence({ ventureId: 'venture_001', transactionId: 'tx_1', currency: 'US' })).toContain('currency must be an ISO-4217 alpha-3 code when supplied.')
    expect(validateTransactionEvidence({ ventureId: 'venture_001', transactionId: 'tx_1', amount: 25, currency: 'USD' })).toEqual([])
  })

  test('commercial and mission-to-money paths use the relational transaction evidence boundary', () => {
    const commercial = read('src/lib/commercial-control-plane-runtime.ts')
    const missionMoney = read('src/lib/mission-money-bridge.ts')
    expect(commercial).toContain("import { assertRealSucceededTransaction } from './transaction-evidence-integrity'")
    expect(commercial).toContain('assertRealSucceededTransaction({ ventureId, transactionId, amount, currency })')
    expect(missionMoney).toContain("import { assertRealSucceededTransaction } from './transaction-evidence-integrity'")
    expect(missionMoney).toContain('const transaction = await assertRealSucceededTransaction({ ventureId, transactionId })')
  })

  test('continuity map documents canonical sources and anti-duplication rules', () => {
    const map = read('docs/ARCHITECTURE-CONTINUITY-MAP.md')
    expect(map).toContain('source-of-truth')
    expect(map).toContain('Anti-duplication rules')
    expect(map).toContain('do not create a second CRM, payment ledger, portfolio source, or Venture identity model')
    expect(map).toContain('CEO Venture State Bridge')
  })
})
