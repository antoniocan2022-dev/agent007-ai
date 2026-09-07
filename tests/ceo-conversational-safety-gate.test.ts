import { describe, expect, test } from 'bun:test'
import { evaluateCeoQuality } from '@/lib/ceo-response-quality-gate'

// Step 1 of the conversational re-architecture: for conversational intent (conversation/opinion),
// evaluateCeoQuality's PASS gate no longer requires conversationOk (a 78-point regex/token-heuristic
// composite: naturalness wording, tone-word matching, reference-resolution scoring) or
// requestedActionSatisfied (literal decisive-phrase matching, e.g. 'challenge' requiring the exact words
// "however"/"i disagree"). Those judged phrasing, not safety, and were verified this session to reject
// genuinely good, on-topic answers -- the direct cause of real content being replaced by a canned
// degraded-mode sentence. continuityOk is deliberately kept: it is the signal this session spent five
// PRs calibrating to catch real off-topic hallucinations via authoritativeTopicAlignment, and dropping it
// would reopen exactly that class of bug. Non-conversational intents are unchanged.

describe('CEO conversational safety gate: real safety checks still block', () => {
  test('a hallucinated, off-topic answer to a current-topic question is still rejected', () => {
    const prior = [
      { role: 'user' as const, content: 'Now let’s forget that and discuss the provider architecture.', createdAt: '2026-09-06T12:00:00.000Z' },
      { role: 'assistant' as const, content: 'We are discussing provider architecture and provider resilience.', createdAt: '2026-09-06T12:00:05.000Z' },
    ]
    const result = evaluateCeoQuality({
      objective: 'What are we discussing now?',
      content: 'We are discussing acceptance, acceleration, and the ability to achieve goals.',
      path: 'fast',
      intent: 'conversation',
      priorTurns: prior,
      evidenceVerificationApplicable: false,
    })
    expect(result.decision).not.toBe('PASS')
    expect(result.failureReason).toBe('continuity_failure')
  })

  test('a grounded, correct current-topic answer still passes', () => {
    const prior = [
      { role: 'user' as const, content: 'Now let’s forget that and discuss the provider architecture.', createdAt: '2026-09-06T12:00:00.000Z' },
      { role: 'assistant' as const, content: 'We are discussing provider architecture and provider resilience.', createdAt: '2026-09-06T12:00:05.000Z' },
    ]
    const result = evaluateCeoQuality({
      objective: 'What are we discussing now?',
      content: 'We are discussing provider architecture and how provider resilience should be handled.',
      path: 'fast',
      intent: 'conversation',
      priorTurns: prior,
      evidenceVerificationApplicable: false,
    })
    expect(result.decision).toBe('PASS')
  })

  test('leaked internal artifacts are still rejected for conversational intent', () => {
    const result = evaluateCeoQuality({
      objective: 'How is the deploy going?',
      content: 'Answer\n1. [continuous_loop_trace] continuous_loop:abc { currentStage: "PERCEIVE" }',
      path: 'fast',
      intent: 'conversation',
      evidenceVerificationApplicable: false,
    })
    expect(result.decision).not.toBe('PASS')
  })

  test('a false completion claim is still rejected for conversational intent', () => {
    const result = evaluateCeoQuality({
      objective: 'Can you deploy this?',
      content: 'I have already deployed the update to production.',
      path: 'fast',
      intent: 'conversation',
      evidenceVerificationApplicable: false,
      externalAgencyAvailable: false,
    })
    expect(result.decision).not.toBe('PASS')
  })
})

describe('CEO conversational safety gate: phrasing no longer blocks a good answer', () => {
  test('an opinion/challenge without the literal "however/i disagree" phrasing now passes', () => {
    const result = evaluateCeoQuality({
      objective: 'Should we spend the whole budget on paid ads?',
      content: 'Not the whole budget -- paid ads have diminishing returns past a certain spend, and organic channels are cheaper right now. I would split it 60/40 toward organic and retention work.',
      path: 'fast',
      intent: 'opinion',
      responseAction: 'challenge',
      evidenceVerificationApplicable: false,
    })
    expect(result.decision).toBe('PASS')
  })

  test('a short, informal conversational answer that would have scored under 78 now passes', () => {
    const result = evaluateCeoQuality({
      objective: 'Quick one -- are we still on track for Friday?',
      content: 'Yeah, on track. Provider fleet is healthy and the last deploy went clean.',
      path: 'fast',
      intent: 'conversation',
      evidenceVerificationApplicable: false,
    })
    expect(result.decision).toBe('PASS')
  })

  test('a decisive answer without the literal "the decision is" phrase now passes', () => {
    const result = evaluateCeoQuality({
      objective: 'Phoenix or Denver for the next expansion?',
      content: 'Phoenix. Lower CAC, faster provider latency, and an already-warm pipeline there. Denver is a fine second choice once Phoenix stabilizes.',
      path: 'fast',
      intent: 'conversation',
      responseAction: 'decide',
      evidenceVerificationApplicable: false,
    })
    expect(result.decision).toBe('PASS')
  })
})
