import { describe, expect, test } from 'bun:test'
import { deriveCeoConversationState, resolveConversationReferences } from '@/lib/ceo-conversation-state'
import { extractEnumeratedItems, resolveActiveThread, resolveOrdinalReference, resolveTemporalReference } from '@/lib/ceo-reference-resolution'
import { evaluateCeoQuality } from '@/lib/ceo-response-quality-gate'
import { buildCeoDegradedResponse } from '@/lib/ceo-degraded-mode'
import { preRouteCeoRequest } from '@/lib/ceo-pre-router'
import { isCorrectionRequest } from '@/lib/ceo-conversational-signals'
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
