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
