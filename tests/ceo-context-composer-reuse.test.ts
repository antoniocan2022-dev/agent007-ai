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
// This file (composeCeoContext) transitively requires Prisma to load (ceo-context-composer.ts ->
// canonical-organization-prompt.ts -> canonical-runtime-manifest.ts -> capability-runtime-state.ts ->
// db.ts), a pre-existing dependency unrelated to this change -- confirmed by tracing the import chain
// directly. Cannot execute in this sandbox; will run in real CI.
//
// composeCeoContext is now async (semantic memory recovery can make a real embeddings call -- see
// ceo-memory-embeddings.ts) -- every call site below awaits it.

const rows = [
  { role: 'user' as const, content: 'Hello there', createdAt: 0 },
  { role: 'assistant' as const, content: 'Hi! How can I help?', createdAt: 1 },
]

describe('Track 2: composeCeoContext reuseSemanticContext is behaviorally transparent', () => {
  test('canonicalSemanticContext/conversationState/resolvedReferences are identical whether reused or recomputed from the same inputs', async () => {
    const seed = await composeCeoContext({ systemPrompt: 'sys', currentUserMessage: 'Tell me about the second thing.', persistedMessages: rows, memories: [] })
    const recomputed = await composeCeoContext({ systemPrompt: 'sys', currentUserMessage: 'Tell me about the second thing.', persistedMessages: rows, memories: [], modules: { organization: 'ORG TEXT' } })
    const reused = await composeCeoContext({ systemPrompt: 'sys', currentUserMessage: 'Tell me about the second thing.', persistedMessages: rows, memories: [], modules: { organization: 'ORG TEXT' }, reuseSemanticContext: { conversationState: seed.conversationState, canonicalSemanticContext: seed.canonicalSemanticContext, resolvedReferences: seed.resolvedReferences } })
    expect(JSON.stringify(reused.canonicalSemanticContext)).toBe(JSON.stringify(recomputed.canonicalSemanticContext))
    expect(JSON.stringify(reused.conversationState)).toBe(JSON.stringify(recomputed.conversationState))
    expect(JSON.stringify(reused.resolvedReferences)).toBe(JSON.stringify(recomputed.resolvedReferences))
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

  test('reuse also carries selectedMemories through, avoiding a redundant semantic-recovery pass on the second/third call', async () => {
    const memories = [{ key: 'goal-1', value: 'financial independence objective', category: 'goal', updatedAt: 0 }]
    const seed = await composeCeoContext({ systemPrompt: 'sys', currentUserMessage: 'financial independence objective update', persistedMessages: rows, memories })
    expect(seed.selectedMemories.map((memory) => memory.key)).toContain('goal-1')
    const reused = await composeCeoContext({ systemPrompt: 'sys', currentUserMessage: 'financial independence objective update', persistedMessages: rows, memories, modules: { organization: 'ORG TEXT' }, reuseSemanticContext: { conversationState: seed.conversationState, canonicalSemanticContext: seed.canonicalSemanticContext, resolvedReferences: seed.resolvedReferences, selectedMemories: seed.selectedMemories } })
    expect(reused.selectedMemories).toBe(seed.selectedMemories)
    expect(reused.selectedMemoryKeys).toEqual(seed.selectedMemoryKeys)
  })
})
