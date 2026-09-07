import { describe, expect, test } from 'bun:test'
import { decisionMemoryKey, deriveEpisodicDecisionWrites, EPISODIC_DECISION_CATEGORY } from '@/lib/ceo-episodic-memory'

describe('decisionMemoryKey: stable, content-derived, no I/O', () => {
  test('the same decision text always produces the same key', () => {
    const a = decisionMemoryKey('We decided to use Postgres for storage.')
    const b = decisionMemoryKey('We decided to use Postgres for storage.')
    expect(a).toBe(b)
  })

  test('trivial whitespace/case differences still produce the same key', () => {
    const a = decisionMemoryKey('We decided to use Postgres for storage.')
    const b = decisionMemoryKey('  we decided to use postgres for storage.  ')
    expect(a).toBe(b)
  })

  test('different decision text produces a different key', () => {
    const a = decisionMemoryKey('We decided to use Postgres for storage.')
    const b = decisionMemoryKey('We decided to use MongoDB for storage.')
    expect(a).not.toBe(b)
  })

  test('key is namespaced so it cannot collide with an unrelated Memory category', () => {
    expect(decisionMemoryKey('anything')).toStartWith('episodic:decision:')
  })
})

describe('deriveEpisodicDecisionWrites: pure derivation, no database', () => {
  test('current decisions become upserts under the decision category, keyed by their own text', () => {
    const writes = deriveEpisodicDecisionWrites({ decisions: ['We decided to prioritize revenue recovery first.'], supersededDecisions: [] })
    expect(writes.upserts).toHaveLength(1)
    expect(writes.upserts[0]?.category).toBe(EPISODIC_DECISION_CATEGORY)
    expect(writes.upserts[0]?.value).toBe('We decided to prioritize revenue recovery first.')
    expect(writes.upserts[0]?.key).toBe(decisionMemoryKey('We decided to prioritize revenue recovery first.'))
    expect(writes.deletes).toHaveLength(0)
  })

  test('superseded decisions become deletes under the exact same key a prior upsert for that text would have used -- so the delete actually finds the row', () => {
    const text = 'We decided to prioritize revenue recovery first.'
    const writes = deriveEpisodicDecisionWrites({ decisions: [], supersededDecisions: [text] })
    expect(writes.deletes).toHaveLength(1)
    expect(writes.deletes[0]?.key).toBe(decisionMemoryKey(text))
  })

  test('a decision that is both newly current and something else is superseded in the same turn -- both writes are derived independently', () => {
    const writes = deriveEpisodicDecisionWrites({
      decisions: ['We decided to use the operations kit first.'],
      supersededDecisions: ['We decided to use revenue recovery first.'],
    })
    expect(writes.upserts).toHaveLength(1)
    expect(writes.deletes).toHaveLength(1)
    expect(writes.upserts[0]?.key).not.toBe(writes.deletes[0]?.key)
  })

  test('caps upserts at the last 6 current decisions, matching CeoConversationState.decisions\' own cap', () => {
    const decisions = Array.from({ length: 9 }, (_, index) => `Decision number ${index}.`)
    const writes = deriveEpisodicDecisionWrites({ decisions, supersededDecisions: [] })
    expect(writes.upserts).toHaveLength(6)
    // keeps the most recent 6, not the first 6
    expect(writes.upserts.map((write) => write.value)).toEqual(decisions.slice(-6))
  })

  test('empty state derives no writes at all', () => {
    const writes = deriveEpisodicDecisionWrites({ decisions: [], supersededDecisions: [] })
    expect(writes.upserts).toHaveLength(0)
    expect(writes.deletes).toHaveLength(0)
  })
})
