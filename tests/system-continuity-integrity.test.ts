import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractVentureId, resolveVentureId, formatCeoVentureEvidence } from '../src/lib/ceo-venture-state'
import { validateTransactionEvidence } from '../src/lib/transaction-evidence-integrity'

const root = join(import.meta.dir, '..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('system continuity and commercial evidence integrity', () => {
  test('CEO resolves venture-specific requests through one read-only bridge', () => {
    expect(extractVentureId('How is Venture 001 doing?')).toBe('venture_001')
    expect(extractVentureId('How is Venture_001 doing?')).toBe('venture_001')
    expect(extractVentureId('How is venture-001 doing?')).toBe('venture_001')
    expect(extractVentureId('How is the portfolio doing?')).toBeNull()
    const source = read('src/lib/ceo-cognitive-lifecycle.ts')
    expect(source).toContain("getCeoVentureEvidenceForObjective(objective)")
    expect(source).toContain('LIVE VENTURE STATE (READ ONLY)')
    expect(source).toContain('Do not invent missing values')
  })

  // Production incident (2026-09-21): route.ts's grounding-fetch (getExecutiveBusinessState) read
  // path defaulted an unmatched extractVentureId() to 'venture_001', but its recordCeoRecommendation
  // write call site left the extraction unfallback'd -- so a real recommend/decide turn that never
  // literally spelled out "venture_001" wrote ventureId: null and became permanently invisible to
  // every venture-scoped read of the same ledger, while an unscoped read (strategic horizon) still
  // saw it. The same self-assessment turn showed "Executive decisions: none recorded" in one
  // section and "N recorded" in another for the identical underlying data. resolveVentureId() is
  // now the one place both read and write call sites resolve "the venture this turn concerns," so
  // the two can no longer drift apart.
  test('resolveVentureId defaults an unmatched turn to the canonical reference venture, matching extractVentureId when one is present', () => {
    expect(resolveVentureId('How is the portfolio doing?')).toBe('venture_001')
    expect(resolveVentureId('Approve the marketing budget for this quarter.')).toBe('venture_001')
    expect(resolveVentureId('How is Venture 002 doing?')).toBe('venture_002')
    expect(resolveVentureId('venture-003 requires attention')).toBe('venture_003')
    for (const message of ['How is the portfolio doing?', 'How is Venture 002 doing?', 'Review venture_005 performance.']) {
      expect(resolveVentureId(message)).toBe(extractVentureId(message) ?? 'venture_001')
    }
  })

  test('route.ts resolves ventureId identically at its recommendation read and write call sites', () => {
    const source = read('src/app/api/agent/route.ts')
    expect(source).not.toMatch(/import\s*\{[^}]*\bextractVentureId\b[^}]*\}\s*from\s*['"]@\/lib\/ceo-venture-state['"]/)
    expect(source).toMatch(/import\s*\{[^}]*\bresolveVentureId\b[^}]*\}\s*from\s*['"]@\/lib\/ceo-venture-state['"]/)
    const ventureIdCalls = [...source.matchAll(/resolveVentureId\(message\)/g)]
    expect(ventureIdCalls.length).toBeGreaterThanOrEqual(2)
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

  test('KPI and template proof paths fail closed instead of using legacy synthetic mission/revenue state', () => {
    const kpi = read('src/lib/operational-kpi-engine.ts')
    const template = read('src/lib/venture-template-validation.ts')
    expect(kpi).toContain('Fail closed')
    expect(kpi).not.toContain("r.category === 'venture_mission'")
    expect(kpi).toContain('assertRealSucceededTransaction')
    expect(template).toContain('assertRealSucceededTransaction')
    expect(template).toContain('transactionOutcomeKeys')
  })

  test('continuity map documents canonical sources and anti-duplication rules', () => {
    const map = read('docs/ARCHITECTURE-CONTINUITY-MAP.md')
    expect(map).toContain('source-of-truth')
    expect(map).toContain('Anti-duplication rules')
    expect(map).toContain('do not create a second CRM, payment ledger, portfolio source, or Venture identity model')
    expect(map).toContain('CEO Venture State Bridge')
  })
})
