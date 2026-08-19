import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync } from 'node:fs'
import { authorityLevelFor, hierarchyRoute, canTransitionMission, validateBusinessOutcome, assertVentureActionAllowed } from '@/lib/architecture-control-plane'
import { VENTURE_TEMPLATE_V1, canAdvanceCommercial, canAdvanceBookStage } from '@/lib/venture-autonomy-control'
import { runVerificationOfficerChallenge } from '@/lib/verification-officer'
import { canonicalJson, sha256 } from '@/lib/proof-ledger'

describe('Five-phase integrity contract', () => {
  test('Phase 1 proof primitives remain deterministic and canonical', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')
    expect(sha256({ b: 2, a: 1 })).toBe(sha256({ a: 1, b: 2 }))
    expect(sha256({ a: 1 })).not.toBe(sha256({ a: 2 }))
  })

  test('Phase 2 evidence infrastructure has one canonical proof ledger and no accidental duplicate phase files', () => {
    expect(existsSync('src/lib/proof-ledger.ts')).toBe(true)
    expect(existsSync('src/lib/verification-officer.ts')).toBe(true)
    expect(existsSync('src/lib/phase3-operations-kit.ts')).toBe(false)
    expect(existsSync('src/lib/phase4-career-command.ts')).toBe(false)
    const files = readdirSync('src/lib')
    const normalized = new Map<string, string[]>()
    for (const file of files) { const key = file.toLowerCase(); normalized.set(key, [...(normalized.get(key) ?? []), file]) }
    expect([...normalized.values()].filter((names) => names.length > 1)).toEqual([])
  })

  test('Phase 3 organizational execution preserves governed hierarchy and mission state', () => {
    expect(authorityLevelFor('agent007')).toBe('CEO')
    expect(authorityLevelFor('vid')).toBe('VID')
    expect(authorityLevelFor('pulse')).toBe('LEADER')
    expect(authorityLevelFor('quill')).toBe('SPECIALIST')
    expect(hierarchyRoute('agent007', 'pulse')).toEqual({ routed: true, immediateOwner: 'vid' })
    expect(canTransitionMission('PLANNED', 'IN_PROGRESS')).toBe(true)
    expect(canTransitionMission('COMPLETED', 'IN_PROGRESS')).toBe(false)
    expect(validateBusinessOutcome({ ventureId: 'venture_001', missionId: 'm1', type: 'REVENUE_RECOGNIZED', transactionId: 'txn_1', customerId: null, amount: 25, currency: 'USD', source: 'provider:test', occurredAt: new Date().toISOString(), metadata: {} })).toEqual([])
  })

  test('Phase 4 governance retains explicit forbidden and owner-approval boundaries', async () => {
    expect(VENTURE_TEMPLATE_V1.safety.forbiddenActions).toContain('transfer_funds')
    expect(VENTURE_TEMPLATE_V1.safety.ownerApprovalActions).toContain('production_deploy')
    await expect(assertVentureActionAllowed('venture_001', 'transfer_funds')).rejects.toThrow()
    expect(canAdvanceBookStage('PUBLISHED', 'BRIEF')).toBe(false)
    expect(canAdvanceCommercial('REFUNDED', 'PAID')).toBe(false)
  })

  test('Phase 5 independently challenges same-provider critical claims', () => {
    const result = runVerificationOfficerChallenge({
      missionId: 'five-phase-integrity', subject: 'Montreal restaurant evidence', producerId: 'research_agent', requiredClaimKeys: ['address'],
      sources: [
        { sourceId: 'a', provider: 'ProviderA', sourceUrl: 'https://example.test/a', retrievedAt: '2026-08-19T22:00:00.000Z', independentGroup: 'group-1' },
        { sourceId: 'b', provider: 'ProviderA', sourceUrl: 'https://example.test/b', retrievedAt: '2026-08-19T22:01:00.000Z', independentGroup: 'group-2' },
      ],
      claims: [{ claimKey: 'address', value: '150 Saint-Zotique Street East, Montreal', claimType: 'FACT', confidence: 0.99, sourceIds: ['a', 'b'], critical: true }],
    })
    expect(result.decision).toBe('CHALLENGE')
    expect(result.findings.map((finding) => finding.code)).toContain('INSUFFICIENT_INDEPENDENCE')
  })
})
