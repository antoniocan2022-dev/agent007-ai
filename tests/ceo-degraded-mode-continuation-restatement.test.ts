import { describe, expect, test } from 'bun:test'
import { buildCeoDegradedResponse } from '@/lib/ceo-degraded-mode'

// Live-transcript regression, degraded-mode half. See tests/ceo-conversation-signal-consolidation.test.ts
// for the full root-cause writeup and the evaluateCeoQuality/isContinuationOrRestatementRequest coverage.
// Kept in its own file because buildCeoDegradedResponse transitively imports persistent-memory.ts -> db.ts,
// which this sandbox can't load (pre-existing @prisma/client gap) -- this file can't run locally here, but
// runs in real CI the same way tests/ceo-degraded-mode-resolved-reference.test.ts already does.

const priorUser = 'are you ready for manage businesses with me?'
const priorAssistant = "Good, honest question -- let me give you a straight answer. Where I'm at: I've got real operational structure underneath me -- three businesses, a working org of leaders and specialists across finance, legal, security, growth, and ops. So: yes, I'm in. What business are you interested in starting with?"

describe('Live-transcript regression: degraded mode recognizes a restatement request instead of the generic bail-out', () => {
  test('"mmm but tell me in your words." no longer returns the fully generic non-answer', async () => {
    const degraded = await buildCeoDegradedResponse({
      objective: 'mmm but tell me in your words.',
      intent: 'conversation',
      responseAction: 'answer',
      reason: 'Quality gate did not pass after the allowed escalation depth (simulated).',
      failureReason: 'continuity_failure',
      priorConversation: [
        { role: 'user', content: priorUser, createdAt: 1 },
        { role: 'assistant', content: priorAssistant, createdAt: 2 },
      ],
      recall: async () => [],
    })
    expect(degraded.content).not.toBe(`I couldn't reliably complete that specific request, so I don't want to give you a generic answer that could miss what you're actually asking.`)
  })

  test('an unrelated genuine failure (no restatement/continuation language) still gets the generic denial', async () => {
    const degraded = await buildCeoDegradedResponse({
      objective: 'Analyze the psychological patterns affecting my decisions.',
      intent: 'conversation',
      responseAction: 'answer',
      reason: 'Quality gate did not pass after the allowed escalation depth (simulated).',
      failureReason: 'quality_failure',
      priorConversation: [
        { role: 'user', content: priorUser, createdAt: 1 },
        { role: 'assistant', content: priorAssistant, createdAt: 2 },
      ],
      recall: async () => [],
    })
    expect(degraded.content).toBe(`I couldn't reliably complete that specific request, so I don't want to give you a generic answer that could miss what you're actually asking.`)
  })
})

// Production incident (2026-09-21): a long pasted document that discussed evidence-architecture design
// (using "competitor" as an ordinary noun, e.g. "competitor/industry context" in a list of evidence
// sources) deep in its own body, nowhere near the user's own instruction, hijacked the whole degraded-mode
// response with the canned "I wouldn't make copying a competitor our safest strategy..." reply --
// completely unrelated to the user's actual "make a deep comprehension" request. Root cause:
// buildNaturalRecoveryResponse's `lower` keyword-scan variable was derived from the entire raw objective
// (objectiveFrom() returns the full, unbounded last user message) instead of the windowed instruction the
// rest of the CEO cognitive layer already uses for exactly this reason.
describe('Live-transcript regression: a pasted document mentioning "competitor" deep in its own body does not hijack degraded mode', () => {
  function longDocumentMentioningCompetitorMidBody(): string {
    const early = 'This report walks through the recommended architecture for evidence acquisition and canonical routing.'
    const filler = 'Additional architectural detail padding out this section of the document. '.repeat(150)
    const midBodyCompetitorMention = 'The evidence fabric should include market data, SEC facts, filings, company IR, news, risks, and competitor/industry context as parallel acquisition sources.'
    const late = 'That concludes the recommended design for the canonical evidence and routing architecture.'
    return [early, filler, midBodyCompetitorMention, filler, late].join('\n\n')
  }

  test('"Make a deep comprehension: "<document>"" does not trigger the canned copy/competitor advice', async () => {
    const document = longDocumentMentioningCompetitorMidBody()
    expect(document.length).toBeGreaterThan(2_000)
    const degraded = await buildCeoDegradedResponse({
      objective: `Make a deep comprehension:\n"${document}"`,
      intent: 'conversation',
      responseAction: 'answer',
      reason: 'Quality gate did not pass after the allowed escalation depth (simulated).',
      failureReason: 'quality_failure',
      recall: async () => [],
    })
    expect(degraded.content).not.toContain("I wouldn't make copying a competitor our safest strategy")
  })

  test('a genuine short request about copying a competitor still gets the intended canned advice (no regression)', async () => {
    const degraded = await buildCeoDegradedResponse({
      objective: 'Should we just copy our biggest competitor’s playbook instead of building our own strategy?',
      intent: 'conversation',
      responseAction: 'answer',
      reason: 'Quality gate did not pass after the allowed escalation depth (simulated).',
      failureReason: 'quality_failure',
      recall: async () => [],
    })
    expect(degraded.content).toContain("I wouldn't make copying a competitor our safest strategy")
  })
})
