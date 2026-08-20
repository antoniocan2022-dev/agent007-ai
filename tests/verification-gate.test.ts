import { describe, expect, test } from 'bun:test'
import { assertVerificationPass, runVerificationOfficerChallenge } from '@/lib/verification-officer'

describe('Phase 4/5 — independent verification hard gate', () => {
  test('allows only PASS results through the gate', () => {
    const result = runVerificationOfficerChallenge({
      missionId: 'gate-pass',
      subject: 'verified fact',
      producerId: 'research-agent',
      sources: [
        { sourceId: 'a', provider: 'Provider A', sourceUrl: 'https://a.example/fact', retrievedAt: '2026-08-20T00:00:00.000Z' },
        { sourceId: 'b', provider: 'Provider B', sourceUrl: 'https://b.example/fact', retrievedAt: '2026-08-20T00:00:01.000Z' },
      ],
      claims: [{ claimKey: 'fact', value: 'true', claimType: 'FACT', confidence: 0.99, sourceIds: ['a', 'b'], critical: true }],
      requiredClaimKeys: ['fact'],
    })
    expect(result.decision).toBe('PASS')
    expect(() => assertVerificationPass(result)).not.toThrow()
  })

  test('blocks challenged evidence instead of allowing a producer result to pass', () => {
    const result = runVerificationOfficerChallenge({
      missionId: 'gate-block',
      subject: 'unsupported fact',
      producerId: 'research-agent',
      sources: [],
      claims: [{ claimKey: 'fact', value: 'unknown', claimType: 'FACT', confidence: 0.99, sourceIds: [], critical: true }],
      requiredClaimKeys: ['fact'],
    })
    expect(result.decision).toBe('CHALLENGE')
    expect(() => assertVerificationPass(result)).toThrow('VERIFICATION_GATE_BLOCKED')
  })
})
