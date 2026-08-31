import { describe, expect, test } from 'bun:test'
import { buildCanonicalConversationContext, classifyCognitiveDepthFromMessages } from '@/lib/ceo-cognitive-conversation'
import { deriveCeoConversationState, resolveConversationReferences } from '@/lib/ceo-conversation-state'
import { buildConversationRegressionContract } from '@/lib/ceo-conversation-regression'
import { scoreCeoConversationQuality } from '@/lib/ceo-response-quality-gate'

type Row = { role: 'user' | 'assistant'; content: string; createdAt: string }

const rows: Row[] = [
  { role: 'user', content: 'We are improving Agent007. Our priorities are memory, reference resolution, and response quality.', createdAt: '2026-08-31T19:00:00.000Z' },
  { role: 'assistant', content: 'Those priorities reinforce each other; memory gives us context, reference resolution makes it usable, and response quality is the outcome.', createdAt: '2026-08-31T19:00:02.000Z' },
  { role: 'user', content: 'Which one would you prioritize first, and why?', createdAt: '2026-08-31T19:00:05.000Z' },
  { role: 'assistant', content: 'I would prioritize reference resolution first because it turns stored context into usable conversational meaning.', createdAt: '2026-08-31T19:00:07.000Z' },
]

describe('canonical cognitive conversation architecture', () => {
  test('builds one semantic context shared by state, references, world model, and cognitive depth', () => {
    const current = "Okay. Let's work on the second one."
    const state = deriveCeoConversationState(rows, current)
    const references = resolveConversationReferences(current, rows, state)
    const context = buildCanonicalConversationContext({ currentMessage: current, rows, state, references })
    expect(context.intentHint).toBe('conversation')
    expect(context.speechAct).toBe('continuation')
    expect(context.cognitiveDepth).toBe('contextual')
    expect(context.referenceScope).toBe('cross_turn')
    expect(context.references[0]?.resolvedText).toBe('reference resolution')
    expect(context.worldModel.workingTopic).toBeTruthy()
    expect(context.worldModel.decisions.length).toBeGreaterThan(0)
  })

  test('first-turn conversational proposition remains direct rather than forced into deep execution', () => {
    expect(classifyCognitiveDepthFromMessages('I think these are the three priorities for the CEO conversation.', 0, 0)).toBe('direct')
  })

  test('long contextual conversation automatically deepens cognitive depth', () => {
    expect(classifyCognitiveDepthFromMessages('Continue the discussion.', 24, 1)).toBe('deep')
  })

  test('semantic strategic request selects strategic depth', () => {
    expect(classifyCognitiveDepthFromMessages('Compare the architecture trade-offs and recommend the safest strategy.', 4, 0)).toBe('strategic')
  })

  test('incident contract classifies a reference-quality failure and preserves safety invariants', () => {
    const current = 'What about it?'
    const state = deriveCeoConversationState(rows, current)
    const refs = resolveConversationReferences(current, rows, state)
    const context = buildCanonicalConversationContext({ currentMessage: current, rows, state, references: refs })
    const quality = scoreCeoConversationQuality({
      objective: current,
      content: 'I need more information before I can choose between the two active ideas.',
      priorTurns: rows,
      resolvedReferences: refs,
    })
    const contract = buildConversationRegressionContract(context, quality)
    expect(contract.schemaVersion).toBe(1)
    expect(contract.fingerprint).toMatch(/^conv-/)
    expect(contract.shouldNever.length).toBeGreaterThanOrEqual(3)
  })
})
