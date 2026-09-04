import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { filterConversationalMemories, isConversationalMemoryVisible } from '../src/lib/ceo-memory-visibility'
import { buildRiskAbstention, requiresDecisionGradeAbstention } from '../src/lib/ceo-degraded-mode'
import { sanitizeCeoErrorForUser } from '../src/lib/ceo-response-composer'

describe('CEO P0 integrity', () => {
  it('blocks control-plane memory from conversational context', () => {
    const internal = [
      { key: 'ceo_recommendation_abc', value: '{}', category: 'ceo_recommendation' },
      { key: 'ceo_conversation_incident_abc', value: '{}', category: 'ceo_conversation_incident' },
      { key: 'evidence_trace_abc', value: '{}', category: 'evidence_trace' },
      { key: 'ceo_observed_outcome:abc', value: '{}', category: 'ceo_observed_outcome' },
    ]
    for (const item of internal) expect(isConversationalMemoryVisible(item)).toBe(false)
    expect(filterConversationalMemories([
      ...internal,
      { key: 'user_goal_business', value: 'Build a sustainable business', category: 'user_goal' },
    ])).toEqual([{ key: 'user_goal_business', value: 'Build a sustainable business', category: 'user_goal' }])
  })

  it('requires both high risk and an evidence failure before hard abstention', () => {
    expect(requiresDecisionGradeAbstention({ objective: 'Reflect on my decision-making', domain: 'general_web', failureReason: 'evidence_insufficient' })).toBe(false)
    expect(requiresDecisionGradeAbstention({ objective: 'Review Agent007 architecture', domain: 'technical_architecture', failureReason: 'evidence_unavailable' })).toBe(false)
    expect(requiresDecisionGradeAbstention({ objective: 'Should I buy this stock?', domain: 'public_equity', failureReason: 'evidence_insufficient' })).toBe(true)
    expect(requiresDecisionGradeAbstention({ objective: 'Should I buy this stock?', domain: 'public_equity', failureReason: 'provider_error' })).toBe(false)
    expect(requiresDecisionGradeAbstention({ objective: 'Should I buy this stock?', domain: 'public_equity', failureReason: 'production_verification_failure' })).toBe(true)
  })

  it('renders risk abstention without exposing machine labels', () => {
    const response = buildRiskAbstention('Should I buy this stock?', 'ABSTAINED_REQUIRED_EVIDENCE: decision-grade evidence is incomplete. Need Tier-1 source')
    expect(response.content).not.toContain('ABSTAINED_REQUIRED_EVIDENCE')
    expect(response.content).not.toContain('Tier-1')
    expect(response.content).toContain('responsible decision-grade answer')
  })

  it('converts raw internal errors into safe user-facing language', () => {
    expect(sanitizeCeoErrorForUser(new Error('ABSTAINED_REQUIRED_EVIDENCE: decision-grade evidence is incomplete. Need at least 1 independent Tier-1 source'))).not.toContain('ABSTAINED_REQUIRED_EVIDENCE')
    expect(sanitizeCeoErrorForUser(new Error('database connection string secret'))).not.toContain('database connection string secret')
  })

  it('keeps the API route behind one safe error formatter', () => {
    const route = readFileSync(join(process.cwd(), 'src/app/api/agent/route.ts'), 'utf8')
    expect(route).toContain("import { sanitizeCeoErrorForUser } from '@/lib/ceo-response-composer'")
    expect(route).toContain('message: sanitizeCeoErrorForUser(e)')
    expect(route).not.toContain('message: e?.message ?? String(e)')
  })
})
