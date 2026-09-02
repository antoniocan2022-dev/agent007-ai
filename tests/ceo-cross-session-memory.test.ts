import { describe, expect, test } from 'bun:test'
import { storePersistentMemory, recallPersistentMemory } from '@/lib/persistent-memory'
import { deriveCeoConversationState } from '@/lib/ceo-conversation-state'
import { buildCanonicalConversationContext } from '@/lib/ceo-cognitive-conversation'

describe('Cross-session memory certification', () => {
  test('a preference established in one session is retrieved and reaches the canonical context in a completely unrelated later session', async () => {
    // Session A: the user establishes a durable preference. No special handling -- this is exactly
    // how the rest of the codebase already calls storePersistentMemory.
    const memoryKey = `test-business-direction-${Date.now()}`
    await storePersistentMemory(memoryKey, 'The user decided Revenue Recovery is the strongest starting point for the first business line.', 'decision', 80)

    // Session B: a fresh conversation with zero shared rows and an indirect, not verbatim, query.
    const recalled = await recallPersistentMemory('which business line should we focus on first', 5)
    const match = recalled.find((entry) => entry.key === memoryKey)
    expect(match).toBeDefined()
    expect(match?.value).toContain('Revenue Recovery')

    // The recalled memory must actually reach the canonical context that would inform the response
    // -- not just be retrievable in isolation. This is the real end-to-end chain: store -> recall
    // -> durableMemoryKeys in the world model that downstream generation consumes.
    const freshState = deriveCeoConversationState([], 'Which business line should we focus on first?')
    const context = buildCanonicalConversationContext({
      currentMessage: 'Which business line should we focus on first?',
      rows: [],
      state: freshState,
      references: [],
      memories: recalled.map((entry) => ({ key: entry.key, value: entry.value, category: entry.category, updatedAt: entry.createdAt })),
    })
    expect(context.worldModel.durableMemoryKeys).toContain(memoryKey)
  })

  test('an unrelated memory from a different topic is not pulled into a query that has nothing to do with it', async () => {
    const unrelatedKey = `test-unrelated-topic-${Date.now()}`
    await storePersistentMemory(unrelatedKey, 'The user prefers dark mode in the dashboard UI.', 'preference', 50)
    const recalled = await recallPersistentMemory('which business line should we focus on first', 5)
    expect(recalled.some((entry) => entry.key === unrelatedKey)).toBe(false)
  })
})
