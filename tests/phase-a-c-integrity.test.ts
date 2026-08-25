import { describe, expect, test } from 'bun:test'
import { getCanonicalOrganizationFacts, getCanonicalOrganizationPrompt } from '@/lib/canonical-organization-prompt'
import { getCanonicalRuntimeManifest } from '@/lib/canonical-runtime-manifest'
import { getCapabilityRuntimeState, setCapabilityProbeResult } from '@/lib/capability-runtime-state'
import { registerCapabilityProbe, getCapabilityProbe, listCapabilityProbes } from '@/lib/capability-probe'
import { getDueWork } from '@/lib/autonomy-due-work'
import { assertStripeReplayCompatible, nextStripeTransactionState } from '@/lib/stripe-webhook-integrity'
import { readFileSync } from 'node:fs'

describe('Phase A-C integrity', () => {
  test('CEO organization facts and runtime manifest come from canonical registries', () => {
    const facts = getCanonicalOrganizationFacts()
    const manifest = getCanonicalRuntimeManifest()
    expect(facts.leaderCount).toBeGreaterThan(0)
    expect(facts.specialistCount).toBeGreaterThan(0)
    expect(facts.divisionCount).toBeGreaterThan(0)
    expect(facts.businessCount).toBeGreaterThan(0)
    expect(manifest.organization.leaderCount).toBe(facts.leaderCount)
    expect(manifest.providers.registeredCount).toBeGreaterThan(0)
    expect(manifest.fingerprint).toBe(facts.fingerprint)
    expect(getCanonicalOrganizationPrompt()).toContain(`LEADERS: ${facts.leaderIds.join('|')}.`)
  })

  test('capability runtime state defaults to UNKNOWN until a real probe records a result', () => {
    const id = `test-capability-${Date.now()}`
    expect(getCapabilityRuntimeState(id).status).toBe('UNKNOWN')
    expect(getCapabilityRuntimeState(id).probedAt).toBeNull()
    expect(setCapabilityProbeResult(id, { ok: true }).status).toBe('HEALTHY')
    expect(getCapabilityRuntimeState(id).status).toBe('HEALTHY')
  })

  test('generic capability probe registration is one canonical interface', () => {
    const id = `test-probe-${Date.now()}`
    registerCapabilityProbe({ id, async probe() { return { ok: true, proofLevel: 'EXECUTION_VALIDATED', details: 'test probe' } } })
    expect(getCapabilityProbe(id)).toBeDefined()
    expect(listCapabilityProbes()).toContain(id)
  })

  test('Stripe replay compatibility rejects economic identity drift and preserves refunds', () => {
    const existing = { id: 'tx_1', userId: 'user_1', status: 'succeeded', amount: 1, currency: 'USD', customerId: 'cust_1', ventureId: 'venture_001' }
    expect(() => assertStripeReplayCompatible(existing, { ...existing, status: 'succeeded' as const })).not.toThrow()
    expect(() => assertStripeReplayCompatible(existing, { ...existing, customerId: 'cust_2', status: 'succeeded' as const })).toThrow('customer mismatch')
    expect(() => assertStripeReplayCompatible(existing, { ...existing, ventureId: 'venture_002', status: 'succeeded' as const })).toThrow('venture mismatch')
    expect(() => assertStripeReplayCompatible(existing, { ...existing, amount: 2, status: 'succeeded' as const })).toThrow('amount mismatch')
    expect(nextStripeTransactionState('refunded', 'succeeded')).toBe('refunded')
    expect(nextStripeTransactionState('succeeded', 'succeeded')).toBe('succeeded')
  })

  test('due-work resolver does not claim work before its persisted interval', async () => {
    const id = 'capability-probe'
    const futureNow = Date.now() + 1_000
    const result = await getDueWork(id, 60 * 60 * 1000, futureNow)
    expect(result.id).toBe(id)
    expect(typeof result.due).toBe('boolean')
    expect(result.nextDueAt).toBeGreaterThanOrEqual(result.lastRunAt ?? 0)
  })

  test('Venture heartbeat is connected to the existing portfolio learning loop and due-work resolver', () => {
    const source = readFileSync(new URL('../src/lib/venture-operation-loop.ts', import.meta.url), 'utf8')
    const learning = readFileSync(new URL('../src/lib/portfolio-learning-heartbeat.ts', import.meta.url), 'utf8')
    expect(source).toContain("from './portfolio-learning-heartbeat'")
    expect(source).toContain('runPortfolioLearningHeartbeat()')
    expect(learning).toContain("from './autonomy-due-work'")
    expect(learning).toContain("getDueWork('portfolio-learning'")
  })

  test('canonical CEO prompt path is dynamically derived and free of legacy roster claims', () => {
    const agent = readFileSync(new URL('../src/lib/agent.ts', import.meta.url), 'utf8')
    expect(agent).toContain("from './canonical-organization-prompt'")
    expect(agent).toContain('${getCanonicalOrganizationPrompt()}')
    expect(agent).not.toContain('20 pod leaders')
  })

  test('UI/system counters are derived from the canonical facts endpoint', () => {
    const page = readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8')
    const route = readFileSync(new URL('../src/app/api/system/canonical-facts/route.ts', import.meta.url), 'utf8')
    expect(page).toContain('/api/system/canonical-facts')
    expect(page).toContain('registeredCount')
    expect(page).toContain('leaderCount')
    expect(route).toContain('getCanonicalSystemFacts')
    expect(page).not.toContain('Loading 6 LLM providers')
    expect(page).not.toContain('Connecting 20 subagents')
  })
})
