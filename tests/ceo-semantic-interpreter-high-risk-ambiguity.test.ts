import { describe, expect, test } from 'bun:test'
import { interpretCeoSemantics, semanticAssistanceRequired } from '@/lib/ceo-semantic-interpreter'
import type { CanonicalConversationContext } from '@/lib/ceo-cognitive-conversation'

// Conflict benchmark 1 of 4 ("make Agent007 feel like Claude" arbitration audit): found by reading
// ceo-semantic-interpreter.ts directly rather than trusting a summary of it. interpretCeoSemantics has
// two gates, not one: shouldAssist() decides whether LLM-assisted disambiguation is even considered
// (ambiguous/low-confidence references, typo patterns, targeted-reference phrasing, self-assessment
// phrasing), but a SECOND gate right after it short-circuits back to deterministic-only whenever the
// message also matches high-risk execution language (deploy/publish/production/ship/launch) or
// mission/venture/revenue language -- regardless of how ambiguous the reference is. That is a real,
// previously-unflagged asymmetry: disambiguation help is deliberately *less* available exactly when the
// stakes are highest ("deploy the second one" with a genuinely ambiguous "second one" gets no LLM-assisted
// help resolving it, while the identical ambiguity in a low-stakes message would). This is presumably a
// deliberate safety boundary (don't let an unverified LLM guess influence a high-risk action) rather than
// a bug, but the behavior itself was unverified anywhere in the test suite until now.
//
// These tests exercise the actual gating logic directly and require no network or API key: the
// high-risk short-circuit (when it fires) returns before runCanonicalLlm is ever called, so this is
// fully deterministic and runs in any sandbox.

function context(currentMessage: string, referenceOverrides?: Partial<CanonicalConversationContext['references'][number]>): CanonicalConversationContext {
  return {
    schemaVersion: 1,
    currentMessage,
    meaning: currentMessage,
    semanticInterpretation: { schemaVersion: 1, meaning: '', confidence: 0, uncertainty: [], source: 'deterministic' },
    intentHint: 'action',
    speechAct: 'request',
    cognitiveDepth: 'direct',
    referenceScope: 'none',
    references: referenceOverrides ? [{ phrase: 'the second one', kind: 'ordinal', resolvedText: null, confidence: 0.4, ambiguous: true, candidates: [], ...referenceOverrides }] : [],
    worldModel: { schemaVersion: 1, workingTopic: '', subtopics: [], userGoals: [], decisions: [], commitments: [], openLoops: [], activeThreads: [], importantEntities: [], recentCorrections: [], durableMemoryKeys: [] },
    state: { schemaVersion: 5, topic: '', topicCandidates: [], entities: [], activeThreads: [], threads: [], unresolvedQuestions: [], decisions: [], decisionSignals: [], supersededDecisions: [], recentUserGoals: [], recentCorrections: [], tone: 'neutral', turnCount: 0, lastUserMessage: currentMessage, lastAssistantMessage: '', updatedAt: Date.now() },
  }
}

describe('Conflict benchmark: ambiguous reference vs. high-risk execution language', () => {
  test('an ambiguous reference with no high-risk language is a genuine candidate for semantic assistance', () => {
    const ctx = context('Explain the second one to me.', { ambiguous: true, confidence: 0.4 })
    expect(semanticAssistanceRequired(ctx)).toBe(true)
  })

  test('the identical ambiguous reference inside high-risk execution language short-circuits to deterministic -- LLM-assisted disambiguation never runs', async () => {
    const ctx = context('Deploy the second one to production.', { ambiguous: true, confidence: 0.4 })
    // semanticAssistanceRequired only reflects shouldAssist() -- the reference IS ambiguous enough to
    // be a candidate. The high-risk short-circuit is a second, independent gate inside
    // interpretCeoSemantics itself, which this call proves actually fires.
    expect(semanticAssistanceRequired(ctx)).toBe(true)
    const result = await interpretCeoSemantics(ctx)
    expect(result.source).toBe('deterministic')
  })

  test('the same ambiguity inside mission/venture/revenue language also short-circuits (isolated from the high-risk-execution-verb gate)', async () => {
    const ctx = context('The mission plan depends on the second one.', { ambiguous: true, confidence: 0.4 })
    const result = await interpretCeoSemantics(ctx)
    expect(result.source).toBe('deterministic')
  })

  test('high-risk language alone, with no ambiguity at all, never reaches the LLM either (shouldAssist is false)', async () => {
    const ctx = context('Deploy the release to production.')
    expect(semanticAssistanceRequired(ctx)).toBe(false)
    const result = await interpretCeoSemantics(ctx)
    expect(result.source).toBe('deterministic')
  })
})
