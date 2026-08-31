import { describe, expect, test } from 'bun:test'
import { deriveCeoConversationState, resolveConversationReferences } from '@/lib/ceo-conversation-state'
import { buildCanonicalConversationContext } from '@/lib/ceo-cognitive-conversation'
import { scoreCeoConversationQuality } from '@/lib/ceo-response-quality-gate'

type Row = { role: 'user' | 'assistant'; content: string; createdAt: string }

function buildLongConversation(turns: number): Row[] {
  const rows: Row[] = []
  const start = Date.UTC(2026, 7, 31, 12, 0)
  for (let i = 1; i <= turns; i += 1) {
    rows.push({
      role: 'user',
      content: i === 1
        ? 'We are improving Agent007. The priorities are memory, reference resolution, and response quality.'
        : i % 7 === 0
          ? `We should revisit the second priority and keep the conversation focused on reference resolution. Turn ${i}.`
          : i % 11 === 0
            ? `Let's switch topics briefly to revenue strategy, then return to the CEO conversation. Turn ${i}.`
            : `Continue the current discussion and connect this point to the decisions we already made. Turn ${i}.`,
      createdAt: new Date(start + (i * 2 - 2) * 1000).toISOString(),
    })
    rows.push({
      role: 'assistant',
      content: i % 11 === 0
        ? 'We can address revenue strategy and keep the earlier conversation thread available so we can return to it without losing context.'
        : 'Understood. I will preserve the active topic, prior decisions, and the relevant conversational thread while moving the discussion forward.',
      createdAt: new Date(start + (i * 2 - 1) * 1000).toISOString(),
    })
  }
  return rows
}

for (const turns of [20, 30, 50]) {
  describe(`CEO ${turns}-turn certification`, () => {
    test('preserves semantic state and active threads', () => {
      const rows = buildLongConversation(turns)
      const state = deriveCeoConversationState(rows, 'Continue.')
      expect(state.turnCount).toBeGreaterThanOrEqual(turns)
      expect(state.threads.length).toBeGreaterThan(0)
      expect(state.activeThreads.length).toBeGreaterThan(0)
    })

    test('continuation remains resolvable after long context', () => {
      const rows = buildLongConversation(turns)
      const state = deriveCeoConversationState(rows, 'Continue.')
      const reference = resolveConversationReferences('Continue.', rows, state)[0]
      expect(reference).toBeDefined()
      expect(reference?.resolvedText).toBeTruthy()
      expect(reference?.ambiguous).toBe(false)
    })

    test('canonical cognitive context retains world model after long context', () => {
      const rows = buildLongConversation(turns)
      const state = deriveCeoConversationState(rows, 'What did we decide so far?')
      const references = resolveConversationReferences('What did we decide so far?', rows, state)
      const context = buildCanonicalConversationContext({ currentMessage: 'What did we decide so far?', rows, state, references })
      expect(context.worldModel.workingTopic).toBeTruthy()
      expect(context.worldModel.decisions.length).toBeGreaterThan(0)
      expect(context.worldModel.activeThreads.length).toBeGreaterThan(0)
      expect(['contextual', 'deep', 'strategic']).toContain(context.cognitiveDepth)
    })

    test('quality evaluation remains usable after long context', () => {
      const rows = buildLongConversation(turns)
      const result = scoreCeoConversationQuality({
        objective: 'What did we decide so far?',
        content: 'We decided to improve reference resolution as the next focus while preserving memory and response quality as connected priorities. We also agreed to return to the CEO conversation after any temporary topic switch.',
        priorTurns: rows,
      })
      expect(result.continuity).toBeGreaterThanOrEqual(60)
      expect(result.relevance).toBeGreaterThanOrEqual(50)
    })
  })
}
