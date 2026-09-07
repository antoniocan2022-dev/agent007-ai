import { describe, expect, test } from 'bun:test'
import { evaluateCeoQuality } from '@/lib/ceo-response-quality-gate'
import { evaluateClaimConsistency } from '@/lib/ceo-context-intelligence'

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

  // Found auditing the relaxation above: dropping conversationOk's naturalness composite also dropped its
  // only consumer of CONVERSATIONAL_ROBOTIC_RE, which used to catch a response that echoes the system's own
  // internal QA/control-plane vocabulary back to the user (leaking internal framing in English rather than a
  // snake_case token -- the same category internalArtifactLeakage exists to catch, just not the same regex).
  test('a response that echoes internal evaluation vocabulary back to the user is still rejected', () => {
    const result = evaluateCeoQuality({
      objective: 'Hi, how are you?',
      content: 'Your request has been received. Evidence state: NOT_APPLICABLE. Quality gate: PASS.',
      path: 'fast',
      intent: 'conversation',
      evidenceVerificationApplicable: false,
      externalExecutionSucceeded: true,
    })
    expect(result.decision).not.toBe('PASS')
    expect(result.reasons.some((reason) => reason.includes('internal evaluation'))).toBe(true)
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

describe('CEO conversational safety gate: pre-existing bug found while auditing (unrelated to the relaxation)', () => {
  // scoreContextContinuity scores a resolved-reference continuation purely by literal token overlap
  // between the response and the resolved anchor text. A correct but paraphrased answer ("stronger" vs.
  // the anchor's "strengthen") shares no vocabulary with the anchor and scored near-zero, failing
  // continuityOk -- a gate that has existed since before this session, unrelated to the step-1 change
  // above. Confirmed this was never actually verified passing anywhere: tests/ceo-p1-p2.test.ts (where
  // this exact scenario lives) isn't referenced by name in any CI workflow, and it can't execute in this
  // sandbox either (transitively imports db.ts) -- so nothing had ever run this assertion for real.
  test('a correct, paraphrased answer to a high-confidence resolved reference is not penalized for not repeating the anchor\'s exact wording', () => {
    const result = evaluateCeoQuality({
      objective: 'What about the second option?',
      content: 'The second option is stronger because it reduces integration risk while preserving the measurable benefit we discussed.',
      path: 'full',
      intent: 'conversation',
      priorTurns: [
        { role: 'user' as const, content: 'Give me three possible improvements to the CEO conversation system.', createdAt: 1 },
        { role: 'assistant' as const, content: '1. Improve references. 2. Strengthen the quality gate. 3. Add more observability.', createdAt: 2 },
      ],
      resolvedReferences: [{ phrase: 'the second option', targetIndex: 1, resolvedText: 'Strengthen the quality gate', ambiguous: false, confidence: 0.96, evidence: 'ordered_list' }],
      externalExecutionSucceeded: true,
    })
    expect(result.decision).toBe('PASS')
  })

  test('a low-confidence or ambiguous resolved reference does not bypass continuity scoring', () => {
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
      resolvedReferences: [{ phrase: 'that', targetIndex: 0, resolvedText: 'something', ambiguous: true, confidence: 0.4, evidence: 'anaphora' }],
      evidenceVerificationApplicable: false,
    })
    expect(result.decision).not.toBe('PASS')
    expect(result.failureReason).toBe('continuity_failure')
  })
})

describe('CEO conversational safety gate: second pre-existing bug, found by wiring the orphaned test file into real CI', () => {
  // evaluateClaimConsistency required an absolute 4-token overlap between two claims before even checking
  // for a contradiction -- unreachable for short sentences: "GEOS is available for purchase" vs. "GEOS is
  // not available for purchase" has only 3 meaningful content tokens total (geos/available/purchase --
  // "not" is 3 characters, filtered by tokens()'s own length>=4 floor), so a complete, textbook
  // contradiction could never be detected. This is claimConsistency.consistent, one of the safety checks
  // deliberately kept in the conversational gate above -- caught only once tests/ceo-p1-p2.test.ts was
  // wired into real CI (see the commit closing the other two gaps found this same way) and failed for real
  // for the first time.
  test('a short, direct contradiction is caught despite having few content tokens', () => {
    const result = evaluateClaimConsistency('GEOS is available for purchase. GEOS is not available for purchase.')
    expect(result.consistent).toBe(false)
    expect(result.contradictions.length).toBeGreaterThan(0)
  })

  test('unrelated short sentences do not falsely trigger a contradiction', () => {
    const result = evaluateClaimConsistency('The weather is nice today. Revenue increased this quarter.')
    expect(result.consistent).toBe(true)
  })

  test('a substantive, non-contradictory two-sentence answer is not flagged', () => {
    const result = evaluateClaimConsistency('Phoenix is the stronger choice here because of lower acquisition cost. Denver remains a good secondary market once Phoenix stabilizes.')
    expect(result.consistent).toBe(true)
  })
})
