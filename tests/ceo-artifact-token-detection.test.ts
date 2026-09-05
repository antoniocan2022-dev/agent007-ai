import { describe, expect, test } from 'bun:test'
import { containsInternalArtifactToken } from '@/lib/ceo-behavioral-policy'

describe('Deep audit: content-level internal-artifact token detection', () => {
  test('governed_evolution_cycle is now detected, including with a trailing id suffix (e.g. as it actually appears in a persisted key)', () => {
    expect(containsInternalArtifactToken('The record governed_evolution_cycle_123 was found.')).toBe(true)
    expect(containsInternalArtifactToken('Category: governed_evolution_cycle')).toBe(true)
  })

  test('every existing known internal token is still detected after the boundary fix', () => {
    const tokens = ['continuous_loop_trace', 'evidence_trace', 'ceo_recommendation', 'ceo_conversation_incident', 'architecture_business_outcome', 'mission_telemetry']
    for (const token of tokens) expect(containsInternalArtifactToken(`Found ${token}_abc123 in the response.`)).toBe(true)
  })

  test('legitimate technical vocabulary is not falsely flagged -- confirmed this was a real risk with a broader shape-based pattern that was tried and reverted during this audit', () => {
    expect(containsInternalArtifactToken('Check the stack_trace for the error.')).toBe(false)
    expect(containsInternalArtifactToken('We are in a business cycle downturn.')).toBe(false)
    expect(containsInternalArtifactToken('Here are the action items from our quarterly review.')).toBe(false)
    expect(containsInternalArtifactToken('This audit trail shows the decision history.')).toBe(false)
  })
})
