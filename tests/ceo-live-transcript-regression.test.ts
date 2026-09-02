import { describe, expect, test } from 'bun:test'
import { isGovernedSoftPassEligible } from '@/lib/ceo-soft-pass-policy'

describe('Live-transcript regression: shadow-layer intent mismatch and soft-pass scope', () => {
  test('a message the canonical decision contract correctly classifies as conversation is not blocked just because the older pre-router still classifies it as decision', () => {
    // Confirmed directly against real code during investigation: "No, I meant operations kit
    // should come first instead" -- an explicit correction -- was misrouted this exact way.
    const eligible = isGovernedSoftPassEligible({
      intent: 'decision',
      authoritativeIntent: 'conversation',
      qualityDecision: 'ESCALATE',
      failureReason: 'quality_failure',
      conversationScore: 80,
      substantive: true,
    })
    expect(eligible).toBe(true)
  })

  test('a genuine decision-intent message (the normal substance of a business-decisions product) is no longer excluded from graceful degradation just for having that intent', () => {
    const eligible = isGovernedSoftPassEligible({
      intent: 'decision',
      authoritativeIntent: 'decision',
      qualityDecision: 'ESCALATE',
      failureReason: 'quality_failure',
      conversationScore: 80,
      substantive: true,
    })
    expect(eligible).toBe(true)
  })

  test('an analysis-intent message is included in the same expanded scope', () => {
    const eligible = isGovernedSoftPassEligible({
      intent: 'analysis',
      authoritativeIntent: 'analysis',
      qualityDecision: 'ESCALATE',
      failureReason: 'quality_failure',
      conversationScore: 80,
      substantive: true,
    })
    expect(eligible).toBe(true)
  })

  test('the safety backstop still holds: a genuine evidence overclaim is rejected regardless of intent, old or new', () => {
    const eligible = isGovernedSoftPassEligible({
      intent: 'decision',
      authoritativeIntent: 'decision',
      qualityDecision: 'ESCALATE',
      failureReason: 'evidence_insufficient',
      conversationScore: 95,
      substantive: true,
    })
    expect(eligible).toBe(false)
  })

  test('an intent genuinely outside the expanded scope (e.g. a raw execution/action request) is still excluded', () => {
    const eligible = isGovernedSoftPassEligible({
      intent: 'action',
      authoritativeIntent: 'action',
      qualityDecision: 'ESCALATE',
      failureReason: 'quality_failure',
      conversationScore: 90,
      substantive: true,
    })
    expect(eligible).toBe(false)
  })
})
