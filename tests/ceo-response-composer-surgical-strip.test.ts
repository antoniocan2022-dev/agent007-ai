import { describe, expect, test } from 'bun:test'
import { composeCeoResponse } from '@/lib/ceo-response-composer'

const baseQuality = {
  decision: 'DEGRADED' as const,
  evidenceState: 'MEMORY_ONLY' as const,
  verificationStatus: 'NOT_PERFORMED' as const,
  checks: { nonEmpty: true, contractValid: true, objectiveCoverage: false, internalConsistency: true, evidenceDiscipline: true, actionableStructure: true },
  claimScopes: [] as string[],
  reasons: [] as string[],
}

describe('Deep audit: a third, independent artifact-sanitization mechanism, and a real quality fix within it', () => {
  test('governed_evolution_cycle is stripped from the final composed response, the same as continuous_loop_trace and ceo_recommendation', () => {
    const content = 'My read is that we can still move this forward. 1. [governed_evolution_cycle] governed_evolution_1788600000: {"schemaVersion":1,"cycleId":"governed_evolution_1788600000"}\n\nBased on that, here is my real recommendation.'
    const result = composeCeoResponse({ content, evidenceState: 'MEMORY_ONLY', quality: baseQuality, degraded: true, conversational: true })
    expect(result).not.toContain('governed_evolution_cycle')
  })

  test('the real bug this exposed: the surgical stripping pattern required the artifact to be the very first thing on its line, which never matches how these leaks actually appear -- appended after intro text on the same line, exactly as in the real live transcript. Confirmed fixed: legitimate content on both sides of the artifact now survives, instead of falling through to a broader pattern that discarded everything after it', () => {
    const content = 'My read is that we can still move this forward. 1. [governed_evolution_cycle] governed_evolution_1788600000: {"schemaVersion":1,"cycleId":"governed_evolution_1788600000"}\n\nBased on that, here is my real recommendation about your business strategy.'
    const result = composeCeoResponse({ content, evidenceState: 'MEMORY_ONLY', quality: baseQuality, degraded: true, conversational: true })
    expect(result).toContain('move this forward')
    expect(result).toContain('real recommendation about your business strategy')
    expect(result).not.toContain('governed_evolution_cycle')
  })

  test('the exact realistic scenario from the real transcript: three stacked artifacts of different categories are all stripped, while the meaningful closing content is fully preserved', () => {
    const content = `My read is that we can still move this forward using what we've already established. 1. [ceo_recommendation] ceo_recommendation_ceo_rec_1788467994650_c3vhdd: {"schemaVersion":1,"correlationId":"ceo_rec_1788467994650_c3vhdd","objective":"Should we move forward with that, or wait on the security review?"}

2. [continuous_loop_trace] continuous_loop:continuous_loop_f197822380657e470ad2afe0: {"schemaVersion":1,"loopId":"continuous_loop_f197822380657e470ad2afe0","currentStage":"PERCEIVE"}

3. [governed_evolution_cycle] governed_evolution_1788600000: {"schemaVersion":1,"cycleId":"governed_evolution_1788600000"}

Based on that, I'd focus on the underlying outcome, make the trade-off explicit, and choose the strongest practical next direction.`
    const result = composeCeoResponse({ content, evidenceState: 'MEMORY_ONLY', quality: baseQuality, degraded: true, conversational: true })
    expect(result).not.toMatch(/ceo_recommendation|continuous_loop_trace|governed_evolution_cycle|correlationId|loopId/)
    expect(result).toContain('strongest practical next direction')
  })
})
