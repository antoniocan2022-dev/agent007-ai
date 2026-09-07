import { describe, expect, test } from 'bun:test'
import { buildCeoDegradedResponse } from '@/lib/ceo-degraded-mode'
import { extractEnumeratedItems, resolveOrdinalReference, type ReferenceResolution } from '@/lib/ceo-reference-resolution'
import { deriveCeoConversationState } from '@/lib/ceo-conversation-state'
import type { PersistedConversationRow } from '@/lib/ceo-context-composer'

// Regression coverage for a real production transcript: a user asked Agent007 to self-assess its
// strengths/weaknesses (a numbered list), then said "explain me more about the second one" and,
// separately, "What about the third one?". Both are textbook ordinal references the resolver already
// handles correctly (verified below) -- but degraded/recovery mode had no access to that resolution at
// all, so when the primary path failed for any reason, the user got a fully generic non-answer that read
// as "the assistant forgot the conversation", even though the reference had already been resolved
// correctly upstream. This file locks in the fix: buildCeoDegradedResponse now receives resolvedReferences
// and grounds its recovery response in a high-confidence resolution instead of a template that ignores it.

const priorTurns: PersistedConversationRow[] = [
  { role: 'user', content: 'can you give me a self-comprehension...', createdAt: Date.now() - 60000 },
  { role: 'assistant', content: [
    '1. Synthesis and Pattern Recognition: I can ingest massive amounts of complex information.',
    '2. Multidisciplinary Reasoning: I am a generalist by design.',
    '3. Objective Rigor: I do not get tired.',
  ].join('\n'), createdAt: Date.now() - 50000 },
  { role: 'user', content: 'continues.', createdAt: Date.now() - 40000 },
  { role: 'assistant', content: [
    '4. Execution-Oriented Thinking: I think in terms of what comes next.',
    '',
    'Now, to be a true partner, I have to be equally transparent about my Weaknesses:',
    '1. Data Dependency and Latency: I am a passenger to the information available to me.',
    "2. Absence of True Intuition: I use advanced pattern recognition, which can look like intuition, but it isn't. I don't have gut feelings based on years of physical experience.",
    '3. The Risk of Hallucination: Because I am a probabilistic engine, there is always a non-zero risk that I might present an inference as a hard fact.',
  ].join('\n'), createdAt: Date.now() - 30000 },
]

describe('Live-transcript regression: ordinal reference resolution against the assistant\'s own numbered list', () => {
  test('the resolver correctly separates the two lists (strengths vs. weaknesses) by ordinal reset', () => {
    const items = extractEnumeratedItems(priorTurns)
    const weaknessList = items.filter((item) => item.listId === items.at(-1)!.listId)
    expect(weaknessList.map((item) => item.ordinal)).toEqual([1, 2, 3])
    expect(weaknessList[1]!.text).toContain('Absence of True Intuition')
    expect(weaknessList[2]!.text).toContain('Risk of Hallucination')
  })

  test('"explain me more about the second one" resolves to the second weakness with high confidence', () => {
    const resolved = resolveOrdinalReference('explain me more about the second one.', priorTurns)
    expect(resolved?.ambiguous).toBe(false)
    expect(resolved?.confidence).toBeGreaterThanOrEqual(0.7)
    expect(resolved?.resolvedText).toContain('Absence of True Intuition')
  })

  test('"What about the third one?" resolves to the third weakness with high confidence', () => {
    const resolved = resolveOrdinalReference('What about the third one?', priorTurns)
    expect(resolved?.ambiguous).toBe(false)
    expect(resolved?.confidence).toBeGreaterThanOrEqual(0.7)
    expect(resolved?.resolvedText).toContain('Risk of Hallucination')
  })
})

describe('Track 2 slice: degraded mode reuses the canonical conversationState instead of re-deriving it', () => {
  test('an explicitly passed conversationState is used as-is rather than being recomputed from priorConversation', async () => {
    // A deliberately distinguishable stand-in state: if buildCeoDegradedResponse ignored this and
    // re-derived from priorTurns instead, "we're continuing from" would reference the real derived
    // thread title, not this synthetic one -- proving the passed-in state actually took priority.
    const stubState = deriveCeoConversationState([{ role: 'user', content: 'continue our discussion about the synthetic-thread-marker topic.', createdAt: Date.now() }], 'continue')
    const degraded = await buildCeoDegradedResponse({
      objective: 'continue',
      intent: 'conversation',
      responseAction: 'answer',
      reason: 'Quality gate did not pass after the allowed escalation depth (simulated).',
      failureReason: 'quality_failure',
      priorConversation: priorTurns,
      conversationState: stubState,
      recall: async () => [],
    })
    expect(degraded.content).toContain('synthetic-thread-marker')
  })
})

describe('Live-transcript regression: degraded mode now grounds recovery in an already-resolved reference', () => {
  test('with the resolved reference threaded through, degraded mode surfaces the resolved concept instead of a fully generic non-answer', async () => {
    const objective = 'explain me more about the second one.'
    const resolved = resolveOrdinalReference(objective, priorTurns)!
    const degraded = await buildCeoDegradedResponse({
      objective,
      intent: 'conversation',
      responseAction: 'explain',
      reason: 'Quality gate did not pass after the allowed escalation depth (simulated).',
      failureReason: 'quality_failure',
      priorConversation: priorTurns,
      resolvedReferences: [resolved],
      recall: async () => [],
    })
    expect(degraded.content).toContain('Absence of True Intuition')
    expect(degraded.content).not.toBe(`I couldn't reliably complete that specific request, so I don't want to give you a generic answer that could miss what you're actually asking.`)
  })

  test('without a resolved reference, degraded mode falls back to the prior generic behavior unchanged', async () => {
    const degraded = await buildCeoDegradedResponse({
      objective: 'explain me more about the second one.',
      intent: 'conversation',
      responseAction: 'explain',
      reason: 'Quality gate did not pass after the allowed escalation depth (simulated).',
      failureReason: 'quality_failure',
      priorConversation: priorTurns,
      resolvedReferences: [],
      recall: async () => [],
    })
    expect(degraded.content).not.toContain('Absence of True Intuition')
  })

  test('a low-confidence or ambiguous reference is not trusted -- same bar as the quality gate\'s hasHighConfidenceResolvedReference', async () => {
    const weakReference: ReferenceResolution = { phrase: 'the second one', kind: 'ordinal', resolvedText: 'Absence of True Intuition (low confidence match)', confidence: 0.4, ambiguous: false, candidates: [] }
    const degraded = await buildCeoDegradedResponse({
      objective: 'explain me more about the second one.',
      intent: 'conversation',
      responseAction: 'explain',
      reason: 'Quality gate did not pass after the allowed escalation depth (simulated).',
      failureReason: 'quality_failure',
      priorConversation: priorTurns,
      resolvedReferences: [weakReference],
      recall: async () => [],
    })
    expect(degraded.content).not.toContain('Absence of True Intuition')
  })

  test('a resolved reference whose phrase does not appear in the CURRENT objective is not used -- guards against a stale reference from earlier in the conversation', async () => {
    const staleReference: ReferenceResolution = { phrase: 'the first one', kind: 'ordinal', resolvedText: 'Data Dependency and Latency', confidence: 0.98, ambiguous: false, candidates: [] }
    const degraded = await buildCeoDegradedResponse({
      objective: 'explain me more about the second one.',
      intent: 'conversation',
      responseAction: 'explain',
      reason: 'Quality gate did not pass after the allowed escalation depth (simulated).',
      failureReason: 'quality_failure',
      priorConversation: priorTurns,
      resolvedReferences: [staleReference],
      recall: async () => [],
    })
    expect(degraded.content).not.toContain('Data Dependency and Latency')
  })
})
