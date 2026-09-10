import { describe, expect, test } from 'bun:test'
import { verifyBehavioralProbes } from '@/lib/release-health-probes'

// Deep-audit recommendation: /api/release-health previously proved deployment identity and that the
// governed-provider runtime can execute a call at all ("Say OK"), but never that any SPECIFIC
// conversational behavior fixed by a real incident actually works on the deployed commit -- exactly the
// gap between "the pipes are connected" and "the water that comes out is correct" where #112-#115's real
// production bugs lived. These probes are pure, synchronous, no-network checks against the actual fixed
// functions, so a future regression in any of them fails the release gate immediately.
describe('release-health behavioral probes', () => {
  test('all three probes pass on the current, correctly-fixed code', () => {
    const result = verifyBehavioralProbes()
    expect(result.verified).toBe(true)
    expect(result.probes).toHaveLength(3)
    for (const probe of result.probes) expect(probe.passed).toBe(true)
    expect(result.probes.map((probe) => probe.name)).toEqual([
      'ordinal-reference-markdown-list',
      'taskType-governance-capability-table',
      'half-open-candidate-selection',
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
})
