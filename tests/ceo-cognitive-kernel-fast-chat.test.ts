import { describe, expect, test } from 'bun:test'
import { buildCeoDecisionPlan } from '../src/lib/ceo-cognitive-kernel'
import type { CeoExecutionContract, PreRouteDecision } from '../src/lib/ceo-cognitive-contract'

function baseContract(overrides: Partial<CeoExecutionContract> = {}): CeoExecutionContract {
  return {
    intent: 'conversation',
    evidenceClass: 'none',
    domain: 'none',
    operation: 'none',
    temporalScope: 'none',
    evidenceProfile: 'none',
    evidenceRequirement: 'none',
    executionRequirement: 'llm_only',
    orchestrationOwner: 'ceo_lifecycle',
    maxTurns: 1,
    maxRecoveries: 0,
    latencyBudgetMs: 15000,
    toolRequired: false,
    subagentsRequired: false,
    reason: 'test fixture',
    ...overrides,
  }
}

function baseDecision(overrides: Partial<PreRouteDecision> = {}): PreRouteDecision {
  return {
    route: 'fast',
    reason: 'test fixture',
    missionRelevant: false,
    complexitySignals: 0,
    executionContract: baseContract(),
    ...overrides,
  }
}

describe('buildCeoDecisionPlan: fast_chat lane forces direct reasoning', () => {
  test('a plain fast conversational turn gets reasoningStrategy direct (unchanged baseline)', () => {
    const plan = buildCeoDecisionPlan({ messages: [{ role: 'user', content: 'hi' }], preRoute: baseDecision() })
    expect(plan.reasoningStrategy).toBe('direct')
    expect(plan.path).toBe('fast')
  })

  test('adaptiveExecutionClass "deep" on an otherwise fast_chat turn no longer upgrades to multi_pass', () => {
    // Before Stage 2: route==='fast' + adaptiveExecutionClass==='deep' made `deep` true internally,
    // which upgraded reasoningStrategy to 'multi_pass' (an extra LLM call) even though this turn
    // resolves to the fast_chat lane (route 'fast', no tool, no mission, ceo_lifecycle-owned) --
    // exactly the gap Stage 2 closes.
    const decision = baseDecision({ adaptiveExecutionClass: 'deep', executionContract: baseContract({ intent: 'analysis' }) })
    const plan = buildCeoDecisionPlan({ messages: [{ role: 'user', content: 'quick take?' }], preRoute: decision })
    expect(plan.reasoningStrategy).toBe('direct')
  })

  test('the same adaptiveExecutionClass "deep" signal still upgrades a non-fast_chat (full-route) turn to multi_pass', () => {
    // Confirms the override is scoped to fast_chat only -- a genuinely full-route turn keeps its
    // existing multi_pass upgrade unchanged.
    const decision = baseDecision({ route: 'full', adaptiveExecutionClass: 'deep', executionContract: baseContract({ intent: 'analysis' }) })
    const plan = buildCeoDecisionPlan({ messages: [{ role: 'user', content: 'give me a deep analysis' }], preRoute: decision })
    expect(plan.reasoningStrategy).toBe('multi_pass')
  })

  test('a durable_mission turn keeps its independent_review reasoning strategy unchanged', () => {
    const decision = baseDecision({ missionRelevant: true, executionContract: baseContract({ intent: 'mission_action', orchestrationOwner: 'operational_orchestrator', toolRequired: true }) })
    const plan = buildCeoDecisionPlan({ messages: [{ role: 'user', content: 'run the mission' }], preRoute: decision })
    expect(plan.reasoningStrategy).toBe('independent_review')
  })
})
