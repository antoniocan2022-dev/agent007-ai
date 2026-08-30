import { describe, expect, test } from 'bun:test'
import { scoreContextContinuity } from '@/lib/ceo-context-intelligence'
import { evaluateCeoQuality, scoreCeoConversationQuality } from '@/lib/ceo-response-quality-gate'

type Row = { role: 'user' | 'assistant'; content: string; createdAt: string }

const PRIORITIES: Row[] = [
  {
    role: 'user',
    content: 'I think there are three priorities: better memory, better reference resolution, and better response quality.',
    createdAt: '2026-08-30T21:31:00.000Z',
  },
  {
    role: 'assistant',
    content: 'Those are the right pillars. They reinforce one another and form the foundation of a better CEO conversation.',
    createdAt: '2026-08-30T21:31:02.000Z',
  },
]

describe('CEO production conversational regressions', () => {
  test('which-one question is judged against prior conversation rather than question-word echo', () => {
    const result = scoreContextContinuity({
      currentUserMessage: 'Which one would you prioritize first, and why?',
      response: 'I would prioritize better reference resolution first because it connects memory to useful conversation and prevents ambiguity from derailing the discussion.',
      priorTurns: PRIORITIES,
    })
    expect(result.score).toBeGreaterThanOrEqual(70)
    expect(result.understood).toBe(true)
  })

  test('second-one continuation is judged using the semantic referent', () => {
    const result = scoreCeoConversationQuality({
      objective: "Okay. Let's work on the second one.",
      content: 'Absolutely. Reference resolution is the right next focus because it lets the CEO map phrases like "it" and "that" back to the correct idea without breaking the flow of the conversation.',
      priorTurns: PRIORITIES,
      resolvedReferences: [{
        phrase: 'the second one',
        kind: 'ordinal',
        resolvedText: 'better reference resolution',
        confidence: 0.98,
        sourceRole: 'user',
        ambiguous: false,
        candidates: [],
      }],
    })
    expect(result.continuity).toBeGreaterThanOrEqual(70)
    expect(result.referenceResolution).toBe(100)
    expect(result.issues.some((issue) => issue.includes('continuity is weak'))).toBe(false)
  })

  test('exact production-style priority question passes the CEO quality gate', () => {
    const result = evaluateCeoQuality({
      objective: 'Which one would you prioritize first, and why?',
      content: 'If I had to choose one starting point, I would prioritize better reference resolution because it makes the memory we already have usable in an actual conversation. It gives the CEO a reliable way to understand what "it", "that", or "the second one" refers to, which improves continuity and response quality.',
      path: 'fast',
      intent: 'conversation',
      priorTurns: PRIORITIES,
      evidenceVerificationApplicable: false,
    })
    expect(result.decision).toBe('PASS')
    expect(result.evidenceState).toBe('NOT_APPLICABLE')
  })

  test('exact production-style second-one continuation passes the CEO quality gate', () => {
    const result = evaluateCeoQuality({
      objective: "Okay. Let's work on the second one.",
      content: 'Reference resolution is a sharp choice. It is the connective tissue that prevents a conversation from feeling disjointed. Once the CEO can map that reference back to better reference resolution, we can work on it directly without losing the thread.',
      path: 'fast',
      intent: 'conversation',
      priorTurns: PRIORITIES,
      resolvedReferences: [{
        phrase: 'the second one',
        kind: 'ordinal',
        resolvedText: 'better reference resolution',
        confidence: 0.98,
        sourceRole: 'user',
        ambiguous: false,
        candidates: [],
      }],
      evidenceVerificationApplicable: false,
    })
    expect(result.decision).toBe('PASS')
    expect(result.evidenceState).toBe('NOT_APPLICABLE')
  })
})
