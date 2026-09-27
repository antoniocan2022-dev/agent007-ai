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

  test('a fast-routed, non-mission financial taskClass turn keeps independent_review (not downgraded by the fast_chat override)', () => {
    // Deep-audit regression: this turn is `critical` in buildCeoDecisionPlan (taskClass 'financial')
    // and path stays 'critical', but before resolveCeoLane also excluded financial/security taskClass,
    // it still resolved to lane fast_chat and this reasoningStrategy got silently forced to 'direct' --
    // an internal contradiction with path/qualityTier/verificationRequired all still saying 'critical'.
    const decision = baseDecision({ taskClass: 'financial', executionContract: baseContract({ intent: 'opinion' }) })
    const plan = buildCeoDecisionPlan({ messages: [{ role: 'user', content: 'is investing in stocks a good idea?' }], preRoute: decision })
    expect(plan.path).toBe('critical')
    expect(plan.reasoningStrategy).toBe('independent_review')
  })

  test('an explicit missionId keeps independent_review even when the text-based preRoute never set missionRelevant', () => {
    // Fresh-audit regression (Stages 0-7): mission-supervisor.ts's CEO-leader dispatch and the
    // mission-active owner-question route both call runCeoCognitiveLifecycle with a real missionId
    // but no preRoute of their own -- one gets built fresh from the message text. That text (e.g. an
    // owner casually asking "what's the status?") can easily read as ordinary conversation, not
    // mission_action, so preRoute.missionRelevant can be false even though missionId is a mission
    // execution. `critical`'s own missionRelevant computation already ORs in Boolean(missionId); lane
    // must agree, or path/qualityTier stay 'critical' while reasoningStrategy gets silently forced to
    // 'direct' by the fast_chat override.
    const decision = baseDecision({ missionRelevant: false, executionContract: baseContract({ intent: 'conversation' }) })
    const plan = buildCeoDecisionPlan({ messages: [{ role: 'user', content: "what's the status?" }], preRoute: decision, missionId: 'mission_abc123' })
    expect(plan.path).toBe('critical')
    expect(plan.reasoningStrategy).toBe('independent_review')
  })
})
