import { describe, expect, test } from 'bun:test'
import { runVerificationOfficerChallenge, VERIFICATION_OFFICER_ID } from '@/lib/verification-officer'

const montrealSources = [
  { sourceId: 'tourisme-montreal', provider: 'Tourisme Montréal', sourceUrl: 'https://www.mtl.org/en/what-to-do/food/mon-lapin', retrievedAt: '2026-08-19T22:00:00.000Z' },
  { sourceId: 'michelin-guide', provider: 'MICHELIN Guide', sourceUrl: 'https://guide.michelin.com/ca/fr/quebec/montreal_2433514/restaurant/mon-lapin', retrievedAt: '2026-08-19T22:00:00.000Z' },
]

describe('Phase 5 — Verification Officer independent challenge', () => {
  test('passes a Montreal restaurant recommendation when critical facts are independently supported', () => {
    const result = runVerificationOfficerChallenge({ missionId: 'montreal-restaurant-test-2026-08-19', subject: 'Mon Lapin — Montreal restaurant recommendation', producerId: 'research_agent', requiredClaimKeys: ['address', 'cuisine_or_style'], sources: montrealSources, claims: [
      { claimKey: 'address', value: '150 Saint-Zotique Street East, Montreal', claimType: 'FACT', confidence: 0.98, sourceIds: ['tourisme-montreal', 'michelin-guide'], critical: true },
      { claimKey: 'cuisine_or_style', value: 'market-driven / modern cuisine restaurant', claimType: 'FACT', confidence: 0.93, sourceIds: ['tourisme-montreal', 'michelin-guide'], critical: true },
    ] })
    expect(result.officerId).toBe(VERIFICATION_OFFICER_ID)
    expect(result.decision).toBe('PASS')
    expect(result.findings).toEqual([])
    expect(result.challengedClaimKeys).toEqual([])
    expect(result.proofHash).toMatch(/^[a-f0-9]{64}$/)
  })

  test('challenges an unsupported real-time-style claim instead of treating recommendation as fully verified', () => {
    const result = runVerificationOfficerChallenge({ missionId: 'montreal-restaurant-test-2026-08-19-unsupported', subject: 'Mon Lapin — Montreal restaurant recommendation', producerId: 'research_agent', requiredClaimKeys: ['address', 'walk_in_table_guaranteed'], sources: montrealSources, claims: [
      { claimKey: 'address', value: '150 Saint-Zotique Street East, Montreal', claimType: 'FACT', confidence: 0.98, sourceIds: ['tourisme-montreal', 'michelin-guide'], critical: true },
      { claimKey: 'walk_in_table_guaranteed', value: 'yes', claimType: 'FACT', confidence: 0.99, sourceIds: [], critical: true },
    ] })
    expect(result.decision).toBe('CHALLENGE')
    expect(result.challengedClaimKeys).toContain('walk_in_table_guaranteed')
    expect(result.findings.map((finding) => finding.code)).toContain('UNSUPPORTED_CLAIM')
  })

  test('forbids self-verification by the Verification Officer', () => {
    const result = runVerificationOfficerChallenge({ missionId: 'self-verification-test', subject: 'self-check', producerId: VERIFICATION_OFFICER_ID, sources: montrealSources, claims: [{ claimKey: 'x', value: 'y', claimType: 'FACT', confidence: 1, sourceIds: ['tourisme-montreal'] }] })
    expect(result.decision).toBe('CHALLENGE')
    expect(result.findings.map((finding) => finding.code)).toContain('SELF_VERIFICATION')
  })

  test('rejects conflicting independent claims rather than selecting one silently', () => {
    const result = runVerificationOfficerChallenge({ missionId: 'conflict-test', subject: 'restaurant address conflict', producerId: 'research_agent', sources: montrealSources, claims: [
      { claimKey: 'address', value: '150 Saint-Zotique Street East, Montreal', claimType: 'FACT', confidence: 0.95, sourceIds: ['tourisme-montreal'], critical: true },
      { claimKey: 'address', value: '500 Wrong Street, Montreal', claimType: 'FACT', confidence: 0.95, sourceIds: ['michelin-guide'], critical: true },
    ] })
    expect(result.decision).toBe('CHALLENGE')
    expect(result.findings.map((finding) => finding.code)).toContain('CONFLICTING_CLAIMS')
  })

  test('does not allow a producer to manufacture critical independence with labels from one provider', () => {
    const result = runVerificationOfficerChallenge({ missionId: 'provider-independence-test', subject: 'single-provider independence spoof', producerId: 'research_agent', sources: [
      { sourceId: 'a', provider: 'SingleProvider', sourceUrl: 'https://example.test/a', retrievedAt: '2026-08-19T22:00:00.000Z', independentGroup: 'group-a' },
      { sourceId: 'b', provider: 'SingleProvider', sourceUrl: 'https://example.test/b', retrievedAt: '2026-08-19T22:01:00.000Z', independentGroup: 'group-b' },
    ], claims: [{ claimKey: 'critical_fact', value: 'true', claimType: 'FACT', confidence: 0.99, sourceIds: ['a', 'b'], critical: true }] })
    expect(result.decision).toBe('CHALLENGE')
    expect(result.findings.map((finding) => finding.code)).toContain('INSUFFICIENT_INDEPENDENCE')
  })
})
