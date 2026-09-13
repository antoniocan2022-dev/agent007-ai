import { describe, expect, test } from 'bun:test'
import { buildVerifyOverclaimConstraint } from '@/lib/ceo-cognitive-lifecycle'

// Deep-audit fix (2026-09-13): 'verify' had no anti-overclaim guardrail symmetric to 'execute''s
// operatorConstraint, despite carrying the same 'required' evidence tier. Extracted as a pure function
// specifically so this is directly unit-testable.
describe('buildVerifyOverclaimConstraint', () => {
  test('returns no constraint for a non-verify response action', () => {
    expect(buildVerifyOverclaimConstraint('answer', false, undefined)).toBe('')
    expect(buildVerifyOverclaimConstraint('execute', false, undefined)).toBe('')
    expect(buildVerifyOverclaimConstraint(undefined, false, undefined)).toBe('')
  })

  test('returns no constraint for verify when real evidence was provided', () => {
    expect(buildVerifyOverclaimConstraint('verify', true, undefined)).toBe('')
  })

  test('returns no constraint for verify when a real, non-none evidence scope is available', () => {
    expect(buildVerifyOverclaimConstraint('verify', false, 'live_system')).toBe('')
    expect(buildVerifyOverclaimConstraint('verify', false, 'internal_state')).toBe('')
    expect(buildVerifyOverclaimConstraint('verify', false, 'external_web')).toBe('')
  })

  test('returns the anti-overclaim constraint for verify with no evidence and no scope (or scope "none")', () => {
    const noScope = buildVerifyOverclaimConstraint('verify', false, undefined)
    expect(noScope).toContain('Do not say or imply that something has been verified, confirmed, or checked')
    const explicitNone = buildVerifyOverclaimConstraint('verify', false, 'none')
    expect(explicitNone).toContain('Do not say or imply that something has been verified, confirmed, or checked')
  })
})
