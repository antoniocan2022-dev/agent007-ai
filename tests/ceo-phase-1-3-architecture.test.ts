import { describe, expect, test } from 'bun:test'
import { buildCanonicalConversationContext } from '@/lib/ceo-cognitive-conversation'
import { buildConversationDecisionContract } from '@/lib/ceo-conversation-decision-contract'
import { deriveCeoConversationState } from '@/lib/ceo-conversation-state'
import { isGovernedSoftPassEligible } from '@/lib/ceo-soft-pass-policy'
import { semanticAssistanceRequired } from '@/lib/ceo-semantic-interpreter'
import type { PersistedConversationRow } from '@/lib/ceo-context-composer'

function row(role: 'user' | 'assistant', content: string, createdAt = Date.now()): PersistedConversationRow { return { role, content, createdAt } }
function context(message: string, rows: PersistedConversationRow[] = []): ReturnType<typeof buildCanonicalConversationContext> { const state = deriveCeoConversationState(rows, message); return buildCanonicalConversationContext({ currentMessage: message, rows, state, references: [] }) }

describe('CEO Phases 1-3 architecture contracts', () => {
  test('route has one canonical semantic interpretation and one direct pre-route call', async () => {
    const route = await Bun.file(new URL('../src/app/api/agent/route.ts', import.meta.url)).text()
    const lifecycle = await Bun.file(new URL('../src/lib/ceo-cognitive-lifecycle.ts', import.meta.url)).text()
    expect((route.match(/interpretCeoSemantics\(/g) ?? []).length).toBe(1)
    expect((route.match(/preRouteCeoRequest\(/g) ?? []).length).toBe(1)
    expect(route).toContain('preRouteCeoRequest(contextSeed.messages, atts.length, contextSeed.canonicalSemanticContext)')
    expect(route).toContain('preRoute, decisionContract')
    expect(lifecycle).toContain('request.preRoute ?? preRouteCeoRequest')
    expect(lifecycle).toContain('request.decisionContract?.responseAction')
  })

  test('canonical semantic context contains structured meaning, confidence and uncertainty', () => {
    const value = context('Can you explain this again?')
    expect(value.meaning.length).toBeGreaterThan(0)
    expect(value.semanticInterpretation.confidence).toBeGreaterThan(0)
    expect(Array.isArray(value.semanticInterpretation.uncertainty)).toBe(true)
  })

  test('low-confidence assisted meaning cannot replace deterministic meaning', () => {
    const value = context('What is the current architecture?')
    const assisted = buildCanonicalConversationContext({ currentMessage: 'What is the current architecture?', rows: [], state: value.state, references: [], semanticInterpretation: { source: 'hybrid', confidence: 0.4, meaning: 'A fabricated unrelated meaning', suggestedIntent: 'conversation' } })
    expect(assisted.meaning).toBe(value.meaning)
    expect(assisted.intentHint).toBe('analysis')
  })

  test('high-confidence assisted meaning can refine meaning while deterministic correction wins', () => {
    const value = context('wht about the routing decision?')
    const assisted = buildCanonicalConversationContext({ currentMessage: value.currentMessage, rows: [], state: value.state, references: [], semanticInterpretation: { source: 'hybrid', confidence: 0.9, meaning: 'Ask about the routing decision from the current conversation.', suggestedIntent: 'decision', suggestedSpeechAct: 'question', suggestedCognitiveDepth: 'strategic' } })
    expect(assisted.meaning).toContain('routing decision')
    expect(assisted.intentHint).toBe('decision')
    expect(assisted.speechAct).toBe('question')
  })

  test('semantic confidence and uncertainty affect the decision contract', () => {
    const base = context('What about that?')
    const cautious = buildConversationDecisionContract({ ...base, semanticInterpretation: { ...base.semanticInterpretation, source: 'hybrid', confidence: 0.5, uncertainty: [{ code: 'uncertain_reference', description: 'reference is unresolved', severity: 'high' }] } })
    const confident = buildConversationDecisionContract({ ...base, semanticInterpretation: { ...base.semanticInterpretation, source: 'hybrid', confidence: 0.9, uncertainty: [] } })
    expect(cautious.confidence).toBeLessThan(confident.confidence)
    expect(cautious.uncertainty.some((item) => item.code === 'uncertain_reference')).toBe(true)
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

  test('explicitly unresolved references require clarification, while resolved references remain answerable', () => {
    const rows = [row('user', 'We discussed several possible approaches.'), row('assistant', 'The options are A and B.')]
    const unresolved = context('What about that?', rows)
    const clarifyContract = buildConversationDecisionContract({ ...unresolved, references: [{ phrase: 'that', kind: 'pronoun', resolvedText: null, confidence: 0.3, ambiguous: true, candidates: [] }] })
    expect(clarifyContract.responseAction).toBe('clarify')
    expect(clarifyContract.clarificationRequired).toBe(true)

    const resolved = buildConversationDecisionContract({ ...unresolved, references: [{ phrase: 'that', kind: 'pronoun', resolvedText: 'the options are A and B', confidence: 0.96, ambiguous: false, candidates: [] }] })
    expect(resolved.clarificationRequired).toBe(false)
    expect(resolved.responseAction).not.toBe('clarify')
  })

  test('semantic assistance is requested for typo or targeted ambiguity signals, but not ordinary text', () => {
    expect(semanticAssistanceRequired(context('wht about that?'))).toBe(true)
    expect(semanticAssistanceRequired(context('This is a straightforward answer.'))).toBe(false)
    expect(semanticAssistanceRequired(context('This architecture is strong and this module is stable.'))).toBe(false)
  })

  test('soft pass is formally bounded and cannot bypass evidence, continuity, or claim-consistency failures', () => {
    expect(isGovernedSoftPassEligible({ intent: 'conversation', qualityDecision: 'ESCALATE', conversationScore: 82, substantive: true })).toBe(true)
    expect(isGovernedSoftPassEligible({ intent: 'conversation', qualityDecision: 'ESCALATE', failureReason: 'evidence_insufficient', conversationScore: 92, substantive: true })).toBe(false)
    expect(isGovernedSoftPassEligible({ intent: 'conversation', qualityDecision: 'ESCALATE', conversationScore: 74, substantive: true })).toBe(false)
    expect(isGovernedSoftPassEligible({ intent: 'conversation', qualityDecision: 'ESCALATE', failureReason: 'continuity_failure', conversationScore: 92, substantive: true })).toBe(false)
  })

  // Semantic continuity tie-breaker: the lexical continuity heuristics (staleResponseLikelihood/
  // scoreContextContinuity) are bag-of-words token-overlap scores, proven by a real production incident
  // to false-positive on a genuinely coherent response. semanticContinuityConfirmed is a real LLM
  // judgment call (semanticContinuityCheck in ceo-cognitive-lifecycle.ts), not another lexical proxy, and
  // it can rescue ONLY continuity_failure -- never the other three forbidden reasons, which are about
  // factual/evidentiary integrity, not conversational coherence.
  test('a confirmed semantic continuity judgment can rescue continuity_failure specifically', () => {
    expect(isGovernedSoftPassEligible({ intent: 'conversation', qualityDecision: 'ESCALATE', failureReason: 'continuity_failure', conversationScore: 92, substantive: true, semanticContinuityConfirmed: true })).toBe(true)
  })

  test('an unconfirmed or unchecked semantic continuity judgment does NOT rescue continuity_failure -- it must be positively confirmed, not merely not-denied', () => {
    expect(isGovernedSoftPassEligible({ intent: 'conversation', qualityDecision: 'ESCALATE', failureReason: 'continuity_failure', conversationScore: 92, substantive: true, semanticContinuityConfirmed: false })).toBe(false)
    expect(isGovernedSoftPassEligible({ intent: 'conversation', qualityDecision: 'ESCALATE', failureReason: 'continuity_failure', conversationScore: 92, substantive: true })).toBe(false)
  })

  test('the semantic continuity override cannot rescue evidence or claim-consistency failures, even when confirmed true', () => {
    for (const failureReason of ['evidence_unavailable', 'evidence_insufficient', 'claim_consistency_failure']) {
      expect(isGovernedSoftPassEligible({ intent: 'conversation', qualityDecision: 'ESCALATE', failureReason, conversationScore: 92, substantive: true, semanticContinuityConfirmed: true })).toBe(false)
    }
  })

  // Deep-audit finding, verified with a real probe before this fix existed: false_completion_claim and
  // internal_artifact_leak used to collapse into the generic 'quality_failure' reason, which was never on
  // FORBIDDEN_FAILURES -- so isGovernedSoftPassEligible returned true for both, given a high enough
  // conversationScore and substantive:true (a confident false claim reads as specific, not shallow; a
  // fluent response with an embedded artifact token can score just as well). Neither is overridable by
  // anything, including the semantic continuity confirmation that can rescue continuity_failure -- these
  // are about factual/artifact integrity, not conversational coherence.
  test('false_completion_claim and internal_artifact_leak are permanently forbidden from soft-pass, matching the factual/evidentiary reasons', () => {
    for (const failureReason of ['false_completion_claim', 'internal_artifact_leak']) {
      expect(isGovernedSoftPassEligible({ intent: 'decision', qualityDecision: 'ESCALATE', failureReason, conversationScore: 92, substantive: true })).toBe(false)
      expect(isGovernedSoftPassEligible({ intent: 'decision', qualityDecision: 'ESCALATE', failureReason, conversationScore: 92, substantive: true, semanticContinuityConfirmed: true })).toBe(false)
    }
  })

  // Deep-audit finding: SOFT_PASS_POLICY.requiresSemanticSubstanceCheck:true asserted a contract the
  // ceo-cognitive-lifecycle.ts call site did not actually enforce -- it passed semanticCheck.substantive
  // straight through, which defaults to true on both a confirmed SUBSTANTIVE verdict AND an unchecked
  // (inconclusive/errored) judge. Locks in that the call site combines both fields, matching what
  // isGovernedSoftPassEligible's own substantive:boolean input has always meant: a positively confirmed
  // judgment, not merely "not denied" -- the same standard already enforced for semanticContinuityConfirmed.
  test('the lifecycle wires the substance judge as checked-and-substantive, not substantive alone, honoring requiresSemanticSubstanceCheck', async () => {
    const lifecycle = await Bun.file(new URL('../src/lib/ceo-cognitive-lifecycle.ts', import.meta.url)).text()
    expect(lifecycle).toContain('substantive: semanticCheck.checked && semanticCheck.substantive')
    expect(lifecycle).not.toContain('substantive: semanticCheck.substantive,')
  })

  // Deep-audit finding: semanticContinuityCheck (the sole rescue path for continuity_failure) received only
  // request.priorConversation, while evaluateCeoQuality -- the gate that produces continuity_failure in the
  // first place -- also considers relevantOlderMessages. Locks in that the lifecycle now supplies the judge
  // with the same older-conversation context the gate itself relies on, so the override is never weaker
  // than the failure it exists to rescue.
  test('the lifecycle gives the continuity judge relevantOlderConversation, not just recent turns', async () => {
    const lifecycle = await Bun.file(new URL('../src/lib/ceo-cognitive-lifecycle.ts', import.meta.url)).text()
    expect(lifecycle).toContain('semanticContinuityCheck(objective, request.priorConversation ?? [], result.content, request.relevantOlderConversation ?? [])')
  })
})
