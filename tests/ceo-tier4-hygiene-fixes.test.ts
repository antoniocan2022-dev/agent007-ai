import { describe, expect, test } from 'bun:test'
import { classifyCeoSelfReflection } from '@/lib/ceo-self-reflection'
import { buildCeoDecisionPlan } from '@/lib/ceo-cognitive-kernel'
import { preRouteCeoRequest } from '@/lib/ceo-pre-router'
import { classifyExecution } from '@/lib/adaptive-execution'
import { scoreContextContinuity } from '@/lib/ceo-context-intelligence'
import { containsContextualReference } from '@/lib/ceo-conversational-signals'

const user = (content: string) => [{ role: 'user' as const, content }]

// Deep-audit Tier 4 (2026-09-13), item #24: EXPLICIT_SELF_ASSESSMENT_RE's match was never exempted from
// the operational/research/analysis-precedence block, so an explicit self-assessment request whose
// phrasing also happened to trip ANALYSIS_TARGET_RE fell through to 'none' instead of the readiness
// assessment it explicitly asked for.
describe('CEO self-reflection: explicit self-assessment phrase wins over operational precedence', () => {
  test.each([
    'Do a self-assessment and review the architecture.',
    'I want a self-evaluation, please review the system and tell me where it stands.',
  ])('classifies as readiness_assessment despite also matching operational-precedence language: %s', (text) => {
    const result = classifyCeoSelfReflection(text)
    expect(result.kind).toBe('readiness_assessment')
    expect(result.isSelfReflective).toBe(true)
  })
})

// Deep-audit Tier 4, item #21: maxEscalations only granted a fast-path retry budget to
// conversation/opinion intent, so a plain decision/analysis request that stayed on the fast path got 0
// escalations while casual chat got 1 -- backwards, since a decision's failure modes are exactly what
// the escalation loop exists to repair.
describe('CEO decision plan: fast-path escalation budget is not inverted', () => {
  test('a plain decision that stays on the fast path gets the same escalation budget as casual conversation', () => {
    const decisionText = 'Should we prioritize the checkout redesign or the onboarding flow first?'
    const decision = preRouteCeoRequest(user(decisionText))
    expect(decision.route).toBe('fast')
    const plan = buildCeoDecisionPlan({ messages: user(decisionText), preRoute: decision })
    expect(plan.path).toBe('fast')
    expect(plan.maxEscalations).toBe(1)
  })

  test('casual conversation on the fast path is unaffected (still 1)', () => {
    const decision = preRouteCeoRequest(user('How are you doing today?'))
    const plan = buildCeoDecisionPlan({ messages: user('How are you doing today?'), preRoute: decision })
    expect(plan.maxEscalations).toBe(1)
  })

  test('self-assessment stays at 0 (unaffected by this fix)', () => {
    const text = 'Give me a self-assessment of your capabilities.'
    const decision = preRouteCeoRequest(user(text))
    const plan = buildCeoDecisionPlan({ messages: user(text), preRoute: decision })
    expect(plan.maxEscalations).toBe(0)
  })
})

// Deep-audit Tier 4, item #23: CONTEXT_RE (ceo-pre-router.ts), CONTEXT_DEPENDENT_RE
// (adaptive-execution.ts), and containsAnaphora (ceo-context-intelligence.ts) were three drifted copies
// of the same "contains a context-dependent reference" concept -- two were missing itself/themself, one
// was missing more/also. Now consolidated behind the canonical containsContextualReference.
describe('canonical context-dependent-reference detection stays consistent across call sites', () => {
  test('the canonical detector recognizes itself/themself and more/also alike', () => {
    expect(containsContextualReference('The system corrected itself.')).toBe(true)
    expect(containsContextualReference('The agents organized themself.')).toBe(true)
    expect(containsContextualReference('Tell me more about that.')).toBe(true)
    expect(containsContextualReference('Also, what about the budget?')).toBe(true)
  })

  test('ceo-pre-router.ts now routes a bare "itself" reference as context-dependent', () => {
    const decision = preRouteCeoRequest(user('Explain how the deployment pipeline corrected itself.'))
    expect(decision.route).toBe('ambiguous')
  })

  test('adaptive-execution.ts now classifies a bare "itself" reference as context-dependent standard, not the plain fast/deep default', () => {
    const plan = classifyExecution(user('Walk me through how the process fixed itself.'))
    expect(plan.executionClass).toBe('standard')
    expect(plan.reason).toContain('context-dependent')
  })

  test('ceo-context-intelligence.ts now detects anaphora on "more"/"also", not just itself/themself', () => {
    const score = scoreContextContinuity({
      currentUserMessage: 'Can you tell me more about that?',
      response: 'Sure, here is more detail.',
      priorTurns: [{ role: 'user', content: 'What is our runway?', createdAt: new Date().toISOString() } as any],
    })
    expect(score.anaphoraDetected).toBe(true)
  })
})
