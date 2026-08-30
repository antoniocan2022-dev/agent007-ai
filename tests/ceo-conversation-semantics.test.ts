import { describe, expect, test } from 'bun:test'
import { deriveCeoConversationState, resolveConversationReferences } from '@/lib/ceo-conversation-state'
import { evaluateCeoQuality } from '@/lib/ceo-response-quality-gate'

const row = (role: 'user' | 'assistant', content: string, createdAt: string | number) => ({ role, content, createdAt })

describe('CEO conversational semantic contracts', () => {
  test('resolves the second item from an explicit numbered list', () => {
    const rows = [row('assistant', 'Options:\n1. Keep the current provider policy.\n2. Add a dedicated CEO conversation priority.\n3. Replace the routing layer.', Date.UTC(2026, 7, 30, 12, 0))]
    const refs = resolveConversationReferences('What about the second option?', rows, deriveCeoConversationState(rows, 'What about the second option?'))
    expect(refs).toHaveLength(1)
    expect(refs[0]?.resolvedText).toContain('dedicated CEO conversation priority')
    expect(refs[0]?.confidence).toBeGreaterThan(0.9)
  })

  test('resolves last/other from a numbered list and continue from the active thread', () => {
    const rows = [row('assistant', 'Ideas:\n1. Improve memory.\n2. Improve routing.\n3. Improve response quality.', Date.UTC(2026, 7, 30, 12, 0)), row('user', 'Let\'s continue the CEO conversation.', Date.UTC(2026, 7, 30, 12, 1))]
    const state = deriveCeoConversationState(rows, 'Continue.')
    const last = resolveConversationReferences('What about the last one?', rows, state)
    const cont = resolveConversationReferences('Continue.', rows, state)
    expect(last[0]?.resolvedText).toContain('Improve response quality')
    expect(cont[0]?.resolvedText).toBeTruthy()
    expect(cont[0]?.phrase.toLowerCase()).toBe('continue')
  })

  test('resolves yesterday only to an actual prior calendar day when history exists', () => {
    const rows = [
      row('user', 'Yesterday we were discussing long-context memory.', Date.UTC(2026, 7, 29, 18, 0)),
      row('assistant', 'We decided memory should be semantic and episodic.', Date.UTC(2026, 7, 29, 18, 1)),
      row('user', 'What did we decide yesterday?', Date.UTC(2026, 7, 30, 8, 0)),
    ]
    const refs = resolveConversationReferences('What did we decide yesterday?', rows, deriveCeoConversationState(rows, 'What did we decide yesterday?'))
    expect(refs[0]?.resolvedText).toContain('semantic and episodic')
    expect(refs[0]?.confidence).toBeGreaterThan(0.85)
  })

  test('quality evaluation fails closed when intent is omitted and the request makes a live claim', () => {
    const result = evaluateCeoQuality({
      objective: 'What is your current production status?',
      content: 'The current production runtime is verified and serving traffic.',
      path: 'fast',
      externalExecutionSucceeded: true,
      evidenceProvided: false,
    })
    expect(result.decision).not.toBe('PASS')
    expect(result.checks.evidenceDiscipline).toBe(false)
  })
})
