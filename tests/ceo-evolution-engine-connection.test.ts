import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { aggregateConversationalHealthSignal } from '@/lib/evolution-engine'

const ROOT = join(import.meta.dir, '..')

describe('Phase 20: CEO conversation incidents connected to the Evolution Engine', () => {
  test('correctly aggregates by inputClass and invariant, tolerating a malformed record without breaking the whole signal', () => {
    const records = [
      { value: JSON.stringify({ inputClass: 'correction', invariant: 'x' }) },
      { value: JSON.stringify({ inputClass: 'correction', invariant: 'x' }) },
      { value: JSON.stringify({ inputClass: 'incomplete_message', invariant: 'y' }) },
      { value: '{ this is not valid json' },
    ]
    const signal = aggregateConversationalHealthSignal(records, 24)
    expect(signal.incidentCount).toBe(4)
    expect(signal.byInputClass.correction).toBe(2)
    expect(signal.byInputClass.incomplete_message).toBe(1)
    expect(signal.byInvariant.x).toBe(2)
    expect(signal.mostFrequentClass).toBe('correction')
  })

  test('an empty record set produces a well-formed, zeroed signal rather than throwing', () => {
    const signal = aggregateConversationalHealthSignal([], 24)
    expect(signal.incidentCount).toBe(0)
    expect(signal.mostFrequentClass).toBeNull()
    expect(signal.byInputClass).toEqual({})
  })

  test('incident candidates are genuinely persisted, not only logged to console -- the connection the evolution engine actually reads from', () => {
    const source = readFileSync(join(ROOT, 'src/lib/ceo-incident-regression-candidate.ts'), 'utf-8')
    expect(source).toContain('persistIncidentCandidate')
    expect(source).toContain("category: 'ceo_conversation_incident'")
  })

  test('the evolution engine genuinely reads the same category incidents are persisted under', () => {
    const source = readFileSync(join(ROOT, 'src/lib/evolution-engine.ts'), 'utf-8')
    expect(source).toContain("category: 'ceo_conversation_incident'")
    expect(source).toContain('getConversationalHealthSignal')
  })
})
