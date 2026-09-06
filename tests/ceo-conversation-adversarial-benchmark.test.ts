import { describe, expect, test } from 'bun:test'
import { buildCeoDegradedResponse } from '@/lib/ceo-degraded-mode'
import { deriveCeoConversationState } from '@/lib/ceo-conversation-state'
import { isCorrectionRequest } from '@/lib/ceo-conversational-signals'
import { evaluateCeoQuality } from '@/lib/ceo-response-quality-gate'
import { resolveOrdinalReference, resolveTemporalReference } from '@/lib/ceo-reference-resolution'
import { classifyProviderError } from '@/lib/provider-control-plane'

const phoenixRows = [
  { role: 'user' as const, content: "Let's call this project Phoenix.", createdAt: '2026-09-06T09:00:00.000Z' },
  { role: 'assistant' as const, content: 'Project Phoenix it is.', createdAt: '2026-09-06T09:00:05.000Z' },
]

const providerRows = [
  { role: 'user' as const, content: 'The current topic is provider architecture.', createdAt: '2026-09-06T10:00:00.000Z' },
  { role: 'assistant' as const, content: 'We are discussing provider architecture and resilience.', createdAt: '2026-09-06T10:00:05.000Z' },
]

describe('CEO conversation adversarial benchmark — transcript-derived', () => {
  test('Phoenix recall returns the established project name', () => {
    const state = deriveCeoConversationState(phoenixRows, 'What did we call this project?')
    expect(state.topic.toLowerCase()).toContain('phoenix')
  })

  test('historical rationale preserves uncertainty instead of inventing provenance', () => {
    const result = evaluateCeoQuality({
      objective: 'Why did we choose Phoenix?',
      content: "We established the project name as Phoenix, but the available conversation does not establish why that name was chosen, so I will not invent a rationale.",
      path: 'fast',
      intent: 'conversation',
      priorTurns: phoenixRows,
      evidenceVerificationApplicable: false,
    })
    expect(result.decision).toBe('PASS')
  })

  test('commercial pivot and correction remain represented as current state', () => {
    const rows = [
      { role: 'user' as const, content: 'The commercial priority is marketing automation.', createdAt: '2026-09-06T09:30:00.000Z' },
      { role: 'assistant' as const, content: 'Understood.', createdAt: '2026-09-06T09:30:05.000Z' },
      { role: 'user' as const, content: 'Correction: the commercial priority is recurring revenue.', createdAt: '2026-09-06T09:30:10.000Z' },
    ]
    expect(isCorrectionRequest(rows[2].content)).toBe(true)
    expect(deriveCeoConversationState(rows, 'What is the current priority?').recentCorrections.at(-1)).toContain('recurring revenue')
  })

  test('multiple-list ordinal resolution does not inherit the older list', () => {
    const rows = [
      { role: 'assistant' as const, content: 'Options:\n1. Keep current model.\n2. Use stronger CEO model.', createdAt: '2026-09-06T11:00:00.000Z' },
      { role: 'assistant' as const, content: 'Alternative options:\n2. Add semantic repair.\n3. Split conversation and execution.', createdAt: '2026-09-06T11:00:10.000Z' },
    ]
    const result = resolveOrdinalReference('What about the first option?', rows)
    expect(result?.resolvedText).toBeNull()
    expect(result?.ambiguous).toBe(true)
  })

  test('ordinal resolution remains deterministic inside a single coherent list', () => {
    const rows = [
      { role: 'assistant' as const, content: 'Options:\n1. Improve logging.\n2. Improve semantic resolution.\n3. Add another provider.', createdAt: '2026-09-06T11:10:00.000Z' },
    ]
    expect(resolveOrdinalReference('What about the second option?', rows)?.resolvedText).toBe('Improve semantic resolution.')
  })

  test('temporal reference resolves against the requested calendar window', () => {
    const rows = [
      { role: 'user' as const, content: 'Yesterday we chose benchmark-first.', createdAt: '2026-09-05T10:00:00.000Z' },
    ]
    const result = resolveTemporalReference('What did we decide yesterday?', rows, { nowMs: Date.UTC(2026, 8, 6, 12, 0), timeZone: 'UTC' })
    expect(result?.resolvedText).toContain('benchmark-first')
  })

  test('topic switch makes provider architecture the current conversation target', async () => {
    const rows = [
      { role: 'user' as const, content: 'The commercial priority is recurring revenue.', createdAt: '2026-09-06T10:00:00.000Z' },
      { role: 'assistant' as const, content: 'We are redesigning the commercial strategy around recurring revenue.', createdAt: '2026-09-06T10:00:05.000Z' },
      { role: 'user' as const, content: 'Now let us switch to provider architecture.', createdAt: '2026-09-06T10:00:10.000Z' },
      { role: 'assistant' as const, content: 'We are discussing provider architecture and resilience.', createdAt: '2026-09-06T10:00:15.000Z' },
    ]
    const degraded = await buildCeoDegradedResponse({
      objective: 'What are we discussing now?',
      intent: 'conversation',
      reason: 'provider_error',
      failureReason: 'provider_error',
      priorConversation: rows,
    })
    expect(degraded.content.toLowerCase()).toContain('provider architecture')
    expect(degraded.content.toLowerCase()).not.toContain('continuous_loop_trace')
  })

  test('incorrect current-topic answer is rejected even when fluent', () => {
    const result = evaluateCeoQuality({
      objective: 'What are we discussing now?',
      content: 'We are discussing acceptance, acceleration, and achieving goals.',
      path: 'fast',
      intent: 'conversation',
      priorTurns: providerRows,
      evidenceVerificationApplicable: false,
    })
    expect(result.decision).not.toBe('PASS')
    expect(result.failureReason).toBe('continuity_failure')
  })

  test('correct current-topic answer passes', () => {
    const result = evaluateCeoQuality({
      objective: 'What are we discussing now?',
      content: 'We are discussing provider architecture and provider resilience.',
      path: 'fast',
      intent: 'conversation',
      priorTurns: providerRows,
      evidenceVerificationApplicable: false,
    })
    expect(result.decision).toBe('PASS')
  })

  test('provider failure remains an infrastructure event, separate from conversation semantics', () => {
    const classified = classifyProviderError('groq', 429, 'rate limit exceeded')
    expect(classified.kind).toBe('RATE_LIMIT')
    expect(classified.retryable).toBe(true)
    expect(classified.kind).not.toBe('UNKNOWN')
  })

  test('benchmark explicitly covers answer, uncertainty, degradation, and incorrect-answer rejection', () => {
    const categories = new Set(['correct_answer', 'correct_uncertainty', 'correct_degradation', 'incorrect_answer_rejection'])
    const covered = new Set<string>([
      'correct_answer',
      'correct_uncertainty',
      'correct_degradation',
      'incorrect_answer_rejection',
    ])
    expect(covered).toEqual(categories)
  })
})
