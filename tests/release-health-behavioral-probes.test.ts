import { describe, expect, test } from 'bun:test'
import { verifyBehavioralProbes } from '@/lib/release-health-probes'

// Deep-audit recommendation: /api/release-health previously proved deployment identity and that the
// governed-provider runtime can execute a call at all ("Say OK"), but never that any SPECIFIC
// conversational behavior fixed by a real incident actually works on the deployed commit -- exactly the
// gap between "the pipes are connected" and "the water that comes out is correct" where #112-#115's real
// production bugs lived. These probes are pure, synchronous, no-network checks against the actual fixed
// functions, so a future regression in any of them fails the release gate immediately.
describe('release-health behavioral probes', () => {
  test('all probes pass on the current, correctly-fixed code', () => {
    const result = verifyBehavioralProbes()
    expect(result.verified).toBe(true)
    expect(result.probes).toHaveLength(6)
    for (const probe of result.probes) expect(probe.passed).toBe(true)
    expect(result.probes.map((probe) => probe.name)).toEqual([
      'ordinal-reference-markdown-list',
      'taskType-governance-capability-table',
      'half-open-candidate-selection',
      'ceo-lane-resolution',
      'provider-failure-taxonomy-bridge',
      'mission-auto-retry-classification',
    ])
  })

  test('the ordinal-reference probe specifically proves bold-markdown list resolution, not just any resolution', () => {
    const result = verifyBehavioralProbes()
    const probe = result.probes.find((item) => item.name === 'ordinal-reference-markdown-list')
    expect(probe?.passed).toBe(true)
    expect(probe?.detail).toContain('bold-formatted')
  })

  test('the governance probe specifically proves the creative capability split, not a vacuous check', () => {
    const result = verifyBehavioralProbes()
    const probe = result.probes.find((item) => item.name === 'taskType-governance-capability-table')
    expect(probe?.passed).toBe(true)
    expect(probe?.detail).toContain('creative-incapable and creative-capable')
  })

  test('the half-open probe specifically proves a real candidate is returned, not null or a throw', () => {
    const result = verifyBehavioralProbes()
    const probe = result.probes.find((item) => item.name === 'half-open-candidate-selection')
    expect(probe?.passed).toBe(true)
    expect(probe?.detail).toContain('real candidate')
  })

  // "Next architecture" program, Stage 7 additions below.

  test('the ceo-lane-resolution probe specifically proves the financial-taskClass fix, not just the three base lanes', () => {
    const result = verifyBehavioralProbes()
    const probe = result.probes.find((item) => item.name === 'ceo-lane-resolution')
    expect(probe?.passed).toBe(true)
    expect(probe?.detail).toContain('financial-taskClass exclusion')
  })

  test('the provider-failure-taxonomy-bridge probe specifically proves BILLING and TIMEOUT map correctly', () => {
    const result = verifyBehavioralProbes()
    const probe = result.probes.find((item) => item.name === 'provider-failure-taxonomy-bridge')
    expect(probe?.passed).toBe(true)
    expect(probe?.detail).toContain('BILLING and TIMEOUT')
  })

  test('the mission-auto-retry-classification probe specifically proves the retryable/fatal split', () => {
    const result = verifyBehavioralProbes()
    const probe = result.probes.find((item) => item.name === 'mission-auto-retry-classification')
    expect(probe?.passed).toBe(true)
    expect(probe?.detail).toContain('transient provider failures classify retryable')
  })
})
