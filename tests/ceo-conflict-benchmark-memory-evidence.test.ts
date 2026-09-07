import { describe, expect, test } from 'bun:test'
import { composeCeoContext } from '@/lib/ceo-context-composer'

// Conflict benchmark 2 of 4 ("make Agent007 feel like Claude" arbitration audit; benchmarks 3-4 live in
// ceo-conflict-benchmarks.test.ts, separated because composeCeoContext transitively requires Prisma
// (-> canonical-organization-prompt.ts -> db.ts) and would otherwise prevent the other two, Prisma-free
// scenarios from running in this sandbox at all).
//
// Memory vs. evidence: the system has no fact-checking capability -- scoreCeoConversationRubric's 8
// dimensions check internal self-consistency and objective-relevance, not correctness against external
// reality, so no existing scorer can mechanically prove "the CEO chose the fresher of two conflicting
// facts." What CAN be verified without a live model call is the structural precondition for that choice
// to be made correctly: does composeCeoContext keep memory and evidence distinctly labeled (never merged
// into one undifferentiated block, never demoting evidence to memory's "not factual proof" framing) when
// both are present together for the same request. This is real but partial: it proves the prompt gives
// the model what it needs to distinguish them, not that the model actually does -- that would require a
// live LLM call this sandbox cannot make (no MISTRAL_API_KEY, no outbound network access).
//
// Cannot execute in this sandbox (Cannot find module '@prisma/client'); runs in real CI, same as every
// other composeCeoContext test in this suite.
describe('Conflict benchmark 2: memory and evidence stay structurally distinct when both are present', () => {
  test('a stored (potentially stale) memory and freshly supplied evidence are never merged or conflated in the composed prompt', async () => {
    const composition = await composeCeoContext({
      systemPrompt: 'You are Agent007.',
      currentUserMessage: 'What are our competitors charging right now?',
      persistedMessages: [
        { role: 'user', content: 'Our main competitor prices at $99/mo.', createdAt: 0 },
        { role: 'assistant', content: 'Understood, noted for planning.', createdAt: 1 },
      ],
      memories: [{ key: 'competitor-pricing', value: 'Main competitor prices at $99/mo.', category: 'general', updatedAt: 0 }],
      modules: { evidence: 'Fresh search result (today): main competitor now prices at $79/mo, effective this month.' },
    })
    const memoryBlock = composition.messages.find((message) => message.content.includes('SELECTED MEMORY'))
    const evidenceBlock = composition.messages.find((message) => message.content.includes('EVIDENCE CONTEXT'))
    expect(memoryBlock).toBeTruthy()
    expect(evidenceBlock).toBeTruthy()
    // Distinct messages, not one merged block -- the model receives them as separately labeled inputs.
    expect(memoryBlock).not.toBe(evidenceBlock)
    expect(memoryBlock?.content).toContain('context only; not factual proof')
    expect(evidenceBlock?.content).toContain('provenance required')
    // Evidence must never inherit memory's "not factual proof" caveat -- that would erase the exact
    // distinction this benchmark exists to check for.
    expect(evidenceBlock?.content).not.toContain('not factual proof')
    expect(evidenceBlock?.content).toContain('$79/mo')
  })
})
