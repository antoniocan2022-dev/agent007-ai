import { describe, expect, test } from 'bun:test'
import { preRouteCeoRequest } from '@/lib/ceo-pre-router'
import { buildExternalEvidencePlan, extractEquityTickers } from '@/lib/ceo-evidence-planner'
import { buildEvidenceBundle, createEvidenceSource } from '@/lib/ceo-evidence-bundle'
import { verifyClaimEvidence } from '@/lib/ceo-claim-evidence-gate'
import { addEvidenceTraceEvent, completeEvidenceTrace, startEvidenceTrace } from '@/lib/ceo-evidence-trace'

const GEOS_MIND = 'Make a deep analysis of the stocks: Geospace Technologies Corporation (GEOS) and MIND Technology, Inc. (MIND). make a deep comprehension and tell me would you invest in those stock? make me a comprehensible and simple explanation.'

describe('Stage 8 — golden external evidence corpus', () => {
  test('positive golden incident stays on governed public-equity research path', () => {
    const decision = preRouteCeoRequest([{ role: 'user', content: GEOS_MIND }])
    expect(decision.executionContract.domain).toBe('public_equity')
    expect(decision.executionContract.evidenceClass).toBe('external_web')
    expect(decision.executionContract.evidenceRequirement).toBe('multi_source')
    expect(decision.executionContract.toolRequired).toBe(true)
    expect(decision.adaptiveExecutionClass).toBe('deep')
    expect(extractEquityTickers(GEOS_MIND)).toEqual(['GEOS', 'MIND'])
    expect(buildExternalEvidencePlan({ objective: GEOS_MIND, evidenceClass: 'external_web', domain: 'public_equity', operation: 'recommend', temporalScope: 'current', evidenceProfile: 'public_equity' }).minimumSources).toBeGreaterThanOrEqual(3)
  })

  test.each([
    'Analyze whether we should buy a second server',
    'Analyze our stock of spare parts',
    'Review the equity split between co-founders',
    'Analyze our cash flow forecast',
    'Review our earnings report',
    'Hold a review meeting tomorrow',
  ])('negative golden control remains internal: %s', (message) => {
    const decision = preRouteCeoRequest([{ role: 'user', content: message }])
    expect(decision.executionContract.evidenceClass).toBe('internal_state')
    expect(decision.executionContract.domain).not.toBe('public_equity')
  })

  test('claim-aware gate requires real source identity and matching quantitative values', () => {
    const source = createEvidenceSource({ url: 'https://www.sec.gov/Archives/edgar/data/example/filing.htm', title: 'SEC filing', sourceType: 'sec_filing', sourceTier: 1, retrievedAt: Date.now(), publishedAt: Date.now() - 86400000, text: 'Revenue was 100 million dollars and cash was 20 million dollars.' })
    const bundle = buildEvidenceBundle({ profile: 'public_equity', sources: [source], minimumSources: 1, minimumTierOneSources: 1 })
    const sourceId = bundle.sources[0].id
    expect(verifyClaimEvidence(`Revenue was 100 million dollars [${sourceId}].`, bundle).passed).toBe(true)
    expect(() => verifyClaimEvidence('Revenue was 100 million dollars [S1-PLACEHOLDER].', bundle)).toThrow(/ABSTAINED_REQUIRED_EVIDENCE/)
    expect(() => verifyClaimEvidence('Revenue was 250 million dollars based on the same filing.', bundle)).toThrow(/ABSTAINED_REQUIRED_EVIDENCE/)
    expect(() => verifyClaimEvidence('The company announced a new 50 million dollar contract today.', bundle)).toThrow(/ABSTAINED_REQUIRED_EVIDENCE/)
  })

  test('evidence trace is bounded, deterministic in shape, and graded', () => {
    const trace = startEvidenceTrace({ objective: GEOS_MIND, profile: 'public_equity', requestId: 'golden-incident' })
    addEvidenceTraceEvent(trace, 'planned', { queryCount: 7, minimumSources: 3 })
    addEvidenceTraceEvent(trace, 'gate_evaluated', { passed: true, supportedClaims: 4, requiredClaims: 4 })
    const completed = completeEvidenceTrace(trace, 'FULL')
    expect(completed.finalState).toBe('FULL')
    expect(completed.completedAt).toBeDefined()
    expect(completed.events.length).toBe(2)
  })
})
