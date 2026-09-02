import { describe, expect, test } from 'bun:test'
import { deriveCeoConversationState } from '@/lib/ceo-conversation-state'
import { buildWorldStateSnapshot, computeWorldStateDelta } from '@/lib/ceo-world-state'

const t = (n: number) => Date.UTC(2026, 7, 30, 12, n)
const row = (role: 'user' | 'assistant', content: string, minute: number) => ({ role, content, createdAt: t(minute) })

describe('Structured world-state records and WorldStateDelta', () => {
  const baseRows = [
    row('user', 'We are building Agent007 into a strong executive partner.', 0),
    row('assistant', 'The priority is stronger conversation quality.', 1),
    row('user', "Let's decide to use architecture priority one before adding new tools.", 2),
    row('assistant', 'Understood, prioritizing architecture work first.', 3),
  ]

  test('a decision is recorded as active with real source/confidence metadata', () => {
    const state = deriveCeoConversationState(baseRows, 'What did we decide?')
    const snapshot = buildWorldStateSnapshot(state, baseRows)
    const decision = snapshot.decisions.find((record) => record.text.includes('architecture priority one'))
    expect(decision).toBeDefined()
    expect(decision?.status).toBe('active')
    expect(decision?.source).toBe('user')
    expect(decision?.confidence).toBeGreaterThan(0.5)
  })

  test('an explicit correction supersedes an overlapping earlier decision rather than just adding a new one', () => {
    const correctedRows = [...baseRows, row('user', 'No, I meant we should prioritize tools before architecture instead.', 4)]
    const state = deriveCeoConversationState(correctedRows, 'What did we decide now?')
    const snapshot = buildWorldStateSnapshot(state, correctedRows)
    const original = snapshot.decisions.find((record) => record.text.includes('architecture priority one'))
    expect(original?.status).toBe('superseded')
  })

  test('WorldStateDelta reports the new correction and the newly-superseded decision from a single turn', () => {
    const correctedRows = [...baseRows, row('user', 'No, I meant we should prioritize tools before architecture instead.', 4)]
    const delta = computeWorldStateDelta(baseRows, correctedRows, 'What did we decide now?')
    expect(delta.newCorrections.length).toBeGreaterThan(0)
    expect(delta.newlySuperseded.some((record) => record.text.includes('architecture priority one'))).toBe(true)
  })

  test('an unrelated later message does not falsely supersede an earlier decision', () => {
    const unrelatedRows = [...baseRows, row('user', 'By the way, what time zone are we using for deadlines?', 4)]
    const state = deriveCeoConversationState(unrelatedRows, 'What time zone?')
    const snapshot = buildWorldStateSnapshot(state, unrelatedRows)
    const original = snapshot.decisions.find((record) => record.text.includes('architecture priority one'))
    expect(original?.status).toBe('active')
  })

  test('a fresh conversation with no history produces empty, well-formed record arrays rather than throwing', () => {
    const state = deriveCeoConversationState([], 'Hello')
    const snapshot = buildWorldStateSnapshot(state, [])
    expect(snapshot.decisions).toEqual([])
    expect(snapshot.goals).toEqual([])
    expect(snapshot.schemaVersion).toBe(1)
  })

  test('conversation history alone is a sufficient recovery source: identical rows always reconstruct identical world state, with no hidden mutable state anywhere', () => {
    const a = buildWorldStateSnapshot(deriveCeoConversationState(baseRows, 'What did we decide?'), baseRows)
    const b = buildWorldStateSnapshot(deriveCeoConversationState(baseRows, 'What did we decide?'), baseRows)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    // A structurally-identical but distinct array (simulating a fresh reload from persisted rows,
    // with no shared object identity or cached state) reconstructs the exact same snapshot.
    const freshRows = baseRows.map((r) => ({ ...r }))
    const c = buildWorldStateSnapshot(deriveCeoConversationState(freshRows, 'What did we decide?'), freshRows)
    expect(JSON.stringify(a)).toBe(JSON.stringify(c))
  })
})
