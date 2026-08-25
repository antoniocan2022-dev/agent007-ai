import { describe, expect, test } from 'bun:test'
import { getCanonicalOrganizationFacts, getCanonicalOrganizationPrompt } from '@/lib/canonical-organization-prompt'
import { getCapabilityRuntimeState, setCapabilityProbeResult } from '@/lib/capability-runtime-state'
import { assertStripeReplayCompatible, nextStripeTransactionState } from '@/lib/stripe-webhook-integrity'
import { readFileSync } from 'node:fs'

describe('Phase A-C integrity', () => {
  test('CEO organization facts come from the canonical organization graph', () => {
    const facts = getCanonicalOrganizationFacts()
    expect(facts.leaderCount).toBeGreaterThan(0)
    expect(facts.specialistCount).toBeGreaterThan(0)
    expect(facts.divisionCount).toBeGreaterThan(0)
    expect(facts.businessCount).toBeGreaterThan(0)
    expect(getCanonicalOrganizationPrompt()).toContain(`LEADERS: ${facts.leaderIds.join('|')}.`)
  })

  test('capability runtime state defaults to UNKNOWN until a real probe records a result', () => {
    const id = `test-capability-${Date.now()}`
    expect(getCapabilityRuntimeState(id).status).toBe('UNKNOWN')
    expect(getCapabilityRuntimeState(id).probedAt).toBeNull()
    expect(setCapabilityProbeResult(id, { ok: true }).status).toBe('HEALTHY')
    expect(getCapabilityRuntimeState(id).status).toBe('HEALTHY')
  })

  test('Stripe replay compatibility rejects economic identity drift', () => {
    const existing = { id: 'tx_1', userId: 'user_1', status: 'succeeded', amount: 1, currency: 'USD', customerId: 'cust_1', ventureId: 'venture_001' }
    expect(() => assertStripeReplayCompatible(existing, { ...existing, status: 'succeeded' as const })).not.toThrow()
    expect(() => assertStripeReplayCompatible(existing, { ...existing, customerId: 'cust_2', status: 'succeeded' as const })).toThrow('customer mismatch')
    expect(() => assertStripeReplayCompatible(existing, { ...existing, ventureId: 'venture_002', status: 'succeeded' as const })).toThrow('venture mismatch')
    expect(nextStripeTransactionState('refunded', 'succeeded')).toBe('refunded')
  })

  test('Venture heartbeat is connected to the existing portfolio learning loop', () => {
    const source = readFileSync(new URL('../src/lib/venture-operation-loop.ts', import.meta.url), 'utf8')
    expect(source).toContain("from './portfolio-learning-heartbeat'")
    expect(source).toContain('runPortfolioLearningHeartbeat()')
  })

  test('fast CEO lane and canonical bridge both inject canonical organization context', () => {
    const bridge = readFileSync(new URL('../src/lib/agent-canonical-bridge.ts', import.meta.url), 'utf8')
    const route = readFileSync(new URL('../src/app/api/agent/route.ts', import.meta.url), 'utf8')
    expect(bridge).toContain('getCanonicalOrganizationPrompt')
    expect(route).toContain('getCanonicalOrganizationPrompt')
  })
})
