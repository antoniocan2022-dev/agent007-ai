import { describe, expect, test } from 'bun:test'
import { buildCeoDecisionPlan } from '@/lib/ceo-cognitive-kernel'
import { preRouteCeoRequest, resolvePreRoute } from '@/lib/ceo-pre-router'

/**
 * Small permanent corpus of real owner-style requests.
 *
 * The purpose is behavioral regression coverage: these fixtures assert the
 * intended execution contract, not a particular model's wording. They are
 * deliberately free of credentials/network calls so CI can run them safely.
 */
const CASES = [
  {
    name: 'exact failing self-assessment',
    message: 'Hows it going? make a sekf analysis and tell me if you are ready to mange businesses?',
    intent: 'self_assessment',
    owner: 'ceo_lifecycle',
    route: 'fast',
    execution: 'llm_only',
    toolRequired: false,
    subagentsRequired: false,
    maxRecoveries: 0,
    path: 'fast',
  },
  {
    name: 'direct conversational status',
    message: 'How are you doing?',
    intent: 'conversation',
    owner: 'ceo_lifecycle',
    route: 'fast',
    execution: 'llm_only',
    toolRequired: false,
    subagentsRequired: false,
    maxRecoveries: 0,
    path: 'fast',
  },
  {
    name: 'non-operational deep analysis',
    message: 'Analyze the full architecture and identify the most important weaknesses.',
    intent: 'analysis',
    owner: 'ceo_lifecycle',
    route: 'full',
    execution: 'llm_only',
    toolRequired: false,
    subagentsRequired: false,
    maxRecoveries: 0,
    path: 'full',
  },
  {
    name: 'readiness question mentioning deployment',
    message: 'Are you ready to deploy?',
    intent: 'self_assessment',
    owner: 'ceo_lifecycle',
    route: 'fast',
    execution: 'llm_only',
    toolRequired: false,
    subagentsRequired: false,
    maxRecoveries: 0,
    path: 'fast',
  },
  {
    name: 'contextual continuation',
    message: 'Continue this.',
    intent: 'conversation',
    owner: 'ceo_lifecycle',
    route: 'ambiguous',
    execution: 'llm_only',
    toolRequired: false,
    subagentsRequired: false,
    maxRecoveries: 0,
    path: 'full',
  },
  {
    name: 'contextual verification follow-up',
    message: 'Also, can you check that again?',
    intent: 'conversation',
    owner: 'ceo_lifecycle',
    route: 'ambiguous',
    execution: 'llm_only',
    toolRequired: false,
    subagentsRequired: false,
    maxRecoveries: 0,
    path: 'full',
  },
  {
    name: 'web research request',
    message: 'Research the latest competitors in the AI executive software market.',
    intent: 'research',
    owner: 'operational_orchestrator',
    route: 'full',
    execution: 'one_tool',
    toolRequired: true,
    subagentsRequired: false,
    maxRecoveries: 1,
    path: 'full',
  },
  {
    name: 'production action request',
    message: 'Deploy the approved release to production.',
    intent: 'production_action',
    owner: 'operational_orchestrator',
    route: 'full',
    execution: 'production',
    toolRequired: true,
    subagentsRequired: false,
    maxRecoveries: 1,
    path: 'full',
  },
  {
    name: 'mission action request',
    message: 'Run the autonomous venture mission for our revenue operation.',
    intent: 'mission_action',
    owner: 'operational_orchestrator',
    route: 'full',
    execution: 'mission',
    toolRequired: true,
    subagentsRequired: true,
    maxRecoveries: 2,
    path: 'critical',
  },
] as const

describe('CEO real-request regression corpus', () => {
  test('preserves the expected execution contract for every fixture', () => {
    for (const fixture of CASES) {
      const decision = preRouteCeoRequest([{ role: 'user', content: fixture.message }])
      expect(decision.executionContract.intent, fixture.name).toBe(fixture.intent)
      expect(decision.executionContract.orchestrationOwner, fixture.name).toBe(fixture.owner)
      expect(decision.route, fixture.name).toBe(fixture.route)
      expect(decision.executionContract.executionRequirement, fixture.name).toBe(fixture.execution)
      expect(decision.executionContract.toolRequired, fixture.name).toBe(fixture.toolRequired)
      expect(decision.executionContract.subagentsRequired, fixture.name).toBe(fixture.subagentsRequired)
      expect(decision.executionContract.maxRecoveries, fixture.name).toBe(fixture.maxRecoveries)
      expect(resolvePreRoute(decision), fixture.name).toBe(fixture.route === 'ambiguous' ? 'full' : fixture.route)

      const plan = buildCeoDecisionPlan({
        messages: [{ role: 'user', content: fixture.message }],
        preRoute: decision,
      })
      expect(plan.executionContract.orchestrationOwner, fixture.name).toBe(fixture.owner)
      expect(plan.path, fixture.name).toBe(fixture.path)
    }
  })

  test('does not route reflective wording into operational ownership', () => {
    const reflective = [
      'Tell me honestly whether you are ready to manage a business.',
      'Review your own weaknesses and tell me what is missing.',
      'Analyze your current performance and readiness.',
    ]

    for (const message of reflective) {
      const decision = preRouteCeoRequest([{ role: 'user', content: message }])
      expect(decision.executionContract.orchestrationOwner).toBe('ceo_lifecycle')
      expect(decision.executionContract.toolRequired).toBe(false)
      expect(decision.executionContract.subagentsRequired).toBe(false)
    }
  })
})
