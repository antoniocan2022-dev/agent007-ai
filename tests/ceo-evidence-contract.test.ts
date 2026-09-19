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
})
