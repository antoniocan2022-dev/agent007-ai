import { describe, expect, test } from 'bun:test'
import { evaluateCeoQuality } from '@/lib/ceo-response-quality-gate'
import { isGovernedSoftPassEligible } from '@/lib/ceo-soft-pass-policy'
import { scoreContextContinuity } from '@/lib/ceo-context-intelligence'
import { extractEnumeratedItems, resolveOrdinalReference } from '@/lib/ceo-reference-resolution'

// Permanent regression coverage for the P1-P7 deep-audit hardening (PR merged as 521e8aae) and its own
// follow-up self-audit. These protections were previously verified only interactively; this file gives
// them durable coverage so a later change cannot silently regress any of them.

describe('CEO deep-audit hardening: quality-gate failureReason split', () => {
  test('a requestedActionSatisfied-only miss is quality_failure and stays soft-pass eligible', () => {
    const result = evaluateCeoQuality({
      objective: 'Should we prioritize Phoenix or Denver for the next expansion?',
      content: 'Phoenix is the stronger choice here: lower customer acquisition cost, faster provider latency, and an already-warm pipeline. Denver remains a good secondary market once Phoenix reaches steady state.',
      path: 'fast',
      intent: 'decision',
      responseAction: 'decide',
      evidenceVerificationApplicable: false,
    })
    expect(result.responseIntegrity?.requestedActionSatisfied).toBe(false)
    expect(result.responseIntegrity?.currentObjectiveMatch).toBe(true)
    expect(result.failureReason).toBe('quality_failure')
    expect(isGovernedSoftPassEligible({
      intent: 'decision',
      qualityDecision: result.decision,
      failureReason: result.failureReason,
      conversationScore: 80,
      substantive: true,
    })).toBe(true)
  })

  test('a genuine cross-objective substitution stays continuity_failure and forbidden from soft-pass', () => {
    const priorTurns = [
      { role: 'user' as const, content: 'Now let’s forget that and discuss the provider architecture.', createdAt: '2026-09-06T12:00:00.000Z' },
      { role: 'assistant' as const, content: 'We are discussing provider architecture and provider resilience.', createdAt: '2026-09-06T12:00:05.000Z' },
    ]
    const result = evaluateCeoQuality({
      objective: 'What are we discussing now?',
      content: 'We are discussing acceptance, acceleration, and the ability to achieve goals.',
      path: 'fast',
      intent: 'conversation',
      priorTurns,
      evidenceVerificationApplicable: false,
    })
    expect(result.failureReason).toBe('continuity_failure')
    expect(isGovernedSoftPassEligible({
      intent: 'conversation',
      qualityDecision: result.decision,
      failureReason: result.failureReason,
      conversationScore: 90,
      substantive: true,
    })).toBe(false)
  })
})

describe('CEO deep-audit hardening: generalized vague-question topic guard', () => {
  const providerPrior = [
    { role: 'user' as const, content: 'Now lets forget that and discuss the provider architecture.', createdAt: Date.now() - 60000 },
    { role: 'assistant' as const, content: 'Sure -- the provider architecture uses Groq as primary with Cloudflare, Mistral, Cerebras, and OpenRouter as governed fallbacks.', createdAt: Date.now() - 30000 },
  ]

  test('"Where are we with this?" hallucination is rejected', () => {
    const result = scoreContextContinuity({
      currentUserMessage: 'Where are we with this?',
      response: 'We are talking about the concepts of ability and being able, how things can be accelerated, and what it means to accept or achieve acceptance.',
      priorTurns: providerPrior,
    })
    expect(result.understood).toBe(false)
  })

  test('"Where are we with this?" grounded answer passes', () => {
    const result = scoreContextContinuity({
      currentUserMessage: 'Where are we with this?',
      response: 'We are still on the provider architecture -- specifically the Groq-primary fallback chain.',
      priorTurns: providerPrior,
    })
    expect(result.understood).toBe(true)
  })

  test('the same vague question WITHOUT a trailing "?" is now covered too', () => {
    const hallucinated = scoreContextContinuity({
      currentUserMessage: 'Where are we with this',
      response: 'We are talking about the concepts of ability and being able, how things can be accelerated, and what it means to accept or achieve acceptance.',
      priorTurns: providerPrior,
    })
    expect(hallucinated.understood).toBe(false)

    const grounded = scoreContextContinuity({
      currentUserMessage: 'Where are we with this',
      response: 'We are still on the provider architecture -- specifically the Groq-primary fallback chain.',
      priorTurns: providerPrior,
    })
    expect(grounded.understood).toBe(true)
  })

  test('a plain acknowledgement with no leading interrogative word is unaffected', () => {
    const result = scoreContextContinuity({
      currentUserMessage: 'Thanks, sounds good',
      response: 'Happy to help with anything else.',
      priorTurns: providerPrior,
    })
    expect(result.understood).toBe(true)
  })

  test('a substantive question without a trailing "?" is unaffected', () => {
    const result = scoreContextContinuity({
      currentUserMessage: 'What model does Cerebras use as the fallback',
      response: 'Cerebras is configured with gpt-oss-120b as its governed fallback model.',
      priorTurns: providerPrior,
    })
    expect(result.understood).toBe(true)
  })

  test('a substantive one-token question does not become an implicit current-topic question', () => {
    const result = scoreContextContinuity({
      currentUserMessage: 'What is revenue',
      response: 'Revenue is the income generated from selling goods or services.',
      priorTurns: providerPrior,
    })
    expect(result.understood).toBe(true)
  })

  test('a standalone noun question does not become an implicit current-topic question', () => {
    const result = scoreContextContinuity({
      currentUserMessage: 'What is status?',
      response: 'Status describes the current condition or state of something.',
      priorTurns: providerPrior,
    })
    expect(result.understood).toBe(true)
  })

  // A non-anaphoric vague check-in ("What's the status?") shares no vocabulary with the prior
  // conversation by construction, so the plain relevance filter in scoreContextContinuity always came
  // back empty for it -- which used to fall through to the "no context needed" fast path and report
  // `understood: true` unconditionally, completely bypassing the topic-alignment guard regardless of
  // what isVagueFollowUpQuestion decided. This silently reopened the exact hallucination class the guard
  // exists to catch, for any vague phrasing without an anaphora word ("this"/"that"/"it") or a literal
  // current-topic phrase.
  const vagueNoAnaphoraCases = ['What\'s the status?', 'Any updates?', 'Any progress?', 'What\'s new?', 'What\'s happening?']
  for (const message of vagueNoAnaphoraCases) {
    test(`non-anaphoric vague check-in "${message}" hallucination is rejected`, () => {
      const result = scoreContextContinuity({
        currentUserMessage: message,
        response: 'We are talking about the concepts of ability and being able, how things can be accelerated, and what it means to accept or achieve acceptance.',
        priorTurns: providerPrior,
      })
      expect(result.understood).toBe(false)
    })

    test(`non-anaphoric vague check-in "${message}" grounded answer passes`, () => {
      const result = scoreContextContinuity({
        currentUserMessage: message,
        response: 'We are still on the provider architecture -- specifically the Groq-primary fallback chain.',
        priorTurns: providerPrior,
      })
      expect(result.understood).toBe(true)
    })
  }

  test('a genuinely self-contained question with no prior turns at all is still understood', () => {
    const result = scoreContextContinuity({
      currentUserMessage: 'What is the capital of France?',
      response: 'Paris is the capital of France.',
      priorTurns: [],
    })
    expect(result.understood).toBe(true)
  })

  test('an ordinal reference to an older list is excluded from the guard, with or without "?"', () => {
    const priorTurns = [
      { role: 'user' as const, content: 'Give me three strategic pillars.', createdAt: Date.now() - 300000 },
      { role: 'assistant' as const, content: '1. Pricing and Packaging Architecture\n2. Unit Economics and Growth Levers\n3. The Retention and Expansion Engine', createdAt: Date.now() - 240000 },
      { role: 'user' as const, content: 'Instead, lets talk about the production release watchdog and deployment safety.', createdAt: Date.now() - 120000 },
      { role: 'assistant' as const, content: 'The release watchdog certifies the exact SHA before deploying to production.', createdAt: Date.now() - 60000 },
    ]
    const withQuestionMark = scoreContextContinuity({ currentUserMessage: 'The second one?', response: 'Unit Economics and Growth Levers -- specifically the relationship between CAC and LTV.', priorTurns })
    const withoutQuestionMark = scoreContextContinuity({ currentUserMessage: 'The second one', response: 'Unit Economics and Growth Levers -- specifically the relationship between CAC and LTV.', priorTurns })
    expect(withQuestionMark.understood).toBe(true)
    expect(withoutQuestionMark.understood).toBe(true)
  })

  test('a temporal reference to an earlier day is excluded from the guard', () => {
    const priorTurns = [
      { role: 'user' as const, content: 'Yesterday we discovered that Vercel was behind main.', createdAt: Date.now() - 25 * 60 * 60 * 1000 },
      { role: 'assistant' as const, content: 'Today we should verify the production SHA matches exactly.', createdAt: Date.now() - 24 * 60 * 60 * 1000 },
      { role: 'user' as const, content: 'Instead, lets talk about the provider architecture and failover chain.', createdAt: Date.now() - 60000 },
      { role: 'assistant' as const, content: 'The provider architecture uses Groq as primary with governed fallbacks.', createdAt: Date.now() - 30000 },
    ]
    const result = scoreContextContinuity({
      currentUserMessage: 'What did we discover yesterday?',
      response: 'Yesterday we discovered that Vercel was behind main.',
      priorTurns,
    })
    expect(result.understood).toBe(true)
  })
})

describe('CEO deep-audit hardening: bounded list-header persistence', () => {
  test('a list header expires after one intervening non-list row and does not fabricate a new list boundary', () => {
    const rows = [
      { role: 'assistant' as const, content: 'Options:\n1. Old A\n2. Old B', createdAt: '2026-09-06T12:00:00.000Z' },
      { role: 'assistant' as const, content: 'Alternative options:', createdAt: '2026-09-06T12:01:00.000Z' },
      { role: 'assistant' as const, content: 'By the way, the deploy finished cleanly with no errors.', createdAt: '2026-09-06T12:02:00.000Z' },
      { role: 'assistant' as const, content: '2. New C\n3. New D', createdAt: '2026-09-06T12:03:00.000Z' },
    ]
    const items = extractEnumeratedItems(rows)
    // The header from row 1 must have expired by the time row 3's numbered items arrive (row 2
    // intervened with no numbered content), so "New C"/"New D" stay attached to the original list-1
    // instead of the header spuriously opening a fresh list-2 boundary for unrelated later content.
    expect(items.map((item) => `${item.listId}:${item.ordinal}:${item.text}`)).toEqual([
      'list-1:1:Old A',
      'list-1:2:Old B',
      'list-1:2:New C',
      'list-1:3:New D',
    ])
  })

  test('a header immediately followed by its list still resolves correctly (original cross-turn fix preserved)', () => {
    const rows = [
      { role: 'assistant' as const, content: 'Alternative options:', createdAt: '2026-09-06T12:01:00.000Z' },
      { role: 'assistant' as const, content: '2. Add semantic repair.\n3. Split conversation and execution.', createdAt: '2026-09-06T12:01:10.000Z' },
    ]
    const items = extractEnumeratedItems(rows)
    expect(items.map((item) => `${item.listId}:${item.ordinal}`)).toEqual(['list-1:2', 'list-1:3'])
    expect(resolveOrdinalReference('What about the second option?', rows)?.resolvedText).toBe('Add semantic repair.')
  })
})