import { describe, expect, test } from 'bun:test'
import { buildCanonicalConversationContext } from '@/lib/ceo-cognitive-conversation'
import { buildConversationDecisionContract } from '@/lib/ceo-conversation-decision-contract'
import { deriveCeoConversationState } from '@/lib/ceo-conversation-state'
import { isGovernedSoftPassEligible } from '@/lib/ceo-soft-pass-policy'
import { semanticAssistanceRequired } from '@/lib/ceo-semantic-interpreter'
import type { PersistedConversationRow } from '@/lib/ceo-context-composer'

function row(role: 'user' | 'assistant', content: string, createdAt = Date.now()): PersistedConversationRow { return { role, content, createdAt } }
function context(message: string, rows: PersistedConversationRow[] = []): ReturnType<typeof buildCanonicalConversationContext> {
  const state = deriveCeoConversationState(rows, message)
  return buildCanonicalConversationContext({ currentMessage: message, rows, state, references: [] })
}

const ROUTE_SOURCE = await Bun.file(new URL('../src/app/api/agent/route.ts', import.meta.url)).text()
const LIFECYCLE_SOURCE = await Bun.file(new URL('../src/lib/ceo-cognitive-lifecycle.ts', import.meta.url)).text()

describe('CEO Phases 1-3 architecture contracts', () => {
  test('route performs exactly one direct pre-route call and passes the same decision into lifecycle', () => {
    expect((ROUTE_SOURCE.match(/preRouteCeoRequest\(/g) ?? []).length).toBe(1)
    expect(ROUTE_SOURCE).toContain('preRoute, contextSeed.canonicalSemanticContext')
    expect(ROUTE_SOURCE).toContain('preRoute, decisionContract'))
    expect(LIFECYCLE_SOURCE).toContain('request.preRoute ?? preRouteCeoRequest')
  })

  test('canonical semantic context contains structured meaning, confidence and uncertainty', () => {
    const value = context('Can you explain this again?')
    expect(value.meaning.length).toBeGreaterThan(0)
    expect(value.semanticInterpretation.confidence).toBeGreaterThan(0)
    expect(Array.isArray(value.semanticInterpretation.uncertainty)).toBe(true)
  })

  test('explicit corrections remain corrections even when correction text contains ordinal language', () => {
    const value = context('No, I meant routing as the first engineering priority.')
    expect(value.speechAct).toBe('correction')
    expect(value.intentHint).toBe('conversation')
    expect(buildConversationDecisionContract(value).responseAction).toBe('answer')
  })

  test('decision contract exposes all Phase 3 response actions', () => {
    const cases: Array<[string, string]> = [
      ['Should we prioritize routing?', 'recommend'],
      ['Decide between option one and option two.', 'decide'],
      ['Please execute the approved change.', 'execute'],
      ['Can you verify whether the current state is correct?', 'verify'],
      ['Explain why this architecture is stronger.', 'explain'],
      ['I think option A is right; push back on my assumption.', 'challenge'],
    ]
    for (const [message, expected] of cases) expect(buildConversationDecisionContract(context(message)).responseAction).toBe(expected)
  })

  test('ambiguous references can produce a governed clarification action', () => {
    const rows = [row('user', 'We discussed several possible approaches.'), row('assistant', 'The options are A and B.')]
    const value = context('What about that?', rows)
    const contract = buildConversationDecisionContract({ ...value, references: [{ phrase: 'that', kind: 'pronoun', resolvedText: null, confidence: 0.3, ambiguous: true, candidates: [] }] })
    expect(contract.responseAction).toBe('clarify')
    expect(contract.clarificationRequired).toBe(true)
  })

  test('semantic assistance is requested for typo or ambiguity signals, but not required for ordinary text', () => {
    expect(semanticAssistanceRequired(context('wht about that?'))).toBe(true)
    expect(semanticAssistanceRequired(context('This is a straightforward answer.'))).toBe(false)
  })

  test('soft pass is formally bounded and cannot bypass evidence, continuity, or claim-consistency failures', () => {
    expect(isGovernedSoftPassEligible({ intent: 'conversation', qualityDecision: 'ESCALATE', conversationScore: 82, substantive: true })).toBe(true)
    expect(isGovernedSoftPassEligible({ intent: 'conversation', qualityDecision: 'ESCALATE', failureReason: 'evidence_insufficient', conversationScore: 92, substantive: true })).toBe(false)
    expect(isGovernedSoftPassEligible({ intent: 'conversation', qualityDecision: 'ESCALATE', conversationScore: 74, substantive: true })).toBe(false)
  })
})
