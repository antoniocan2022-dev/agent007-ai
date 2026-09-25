import { describe, expect, test } from 'bun:test'
import {
  assertCeoEvidenceContractInvariant,
  deriveEvidenceProfile,
  normalizeCeoEvidenceContract,
  type CeoExecutionContract,
} from '@/lib/ceo-cognitive-contract'
import { buildExternalEvidencePlan } from '@/lib/ceo-evidence-planner'
import { preRouteCeoRequest } from '@/lib/ceo-pre-router'
import { shouldRecoverEvidenceBeforeProvider } from '@/lib/ceo-cognitive-lifecycle'

const user = (content: string) => [{ role: 'user' as const, content }]

describe('CEO evidence contract integrity', () => {
  test('derives the canonical public-equity profile from the domain', () => {
    expect(deriveEvidenceProfile('public_equity')).toBe('public_equity')
    const contradictory: CeoExecutionContract = {
      intent: 'research',
      evidenceClass: 'external_web',
      domain: 'public_equity',
      operation: 'research',
      temporalScope: 'current',
      evidenceProfile: 'none',
      evidenceRequirement: 'multi_source',
      executionRequirement: 'multi_source',
      orchestrationOwner: 'ceo_lifecycle',
      maxTurns: 8,
      maxRecoveries: 2,
      latencyBudgetMs: 120000,
      toolRequired: true,
      subagentsRequired: false,
      reason: 'test',
    }
    expect(normalizeCeoEvidenceContract(contradictory).evidenceProfile).toBe('public_equity')
    expect(() => assertCeoEvidenceContractInvariant(contradictory)).toThrow(/public_equity external_web/)
  })

  test('the exact GEOS/MIND request preserves the equity profile at the routing boundary', () => {
    const decision = preRouteCeoRequest(user('can you give me updates about 2 stocks, GEOS and MIND tecnology, in your own words.'))
    expect(decision.executionContract.intent).toBe('research')
    expect(decision.executionContract.domain).toBe('public_equity')
    expect(decision.executionContract.evidenceClass).toBe('external_web')
    expect(decision.executionContract.evidenceProfile).toBe('public_equity')
  })

  test('the evidence planner derives equity profile even when the caller passes none', () => {
    const plan = buildExternalEvidencePlan({
      objective: 'give me updates about 2 stocks, GEOS and MIND Technology',
      evidenceClass: 'external_web',
      domain: 'public_equity',
      operation: 'research',
      temporalScope: 'current',
      evidenceProfile: 'none',
    })
    expect(plan.profile).toBe('public_equity')
    expect(plan.queries.some((query) => query.ticker === 'GEOS' && query.purpose === 'market')).toBe(true)
    expect(plan.queries.some((query) => query.ticker === 'MIND' && query.purpose === 'market')).toBe(true)
  })

  test('evidence failures trigger evidence recovery before provider-only recovery', () => {
    const contract: CeoExecutionContract = {
      intent: 'research',
      evidenceClass: 'external_web',
      domain: 'public_equity',
      operation: 'research',
      temporalScope: 'current',
      evidenceProfile: 'public_equity',
      evidenceRequirement: 'multi_source',
      executionRequirement: 'multi_source',
      orchestrationOwner: 'ceo_lifecycle',
      maxTurns: 8,
      maxRecoveries: 2,
      latencyBudgetMs: 120000,
      toolRequired: true,
      subagentsRequired: false,
      reason: 'test',
    }
    expect(shouldRecoverEvidenceBeforeProvider('evidence_insufficient', contract)).toBe(true)
    expect(shouldRecoverEvidenceBeforeProvider('evidence_unavailable', contract)).toBe(true)
    expect(shouldRecoverEvidenceBeforeProvider('provider_error', contract)).toBe(false)
  })
  test('normalization repairs every public-equity trust field, not only a stale profile', () => {
    const contradictory: CeoExecutionContract = {
      intent: 'research', evidenceClass: 'none', domain: 'public_equity', operation: 'research', temporalScope: 'current',
      evidenceProfile: 'general_research', evidenceRequirement: 'none', executionRequirement: 'llm_only',
      orchestrationOwner: 'operational_orchestrator', maxTurns: 1, maxRecoveries: 0, latencyBudgetMs: 15000,
      toolRequired: false, subagentsRequired: false, reason: 'deliberate contradiction',
    }
    const normalized = normalizeCeoEvidenceContract(contradictory)
    expect(normalized.evidenceClass).toBe('external_web')
    expect(normalized.evidenceProfile).toBe('public_equity')
    expect(normalized.evidenceRequirement).toBe('multi_source')
    expect(normalized.executionRequirement).toBe('multi_source')
    expect(normalized.toolRequired).toBe(true)
    expect(normalized.orchestrationOwner).toBe('ceo_lifecycle')
    expect(() => assertCeoEvidenceContractInvariant(normalized)).not.toThrow()
  })

  test('the public-equity planner remains specialized even without a harvested ticker token', () => {
    const plan = buildExternalEvidencePlan({
      objective: 'give me an update about Geospace Technologies',
      evidenceClass: 'external_web', domain: 'public_equity', operation: 'research', temporalScope: 'current', evidenceProfile: 'none',
    })
    expect(plan.profile).toBe('public_equity')
    expect(plan.queries.length).toBeGreaterThanOrEqual(3)
    expect(plan.queries.some((query) => query.sourcePreference === 'sec')).toBe(true)
    expect(plan.queries.some((query) => query.purpose === 'financials')).toBe(true)
  })

  test('recovery code merges fresh evidence and preserves it for final degraded fallback', async () => {
    const lifecycle = await Bun.file(new URL('../src/lib/ceo-cognitive-lifecycle.ts', import.meta.url)).text()
    expect(lifecycle).toContain('const existingSources = request.evidenceBundle?.sources ?? []')
    expect(lifecycle).toContain('sources: [...existingSources, ...recovered.bundle.sources]')
    expect(lifecycle).not.toContain('const recoveredEvidenceContext =')
    expect(lifecycle).toContain('recoveredExternalEvidence: Boolean(recoveredEvidenceContext)')
    const recoveryPlanIndex = lifecycle.indexOf('const evidencePlan = buildExternalEvidencePlan({')
    // Self-repair follow-up (2026-09-25): this now opens with a skipRecoveryGeneration short-circuit
    // (see isFutileStructuralCoverageEscalation's recovery-path wiring) ahead of the original
    // validatedAvailability/availabilityAttempted check, rather than being that check's own first line.
    const providerRecoveryIndex = lifecycle.indexOf('const availabilityCandidates = skipRecoveryGeneration')
    expect(recoveryPlanIndex).toBeGreaterThan(-1)
    expect(providerRecoveryIndex).toBeGreaterThan(-1)
    expect(recoveryPlanIndex).toBeLessThan(providerRecoveryIndex)
  })

  test('the evidence recovery policy is domain-generic while public-equity keeps the specialized profile', () => {
    const marketContract: CeoExecutionContract = {
      intent: 'research', evidenceClass: 'external_web', domain: 'market', operation: 'research', temporalScope: 'current',
      evidenceProfile: 'none', evidenceRequirement: 'external_web', executionRequirement: 'one_tool',
      orchestrationOwner: 'ceo_lifecycle', maxTurns: 4, maxRecoveries: 1, latencyBudgetMs: 30000, toolRequired: true, subagentsRequired: false, reason: 'test',
    }
    expect(shouldRecoverEvidenceBeforeProvider('evidence_insufficient', marketContract)).toBe(true)
    expect(normalizeCeoEvidenceContract(marketContract).evidenceProfile).toBe('market_current')
  })
})
