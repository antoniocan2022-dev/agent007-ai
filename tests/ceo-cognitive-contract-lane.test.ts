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

  test('a fast-routed, non-mission financial taskClass turn resolves to deep_cognition, not fast_chat', () => {
    // Deep-audit regression: buildCeoDecisionPlan's `critical` gate (ceo-cognitive-kernel.ts) treats
    // taskClass 'financial'/'security' as needing the independent_review path even when not
    // mission-relevant -- lane must agree, or a fast_chat-lane turn can end up with path 'critical'
    // but reasoningStrategy silently forced to 'direct'.
    const decision = baseDecision({ taskClass: 'financial' })
    expect(resolveCeoLane(decision)).toBe('deep_cognition')
  })

  test('a fast-routed, non-mission security taskClass turn resolves to deep_cognition, not fast_chat', () => {
    const decision = baseDecision({ taskClass: 'security' })
    expect(resolveCeoLane(decision)).toBe('deep_cognition')
  })

  test('an explicit missionId routes to durable_mission even when the text-based preRoute never set missionRelevant', () => {
    // Fresh-audit regression (Stages 0-7): buildCeoDecisionPlan's `critical`/`missionRelevant`
    // computation is `input.preRoute.missionRelevant || Boolean(input.missionId)` -- an explicit
    // mission-execution caller (mission-supervisor.ts's CEO-leader dispatch, the mission-active
    // owner-question route) is trusted unconditionally, independent of whether preRouteCeoRequest's
    // text classifier happened to read the message content as mission-relevant. resolveCeoLane must
    // agree, or a mission-tied turn whose phrasing reads as ordinary conversation (e.g. an owner
    // asking "what's the status?") gets critical=true/qualityTier='critical' from the kernel but
    // lane falls through to fast_chat, which then silently downgrades reasoningStrategy to 'direct'.
    const decision = baseDecision({ missionRelevant: false })
    expect(resolveCeoLane(decision, 'mission_abc123')).toBe('durable_mission')
  })

  test('no missionId and no other mission signal still resolves to fast_chat (missionId does not force every turn deep)', () => {
    expect(resolveCeoLane(baseDecision(), undefined)).toBe('fast_chat')
  })
})
