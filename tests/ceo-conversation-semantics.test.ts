import { describe, expect, test } from 'bun:test'
import { deriveCeoConversationState, resolveConversationReferences } from '@/lib/ceo-conversation-state'
import { extractEnumeratedItems, resolveActiveThread, resolveOrdinalReference, resolveTemporalReference } from '@/lib/ceo-reference-resolution'
import { evaluateCeoQuality } from '@/lib/ceo-response-quality-gate'
import { buildCeoDegradedResponse } from '@/lib/ceo-degraded-mode'
import { preRouteCeoRequest } from '@/lib/ceo-pre-router'
import { isCorrectionRequest } from '@/lib/ceo-conversational-signals'
import { classifyProviderError } from '@/lib/provider-control-plane'
import { CEO_CONVERSATION_BENCHMARK_CASES } from './fixtures/ceo-conversation-benchmark-cases'

describe('CEO conversation benchmark v0.1 — 25 hand-checked contracts', () => {
  test('25 benchmark cases are present', () => expect(CEO_CONVERSATION_BENCHMARK_CASES).toHaveLength(25))

  test('numbered-list extraction preserves ordered items', () => {
    const items = extractEnumeratedItems(CEO_CONVERSATION_BENCHMARK_CASES[10]?.rows ?? [])
    expect(items.map((item) => item.ordinal)).toEqual([1, 2, 3])
    expect(items[1]?.text).toBe('Use a stronger CEO model.')
  })

  for (const testCase of CEO_CONVERSATION_BENCHMARK_CASES) {
    test(testCase.name, () => {
      const state = deriveCeoConversationState(testCase.rows, testCase.message)
      const resolution = resolveConversationReferences(testCase.message, testCase.rows, state)[0]
      if (testCase.name === 'casual conversation quality') {
        expect(resolution).toBeUndefined()
        return
      }
      expect(resolution).toBeDefined()
      if (testCase.name === 'no antecedent remains unresolved') {
        expect(resolution?.resolvedText).toBeNull()
        expect(resolution?.ambiguous).toBe(true)
      } else if (testCase.name === 'ambiguous pronoun is flagged') {
        expect(resolution?.ambiguous).toBe(true)
        expect(resolution?.resolvedText).toBeNull()
      } else {
        expect(resolution?.resolvedText).toBeTruthy()
        expect(resolution?.confidence).toBeGreaterThan(0.5)
      }
    })
  }

  test('specialized ordinal resolver is distinct and deterministic', () => {
    const result = resolveOrdinalReference('What about the second option?', CEO_CONVERSATION_BENCHMARK_CASES[11]?.rows ?? [])
    expect(result?.kind).toBe('ordinal')
    expect(result?.resolvedText).toBe('Use a stronger CEO model.')
    expect(result?.ambiguous).toBe(false)
  })

  test('specialized temporal resolver uses calendar windows', () => {
    const now = Date.UTC(2026, 7, 30, 12, 0)
    const result = resolveTemporalReference('What did we decide yesterday?', CEO_CONVERSATION_BENCHMARK_CASES[15]?.rows ?? [], { nowMs: now, timeZone: 'UTC' })
    expect(result?.kind).toBe('temporal')
    expect(result?.resolvedText).toContain('Yes, benchmark-first is the safer sequence.')
    expect(result?.ambiguous).toBe(false)
  })

  test('structured active-thread resolver deterministically selects the latest active thread', () => {
    const rows = CEO_CONVERSATION_BENCHMARK_CASES[9]?.rows ?? []
    const state = deriveCeoConversationState(rows, 'Continue.')
    const result = resolveActiveThread('Continue.', state.threads)
    expect(result?.kind).toBe('continuation')
    expect(result?.resolvedText).toContain('CEO conversation architecture')
    expect(result?.ambiguous).toBe(false)
  })

  test('quality evaluation explicitly preserves casual conversation', () => {
    const result = evaluateCeoQuality({ objective: 'hi, how do you do?', content: 'Hi! I’m doing well. How are you?', path: 'fast', intent: 'conversation', evidenceVerificationApplicable: false })
    expect(result.decision).toBe('PASS')
    expect(result.evidenceState).toBe('NOT_APPLICABLE')
  })
})

describe('CEO conversation hardening P1-P4', () => {
  test('retrospective choose request is conversational while prospective choose remains decision support', () => {
    expect(preRouteCeoRequest([{ role: 'user', content: 'Why did we choose Phoenix?' }]).executionContract.intent).toBe('conversation')
    expect(preRouteCeoRequest([{ role: 'user', content: 'Why did we choose to deploy the new build?' }]).executionContract.intent).toBe('conversation')
    expect(preRouteCeoRequest([{ role: 'user', content: 'What should we choose for the revenue model?' }]).executionContract.intent).toBe('decision')
    expect(preRouteCeoRequest([{ role: 'user', content: 'What did we decide yesterday?' }]).executionContract.intent).toBe('conversation')
  })

  test('correction wording uses one canonical classifier and state records the correction', () => {
    const message = 'Correction: the priority is recurring revenue.'
    expect(isCorrectionRequest(message)).toBe(true)
    expect(deriveCeoConversationState([{ role: 'user', content: message, createdAt: '2026-09-06T12:00:00.000Z' }], message).recentCorrections).toContain(message)
  })

  test('quality gate rejects a fluent answer that changes the current topic', () => {
    const prior = [
      { role: 'user', content: 'Now let’s forget that and discuss the provider architecture.', createdAt: '2026-09-06T12:00:00.000Z' },
      { role: 'assistant', content: 'We are discussing provider architecture and provider resilience.', createdAt: '2026-09-06T12:00:05.000Z' },
    ] as const
    const result = evaluateCeoQuality({ objective: 'What are we discussing now?', content: 'We are discussing acceptance, acceleration, and the ability to achieve goals.', path: 'fast', intent: 'conversation', priorTurns: prior, evidenceVerificationApplicable: false })
    expect(result.decision).not.toBe('PASS')
    expect(result.failureReason).toBe('continuity_failure')
  })

  test('quality gate accepts an answer aligned with the current topic', () => {
    const prior = [
      { role: 'user', content: 'Now let’s forget that and discuss the provider architecture.', createdAt: '2026-09-06T12:00:00.000Z' },
      { role: 'assistant', content: 'We are discussing provider architecture and provider resilience.', createdAt: '2026-09-06T12:00:05.000Z' },
    ] as const
    const result = evaluateCeoQuality({ objective: 'What are we discussing now?', content: 'We are discussing provider architecture and how provider resilience should be handled.', path: 'fast', intent: 'conversation', priorTurns: prior, evidenceVerificationApplicable: false })
    expect(result.decision).toBe('PASS')
  })

  test('latest list begins at the newest explicit list header even when the new list starts at ordinal 2', () => {
    const rows = [
      { role: 'assistant', content: 'Options:\n1. Keep current model.\n2. Use stronger CEO model.', createdAt: '2026-09-06T12:00:00.000Z' },
      { role: 'assistant', content: 'Alternative options:\n2. Add semantic repair.\n3. Split conversation and execution.', createdAt: '2026-09-06T12:00:10.000Z' },
    ] as const
    const result = resolveOrdinalReference('What about the first option?', rows)
    expect(result?.resolvedText).toBeNull()
    expect(result?.ambiguous).toBe(true)
  })

  test('degraded recovery uses structured active-thread state for current-topic questions', async () => {
    const prior = [
      { role: 'user', content: 'Now let’s discuss provider architecture.', createdAt: '2026-09-06T12:00:00.000Z' },
      { role: 'assistant', content: 'We are discussing provider architecture and provider resilience.', createdAt: '2026-09-06T12:00:05.000Z' },
    ] as const
    const result = await buildCeoDegradedResponse({ objective: 'What are we discussing now?', intent: 'conversation', reason: 'provider_error', failureReason: 'provider_error', priorConversation: prior })
    expect(result.content.toLowerCase()).toContain('provider architecture')
    expect(result.content.toLowerCase()).not.toContain('evidence state')
    expect(result.content.toLowerCase()).not.toContain('quality gate')
  })
})

describe('CEO transcript-derived adversarial benchmark', () => {
  test('Phoenix recall preserves the established project name', () => {
    const rows = [
      { role: 'user' as const, content: "Let's call this project Phoenix.", createdAt: '2026-09-06T09:00:00.000Z' },
      { role: 'assistant' as const, content: 'Project Phoenix it is.', createdAt: '2026-09-06T09:00:05.000Z' },
    ]
    expect(deriveCeoConversationState(rows, 'What did we call this project?').topic.toLowerCase()).toContain('phoenix')
  })

  test('historical rationale returns uncertainty rather than invented provenance', () => {
    const result = evaluateCeoQuality({ objective: 'Why did we choose Phoenix?', content: "We established the project name as Phoenix, but the available conversation does not establish why that name was chosen, so I will not invent a rationale.", path: 'fast', intent: 'conversation', priorTurns: [{ role: 'user', content: "Let's call this project Phoenix.", createdAt: '2026-09-06T09:00:00.000Z' }, { role: 'assistant', content: 'Project Phoenix it is.', createdAt: '2026-09-06T09:00:05.000Z' }], evidenceVerificationApplicable: false })
    expect(result.decision).toBe('PASS')
  })

  test('commercial pivot and correction remain authoritative state', () => {
    const rows = [
      { role: 'user' as const, content: 'The commercial priority is marketing automation.', createdAt: '2026-09-06T09:30:00.000Z' },
      { role: 'assistant' as const, content: 'Understood.', createdAt: '2026-09-06T09:30:05.000Z' },
      { role: 'user' as const, content: 'Correction: the commercial priority is recurring revenue.', createdAt: '2026-09-06T09:30:10.000Z' },
    ]
    expect(isCorrectionRequest(rows[2].content)).toBe(true)
    expect(deriveCeoConversationState(rows, 'What is the current priority?').recentCorrections.at(-1)).toContain('recurring revenue')
  })

  test('multiple-list ordinal and topic-switch cases are handled without stale inheritance', () => {
    const rows = [
      { role: 'assistant' as const, content: 'Options:\n1. Improve logging.\n2. Improve semantic resolution.', createdAt: '2026-09-06T10:00:00.000Z' },
      { role: 'assistant' as const, content: 'New options:\n2. Improve provider resilience.\n3. Add an approval gate.', createdAt: '2026-09-06T10:00:10.000Z' },
    ]
    const result = resolveOrdinalReference('What about the first option?', rows)
    expect(result?.resolvedText).toBeNull()
    expect(result?.ambiguous).toBe(true)
  })

  test('temporal reference resolves against a calendar window', () => {
    const result = resolveTemporalReference('What did we decide yesterday?', [{ role: 'user', content: 'Yesterday we chose benchmark-first.', createdAt: '2026-09-05T10:00:00.000Z' }], { nowMs: Date.UTC(2026, 8, 6, 12, 0), timeZone: 'UTC' })
    expect(result?.resolvedText).toContain('benchmark-first')
  })

  test('incorrect current-topic answer is rejected despite fluent language', () => {
    const result = evaluateCeoQuality({ objective: 'What are we discussing now?', content: 'We are discussing acceptance, acceleration, and achieving goals.', path: 'fast', intent: 'conversation', priorTurns: [{ role: 'user', content: 'Now let us discuss provider architecture.', createdAt: '2026-09-06T10:00:00.000Z' }, { role: 'assistant', content: 'We are discussing provider architecture and resilience.', createdAt: '2026-09-06T10:00:05.000Z' }], evidenceVerificationApplicable: false })
    expect(result.decision).not.toBe('PASS')
    expect(result.failureReason).toBe('continuity_failure')
  })

  test('correct current-topic answer passes', () => {
    const result = evaluateCeoQuality({ objective: 'What are we discussing now?', content: 'We are discussing provider architecture and provider resilience.', path: 'fast', intent: 'conversation', priorTurns: [{ role: 'user', content: 'The current topic is provider architecture.', createdAt: '2026-09-06T10:00:00.000Z' }, { role: 'assistant', content: 'We are discussing provider architecture and resilience.', createdAt: '2026-09-06T10:00:05.000Z' }], evidenceVerificationApplicable: false })
    expect(result.decision).toBe('PASS')
  })

  test('provider failure remains an infrastructure event, separate from conversation semantics', () => {
    const classified = classifyProviderError('groq', 429, 'rate limit exceeded')
    expect(classified.kind).toBe('RATE_LIMIT')
    expect(classified.retryable).toBe(true)
  })

  test('degraded recovery remains safe and bounded after provider failure', async () => {
    const result = await buildCeoDegradedResponse({ objective: 'What are we discussing now?', intent: 'conversation', reason: 'provider_error', failureReason: 'provider_error', priorConversation: [{ role: 'user', content: 'We are discussing provider architecture.', createdAt: '2026-09-06T10:00:00.000Z' }, { role: 'assistant', content: 'Provider architecture and resilience are the current focus.', createdAt: '2026-09-06T10:00:05.000Z' }] })
    expect(result.content.toLowerCase()).toContain('provider architecture')
    expect(result.content.length).toBeLessThan(1500)
    expect(result.content).not.toContain('continuous_loop_trace')
  })
})
