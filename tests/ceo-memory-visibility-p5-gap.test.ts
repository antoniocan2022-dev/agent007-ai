import { describe, expect, test } from 'bun:test'
import { isConversationalMemoryVisible, getInternalOnlyMemoryCategories } from '@/lib/ceo-memory-visibility'

describe('Deep P5 audit: governed_evolution_cycle memory-visibility gap', () => {
  test('governed_evolution_cycle records (introduced by ceo-continuous-loop.ts runGovernedEvolutionCycle) are excluded from conversational memory', () => {
    expect(isConversationalMemoryVisible({ key: 'governed_evolution_1788600000', category: 'governed_evolution_cycle' })).toBe(false)
  })

  test('the category is explicitly registered, not only caught incidentally by the pattern fallback', () => {
    expect(getInternalOnlyMemoryCategories()).toContain('governed_evolution_cycle')
  })

  test('the widened pattern fallback also catches unregistered future categories containing "cycle" or "governed", without breaking legitimate conversational categories', () => {
    expect(isConversationalMemoryVisible({ key: 'some_new_governed_thing_1', category: 'some_new_governed_thing' })).toBe(false)
    expect(isConversationalMemoryVisible({ key: 'mission_key_1', category: 'mission' })).toBe(true)
    expect(isConversationalMemoryVisible({ key: 'business_context_1', category: 'business_context' })).toBe(true)
    expect(isConversationalMemoryVisible({ key: 'user_preference_1', category: 'user_preference' })).toBe(true)
  })
})
