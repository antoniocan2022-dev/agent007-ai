import { describe, expect, test, beforeEach } from 'bun:test'
import { recordToolOutcome, getToolOutcomeSnapshot, clearToolOutcomeIntelligenceForTests } from '@/lib/ceo-tool-outcome-intelligence'
import { selectCeoTool } from '@/lib/ceo-tool-selection'

beforeEach(() => clearToolOutcomeIntelligenceForTests())

const contract = {
  intent: 'research', evidenceClass: 'external_web', domain: 'general_web', operation: 'research', temporalScope: 'current',
  evidenceProfile: 'general_research', evidenceRequirement: 'external_web', executionRequirement: 'one_tool',
  orchestrationOwner: 'ceo_lifecycle', maxTurns: 4, maxRecoveries: 1, latencyBudgetMs: 30000, toolRequired: true, subagentsRequired: false, reason: 'test',
} as any

describe('Phase 17 tool outcome learning', () => {
  test('a tool with no observation history gets zero adjustment -- no cold-start penalty', () => {
    const snapshot = getToolOutcomeSnapshot('web_search', 'research')
    expect(snapshot.observations).toBe(0)
    expect(snapshot.reliabilityAdjustment).toBe(0)
  })

  test('real recorded successes produce a positive, bounded adjustment; real failures produce a negative one', () => {
    for (let i = 0; i < 10; i++) recordToolOutcome({ toolId: 'web_search', capability: 'research', status: 'succeeded' })
    const good = getToolOutcomeSnapshot('web_search', 'research')
    expect(good.reliabilityAdjustment).toBeGreaterThan(0)
    expect(good.reliabilityAdjustment).toBeLessThanOrEqual(0.1)

    for (let i = 0; i < 10; i++) recordToolOutcome({ toolId: 'page_reader', capability: 'research', status: 'failed' })
    const bad = getToolOutcomeSnapshot('page_reader', 'research')
    expect(bad.reliabilityAdjustment).toBeLessThan(0)
    expect(bad.reliabilityAdjustment).toBeGreaterThanOrEqual(-0.1)
  })

  test('real, recorded outcomes genuinely move tool selection scores, not merely computed and ignored', () => {
    const before = selectCeoTool(contract, { requiresFreshness: true })
    const baselineReliability = before.scores.web_search?.reliability
    for (let i = 0; i < 15; i++) recordToolOutcome({ toolId: 'web_search', capability: before.capability, status: 'failed' })
    const after = selectCeoTool(contract, { requiresFreshness: true })
    expect(after.scores.web_search?.reliability).toBeLessThan(baselineReliability!)
  })
})
