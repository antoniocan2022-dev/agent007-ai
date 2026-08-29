import { describe, expect, test } from 'bun:test'
import { preRouteCeoRequest } from '@/lib/ceo-pre-router'
import { evaluateCeoQuality } from '@/lib/ceo-response-quality-gate'
import { readFileSync } from 'node:fs'

describe('CEO governance applicability', () => {
  test('does not let a short equity action bypass governed research/action handling', () => {
    const decision = preRouteCeoRequest([{ role: 'user', content: 'Buy GEOS.' }])
    expect(decision.executionContract.evidenceClass).toBe('external_web')
    expect(decision.executionContract.toolRequired).toBe(true)
    expect(decision.route).toBe('full')
  })

  test('preserves internal short actions as operational rather than public-equity research', () => {
    const decision = preRouteCeoRequest([{ role: 'user', content: 'Buy API credits.' }])
    expect(decision.executionContract.evidenceClass).not.toBe('external_web')
    expect(decision.executionContract.orchestrationOwner).toBe('operational_orchestrator')
    expect(decision.executionContract.toolRequired).toBe(true)
  })

  test('keeps conversational quality checks while skipping evidence verification for a true casual turn', () => {
    const result = evaluateCeoQuality({
      objective: 'How do you do?',
      content: 'I am doing well and ready to help. How are things going with you?',
      path: 'fast',
      externalExecutionSucceeded: true,
      evidenceVerificationApplicable: false,
    })
    expect(result.decision).toBe('PASS')
    expect(result.checks.objectiveCoverage).toBe(true)
    expect(result.checks.internalConsistency).toBe(true)
    expect(result.checks.evidenceDiscipline).toBe(true)
  })

  test('uses the canonical context composer in the production agent route', () => {
    const route = readFileSync('src/app/api/agent/route.ts', 'utf8')
    expect(route).toContain("from '@/lib/ceo-context-composer'")
    expect(route).toContain('composeCeoContext')
    expect(route).toContain('loadConversationContext')
    expect(route).toContain('db.conversation.findUnique')
    expect(route).toContain('db.memory.findMany')
  })
})
