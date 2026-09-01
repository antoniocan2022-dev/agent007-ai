import { describe, expect, test } from 'bun:test'
import { deriveCeoConversationState } from '@/lib/ceo-conversation-state'
import { extractEnumeratedItems, resolveActiveThread, resolveOrdinalReference, resolveGeneralReference } from '@/lib/ceo-reference-resolution'
import { getCeoVentureEvidenceForObjective } from '@/lib/ceo-venture-state'

type Row = { role: 'user' | 'assistant'; content: string; createdAt: number }
const t = (n: number) => Date.UTC(2026, 7, 30, 12, n)
const row = (role: Row['role'], content: string, minute: number): Row => ({ role, content, createdAt: t(minute) })

describe('CEO conversation completion contracts', () => {
  test('groups semantically continuous messages into one lifecycle thread', () => {
    const rows = [
      row('user', 'We need to improve the CEO conversation architecture.', 0),
      row('assistant', 'The main gap is semantic reference resolution.', 1),
      row('user', 'We should strengthen reference resolution before adding more tools.', 2),
    ]
    const state = deriveCeoConversationState(rows, 'Continue.')
    expect(state.schemaVersion).toBe(4)
    expect(state.threads.length).toBe(1)
    expect(state.threads[0]?.status).toBe('active')
  })

  test('topic shift pauses the prior thread', () => {
    const rows = [
      row('user', 'We need better conversation continuity.', 0),
      row('assistant', 'The resolver should preserve active context.', 1),
      row('user', 'Instead, let us discuss production deployment safety.', 2),
    ]
    const state = deriveCeoConversationState(rows, 'Continue.')
    expect(state.threads.some((thread) => thread.status === 'paused' || thread.status === 'superseded')).toBe(true)
  })

  test('ordinal resolution stays inside the latest coherent list', () => {
    const rows = [row('assistant', 'Old list:\n1. A\n2. B', 0), row('assistant', 'Current list:\n1. C\n2. D\n3. E', 1)]
    const items = extractEnumeratedItems(rows)
    expect(items.at(-1)?.text).toBe('E')
    expect(resolveOrdinalReference('What about the second option?', rows)?.resolvedText).toBe('D')
  })

  test('ambiguous references remain unresolved', () => {
    const rows = [row('assistant', 'We discussed memory.', 0), row('assistant', 'We discussed provider routing.', 1), row('user', 'Both are important.', 2)]
    const result = resolveGeneralReference('What about it?', rows, 'Both are important.')
    expect(result?.ambiguous).toBe(true)
    expect(result?.resolvedText).toBeNull()
  })

  test('ordinary conversational objectives do not trigger venture-state reads', async () => {
    expect(await getCeoVentureEvidenceForObjective('Hi, how are you?')).toBeNull()
    expect(await getCeoVentureEvidenceForObjective('Thanks, that sounds good.')).toBeNull()
  })

  test('continuation requires an active or paused thread', () => {
    const state = deriveCeoConversationState([row('user', 'We should finish the conversation system.', 0)], 'Continue.')
    const result = resolveActiveThread('Continue.', state.threads)
    expect(result?.resolvedText).toBeTruthy()
    expect(result?.ambiguous).toBe(false)
  })
})
