import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { aggregateConversationalHealthSignal, checkPolicies } from '@/lib/evolution-engine'

describe('Canonical Evolution Engine integrity', () => {
  test('health reporting uses persisted audit records instead of an empty placeholder', () => {
    const source = readFileSync('src/lib/evolution-engine.ts', 'utf8')
    expect(source).toContain("category: 'executive_audit'")
    expect(source).toContain('const audits = parseRecords(auditRecords)')
    expect(source).not.toContain('function audits3(')
  })

  test('legacy autonomous active evolution implementation is retired', () => {
    const source = readFileSync('src/lib/evolution-engine.ts', 'utf8')
    expect(source).not.toContain('runActiveEvolutionCycle')
    expect(source).not.toContain('analyzeRecommendation(')
  })

  test('learning quality is based on validated and promoted learning candidates', () => {
    const source = readFileSync('src/lib/evolution-engine.ts', 'utf8')
    expect(source).toContain("category: 'behavioral_learning_candidate'")
    expect(source).toContain("candidate.validation?.result === 'PASS'")
    expect(source).toContain("candidate.status === 'PROMOTED'")
    expect(source).not.toContain('memoryWrites + healingEvents')
  })

  test('conversation health aggregation remains deterministic and resilient', () => {
    const signal = aggregateConversationalHealthSignal([
      { value: JSON.stringify({ inputClass: 'decision', invariant: 'evidence' }) },
      { value: JSON.stringify({ inputClass: 'decision', invariant: 'evidence' }) },
      { value: '{malformed' },
    ], 24)
    expect(signal.incidentCount).toBe(3)
    expect(signal.byInputClass).toEqual({ decision: 2 })
    expect(signal.byInvariant).toEqual({ evidence: 2 })
    expect(signal.mostFrequentClass).toBe('decision')
  })

  test('organizational policies still fail closed for the guarded cases', () => {
    expect(checkPolicies({ missionGoal: 'invest', proposedLeaders: [], hasDebate: false, isFinancial: true, riskScore: 9, hasMemoryRetry: false, hasWebSearchFirst: true })).toHaveLength(3)
    expect(checkPolicies({ missionGoal: 'read', proposedLeaders: ['echo'], hasDebate: true, isFinancial: true, riskScore: 1, hasMemoryRetry: false, hasWebSearchFirst: false })).toHaveLength(0)
  })
})
