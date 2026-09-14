import { describe, expect, test } from 'bun:test'
import { composeCeoContext } from '@/lib/ceo-context-composer'

// Track 2 slice: route.ts calls composeCeoContext up to three times per request with identical
// currentUserMessage/persistedMessages/memories/semanticInterpretation across the second and third
// calls -- the only inputs canonicalSemanticContext (and the conversationState/references it's built
// from) actually depends on. That was proven by reading composeCeoContext's implementation directly:
// canonicalSemanticContext never consults `modules`. This locks in that proof as a regression test and
// certifies the new reuseSemanticContext option is behaviorally transparent -- it must produce byte-
// identical semantic output while still correctly reflecting new modules in the rendered messages.
//
// This file (composeCeoContext) transitively imports Prisma (ceo-context-composer.ts ->
// canonical-organization-prompt.ts -> canonical-runtime-manifest.ts -> capability-runtime-state.ts ->
// db.ts) -- the local Prisma client stub loads fine for these tests since none of the scenarios
// below actually touch the database, so this file does run locally (confirmed by direct
// execution, not just import-chain tracing).
//
// composeCeoContext is now async (semantic memory recovery can make a real embeddings call -- see
// ceo-memory-embeddings.ts) -- every call site below awaits it.

const rows = [
  { role: 'user' as const, content: 'Hello there', createdAt: 0 },
  { role: 'assistant' as const, content: 'Hi! How can I help?', createdAt: 1 },
]

// deriveCeoConversationState() (ceo-conversation-state.ts) stamps its result with
// `updatedAt: Date.now()` -- legitimately different on every independent call, reused or not.
// Comparing raw JSON.stringify output below was flaky: if a millisecond boundary elapsed between
// the `seed` and `recomputed` calls, `updatedAt` alone would differ even though every semantically
// meaningful field was identical. This strips volatile timestamp fields before comparing.
function stableJson(value: unknown): string {
  return JSON.stringify(value, (key, val) => (key === 'updatedAt' ? undefined : val))
}

describe('Track 2: composeCeoContext reuseSemanticContext is behaviorally transparent', () => {
  test('canonicalSemanticContext/conversationState/resolvedReferences are identical whether reused or recomputed from the same inputs', async () => {
    const seed = await composeCeoContext({ systemPrompt: 'sys', currentUserMessage: 'Tell me about the second thing.', persistedMessages: rows, memories: [] })
    const recomputed = await composeCeoContext({ systemPrompt: 'sys', currentUserMessage: 'Tell me about the second thing.', persistedMessages: rows, memories: [], modules: { organization: 'ORG TEXT' } })
    const reused = await composeCeoContext({ systemPrompt: 'sys', currentUserMessage: 'Tell me about the second thing.', persistedMessages: rows, memories: [], modules: { organization: 'ORG TEXT' }, reuseSemanticContext: { conversationState: seed.conversationState, canonicalSemanticContext: seed.canonicalSemanticContext, resolvedReferences: seed.resolvedReferences } })
    expect(stableJson(reused.canonicalSemanticContext)).toBe(stableJson(recomputed.canonicalSemanticContext))
    expect(stableJson(reused.conversationState)).toBe(stableJson(recomputed.conversationState))
    expect(stableJson(reused.resolvedReferences)).toBe(stableJson(recomputed.resolvedReferences))
  })

  test('reuse skips recomputation -- the returned canonicalSemanticContext is the exact same object reference passed in, not a freshly rebuilt equivalent', async () => {
    const seed = await composeCeoContext({ systemPrompt: 'sys', currentUserMessage: 'Tell me about the second thing.', persistedMessages: rows, memories: [] })
    const reused = await composeCeoContext({ systemPrompt: 'sys', currentUserMessage: 'Tell me about the second thing.', persistedMessages: rows, memories: [], modules: { organization: 'ORG TEXT' }, reuseSemanticContext: { conversationState: seed.conversationState, canonicalSemanticContext: seed.canonicalSemanticContext, resolvedReferences: seed.resolvedReferences } })
    expect(reused.canonicalSemanticContext).toBe(seed.canonicalSemanticContext)
  })

  test('messages still correctly reflect the new modules even when the semantic context is reused', async () => {
    const seed = await composeCeoContext({ systemPrompt: 'sys', currentUserMessage: 'Tell me about the second thing.', persistedMessages: rows, memories: [] })
    const reused = await composeCeoContext({ systemPrompt: 'sys', currentUserMessage: 'Tell me about the second thing.', persistedMessages: rows, memories: [], modules: { organization: 'ORG TEXT' }, reuseSemanticContext: { conversationState: seed.conversationState, canonicalSemanticContext: seed.canonicalSemanticContext, resolvedReferences: seed.resolvedReferences } })
    expect(reused.messages.some((message) => message.content.includes('ORG TEXT'))).toBe(true)
    expect(reused.modules).toContain('organization')
    expect(seed.modules).not.toContain('organization')
  })

  test('reuse also works correctly when an ordinal reference is present -- the exact case Track 1 fixed downstream', async () => {
    const listRows = [
      { role: 'assistant' as const, content: 'Options:\n1. Keep current model.\n2. Use stronger CEO model.', createdAt: 0 },
    ]
    const seed = await composeCeoContext({ systemPrompt: 'sys', currentUserMessage: 'What about the second option?', persistedMessages: listRows, memories: [] })
    const recomputed = await composeCeoContext({ systemPrompt: 'sys', currentUserMessage: 'What about the second option?', persistedMessages: listRows, memories: [], modules: { organization: 'ORG TEXT' } })
    const reused = await composeCeoContext({ systemPrompt: 'sys', currentUserMessage: 'What about the second option?', persistedMessages: listRows, memories: [], modules: { organization: 'ORG TEXT' }, reuseSemanticContext: { conversationState: seed.conversationState, canonicalSemanticContext: seed.canonicalSemanticContext, resolvedReferences: seed.resolvedReferences } })
    expect(seed.canonicalSemanticContext.references[0]?.resolvedText).toBe('Use stronger CEO model.')
    expect(JSON.stringify(reused.canonicalSemanticContext.references)).toBe(JSON.stringify(recomputed.canonicalSemanticContext.references))
  })

  // CI fix: this fixture (repeated in the three tests below) used category: 'goal', but
  // ceo-memory-visibility.ts's fail-closed allowlist only permits 'user_goal' -- 'goal' isn't a
  // real category anywhere in this codebase. filterConversationalMemories silently dropped the
  // memory before it ever reached ranking, so selectedMemories was always [] regardless of the
  // lexical/semantic match this test is actually about. This file could not run in the sandbox
  // this was written in (see the file header), so the mismatch was never caught until it first
  // ran in real CI. The two tests that only compare seed vs. reused (both consistently empty)
  // passed vacuously; only the two asserting real, non-empty content caught it.
  test('reuse also carries selectedMemories through, avoiding a redundant semantic-recovery pass on the second/third call', async () => {
    const memories = [{ key: 'goal-1', value: 'financial independence objective', category: 'user_goal', updatedAt: 0 }]
    const seed = await composeCeoContext({ systemPrompt: 'sys', currentUserMessage: 'financial independence objective update', persistedMessages: rows, memories })
    expect(seed.selectedMemories.map((memory) => memory.key)).toContain('goal-1')
    const reused = await composeCeoContext({ systemPrompt: 'sys', currentUserMessage: 'financial independence objective update', persistedMessages: rows, memories, modules: { organization: 'ORG TEXT' }, reuseSemanticContext: { conversationState: seed.conversationState, canonicalSemanticContext: seed.canonicalSemanticContext, resolvedReferences: seed.resolvedReferences, selectedMemories: seed.selectedMemories } })
    expect(reused.selectedMemories).toBe(seed.selectedMemories)
    expect(reused.selectedMemoryKeys).toEqual(seed.selectedMemoryKeys)
  })

  // Audit fix: semantically-recovered memories were rendered with identical presentation to exact
  // lexical matches -- no confidence/provenance distinction was visible to the model, even though a
  // similarity-based recall is inherently fuzzier and more prone to being tangentially or wrongly
  // related than an exact token match. semanticMemoryKeys now carries that distinction end to end.
  test('semanticMemoryKeys reports no matches for an exact lexical hit, and the rendered memory line carries no fuzzy-match caveat', async () => {
    const memories = [{ key: 'goal-1', value: 'financial independence objective', category: 'user_goal', updatedAt: 0 }]
    const seed = await composeCeoContext({ systemPrompt: 'sys', currentUserMessage: 'financial independence objective update', persistedMessages: rows, memories })
    expect(seed.semanticMemoryKeys).toEqual([])
    const memoryLine = seed.messages.find((message) => message.content.includes('SELECTED MEMORY'))?.content
    expect(memoryLine).toContain('goal-1')
    expect(memoryLine).not.toContain('related by topic')
  })

  test('reuse carries semanticMemoryKeys through unchanged, not just selectedMemories', async () => {
    const memories = [{ key: 'goal-1', value: 'financial independence objective', category: 'user_goal', updatedAt: 0 }]
    const seed = await composeCeoContext({ systemPrompt: 'sys', currentUserMessage: 'financial independence objective update', persistedMessages: rows, memories })
    const reused = await composeCeoContext({ systemPrompt: 'sys', currentUserMessage: 'financial independence objective update', persistedMessages: rows, memories, modules: { organization: 'ORG TEXT' }, reuseSemanticContext: { conversationState: seed.conversationState, canonicalSemanticContext: seed.canonicalSemanticContext, resolvedReferences: seed.resolvedReferences, selectedMemories: seed.selectedMemories, semanticMemoryKeys: seed.semanticMemoryKeys } })
    expect(reused.semanticMemoryKeys).toEqual(seed.semanticMemoryKeys)
  })

  // Audit fix: route.ts's second composeCeoContext call (once semanticInterpretation becomes available)
  // was still recomputing selectedMemories from scratch via a full rankMemories pass, even though memory
  // selection depends only on memories/queryTokens/queryText -- none of which semanticInterpretation
  // touches -- while conversationState/canonicalSemanticContext genuinely must be rebuilt for that call
  // to fold semanticInterpretation in. reuseSemanticContext now supports reusing selectedMemories alone,
  // independent of the other three fields, so a caller isn't forced into an all-or-nothing choice.
  test('selectedMemories can be reused on their own, independent of conversationState/canonicalSemanticContext, which are correctly recomputed fresh', async () => {
    const memories = [{ key: 'goal-1', value: 'financial independence objective', category: 'user_goal', updatedAt: 0 }]
    const seed = await composeCeoContext({ systemPrompt: 'sys', currentUserMessage: 'financial independence objective update', persistedMessages: rows, memories })
    const partiallyReused = await composeCeoContext({ systemPrompt: 'sys', currentUserMessage: 'financial independence objective update', persistedMessages: rows, memories, semanticInterpretation: { source: 'model_assisted' }, reuseSemanticContext: { selectedMemories: seed.selectedMemories, semanticMemoryKeys: seed.semanticMemoryKeys } })
    // selectedMemories reused byte-identically (same object reference, not recomputed)...
    expect(partiallyReused.selectedMemories).toBe(seed.selectedMemories)
    // ...while canonicalSemanticContext/conversationState are genuinely fresh objects, not carried over,
    // since this call did not pass them in reuseSemanticContext.
    expect(partiallyReused.canonicalSemanticContext).not.toBe(seed.canonicalSemanticContext)
    expect(partiallyReused.conversationState).not.toBe(seed.conversationState)
  })
})
