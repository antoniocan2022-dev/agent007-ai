import { describe, expect, test } from 'bun:test'
import { resolveCeoLane, type CeoExecutionContract, type PreRouteDecision } from '../src/lib/ceo-cognitive-contract'

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

describe('resolveCeoLane', () => {
  test('a plain fast, tool-free conversational turn resolves to fast_chat', () => {
    expect(resolveCeoLane(baseDecision())).toBe('fast_chat')
  })

  test('a full-route turn resolves to deep_cognition when not mission-relevant and CEO-owned', () => {
    const decision = baseDecision({ route: 'full', executionContract: baseContract({ intent: 'analysis' }) })
    expect(resolveCeoLane(decision)).toBe('deep_cognition')
  })

  test('a fast-routed turn that still requires a tool is not truly fast_chat', () => {
    // Mirrors resolvePreRoute's own "fast route + toolRequired means not really fast" rule
    // (ceo-pre-router.ts) -- lane must not disagree with that established behavior.
    const decision = baseDecision({ executionContract: baseContract({ toolRequired: true }) })
    expect(resolveCeoLane(decision)).toBe('deep_cognition')
  })

  test('missionRelevant alone routes to durable_mission even on a fast route', () => {
    const decision = baseDecision({ missionRelevant: true })
    expect(resolveCeoLane(decision)).toBe('durable_mission')
  })

  test('an operational_orchestrator-owned turn routes to durable_mission even when missionRelevant is false', () => {
    // production_action/tool_action turns route to the operational orchestrator without necessarily
    // setting missionRelevant -- lane must treat both signals as "durable_mission", not just the one.
    const decision = baseDecision({
      route: 'full',
      missionRelevant: false,
      executionContract: baseContract({ intent: 'tool_action', orchestrationOwner: 'operational_orchestrator', toolRequired: true }),
    })
    expect(resolveCeoLane(decision)).toBe('durable_mission')
  })

  test('an ambiguous route with no mission/tool signal resolves to deep_cognition, not fast_chat', () => {
    const decision = baseDecision({ route: 'ambiguous' })
    expect(resolveCeoLane(decision)).toBe('deep_cognition')
  })
})
