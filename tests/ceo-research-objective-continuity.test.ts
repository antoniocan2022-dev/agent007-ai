import { describe, expect, test } from 'bun:test'
import { preRouteCeoRequest } from '../src/lib/ceo-pre-router'
import { buildCeoDecisionPlan } from '../src/lib/ceo-cognitive-kernel'
import { buildExternalEvidencePlan } from '../src/lib/ceo-evidence-planner'
import { buildEvidenceBundle, createEvidenceSource } from '../src/lib/ceo-evidence-bundle'
import { verifyClaimEvidence } from '../src/lib/ceo-claim-evidence-gate'
import { certifyCeoEvidenceRun } from '../src/lib/ceo-evidence-certification'
import type { ResearchObjectiveIdentity } from '../src/lib/ceo-research-objective'
import { shouldContinueResearchObjective } from '../src/lib/ceo-research-objective'

const objective: ResearchObjectiveIdentity = {
  id: 'obj_test_geos_mind',
  version: 3,
  status: 'active',
  lifecycleState: 'CONTINUED',
  domain: 'public_equity',
  evidenceProfile: 'public_equity',
  operation: 'research',
  temporalScope: 'current',
  objectiveAnchor: 'Research GEOS and MIND Technology',
  currentObjective: 'Research GEOS and MIND Technology with current market, financial, filing, news, and risk context.',
  tickers: ['GEOS', 'MIND'],
  issuers: [],
}

describe('durable public-equity objective continuity', () => {
  test('recognizes natural short follow-up and rejects unrelated topic', () => {
    expect(shouldContinueResearchObjective('ok, go ahead with general context on those company', objective)).toBe(true)
    expect(shouldContinueResearchObjective('let\'s check the deployment in Vercel', objective)).toBe(false)
  })

  test('forces public-equity research routing from the durable objective', () => {
    const preRoute = preRouteCeoRequest(
      [{ role: 'user', content: 'ok, go ahead with general context on those company' }],
      0,
      undefined,
      undefined,
      objective,
    )
    expect(preRoute.executionContract.intent).toBe('research')
    expect(preRoute.executionContract.domain).toBe('public_equity')
    expect(preRoute.executionContract.evidenceClass).toBe('external_web')
    expect(preRoute.executionContract.researchObjective?.id).toBe(objective.id)
    expect(preRoute.routingObjective).toContain('GEOS')
  })

  test('uses durable objective as the decision-plan objective instead of the short follow-up', () => {
    const preRoute = preRouteCeoRequest(
      [{ role: 'user', content: 'ok, go ahead with general context on those company' }],
      0,
      undefined,
      undefined,
      objective,
    )
    const plan = buildCeoDecisionPlan({ messages: [{ role: 'user', content: 'ok, go ahead with general context on those company' }], preRoute })
    expect(plan.objective).toContain('GEOS')
    expect(plan.objective).toContain('MIND')
    expect(plan.researchObjective?.id).toBe(objective.id)
  })
})

describe('objective-bound evidence planning and certification', () => {
  test('uses durable tickers when the current turn contains no ticker', () => {
    const plan = buildExternalEvidencePlan({
      objective: 'general context on those companies',
      evidenceClass: 'external_web',
      domain: 'public_equity',
      operation: 'research',
      temporalScope: 'current',
      evidenceProfile: 'public_equity',
      researchObjective: objective,
    })
    const plannedTickers = [...new Set(plan.queries.flatMap((query) => query.ticker ? [query.ticker] : []))]
    expect(plannedTickers).toEqual(expect.arrayContaining(['GEOS', 'MIND']))
    expect(plan.researchObjective?.id).toBe(objective.id)
  })

  test('requires coverage for every objective entity', () => {
    const geos = createEvidenceSource({ id: 'geos', url: 'https://data.sec.gov/geos', title: 'GEOS SEC', sourceType: 'sec_companyfacts', sourceTier: 1, text: 'GEOS revenue 100', relatedEntities: ['GEOS'], retrievedAt: Date.now() })
    const mind = createEvidenceSource({ id: 'mind', url: 'https://data.sec.gov/mind', title: 'MIND SEC', sourceType: 'sec_companyfacts', sourceTier: 1, text: 'MIND revenue 200', relatedEntities: ['MIND'], retrievedAt: Date.now() })
    const incomplete = buildEvidenceBundle({ profile: 'public_equity', operation: 'research', sources: [geos], minimumSources: 1, requiredEntities: ['GEOS', 'MIND'] })
    const complete = buildEvidenceBundle({ profile: 'public_equity', operation: 'research', sources: [geos, mind], minimumSources: 2, requiredEntities: ['GEOS', 'MIND'] })
    expect(incomplete.sufficient).toBe(false)
    expect(incomplete.entityCoverage?.find((item) => item.entity === 'MIND')?.sufficient).toBe(false)
    expect(complete.sufficient).toBe(true)
  })

  test('rejects a public-equity claim supported only by another ticker', () => {
    const geos = createEvidenceSource({ id: 'geos', url: 'https://example.com/geos', title: 'GEOS', sourceType: 'web', sourceTier: 2, text: 'GEOS revenue 100', relatedEntities: ['GEOS'], retrievedAt: Date.now() })
    const mind = createEvidenceSource({ id: 'mind', url: 'https://example.com/mind', title: 'MIND', sourceType: 'web', sourceTier: 2, text: 'MIND revenue 200', relatedEntities: ['MIND'], retrievedAt: Date.now() })
    const bundle = buildEvidenceBundle({ profile: 'public_equity', operation: 'research', sources: [geos, mind], minimumSources: 2, requiredEntities: ['GEOS', 'MIND'] })
    const result = verifyClaimEvidence('GEOS revenue was 200 [mind]', bundle)
    expect(result.passed).toBe(false)
    expect(result.claims[0]?.supported).toBe(false)
  })

  test('certification fails closed when one entity is missing', () => {
    const geos = createEvidenceSource({ id: 'geos', url: 'https://example.com/geos', title: 'GEOS', sourceType: 'web', sourceTier: 1, text: 'GEOS current market evidence', relatedEntities: ['GEOS'], retrievedAt: Date.now() })
    const bundle = buildEvidenceBundle({ profile: 'public_equity', operation: 'research', sources: [geos], minimumSources: 1, requiredEntities: ['GEOS', 'MIND'] })
    const plan = buildExternalEvidencePlan({
      objective: objective.currentObjective,
      evidenceClass: 'external_web',
      domain: 'public_equity',
      operation: 'research',
      temporalScope: 'current',
      evidenceProfile: 'public_equity',
      researchObjective: objective,
    })
    const report = certifyCeoEvidenceRun({
      objective,
      plan,
      execution: { bundle, attemptedQueries: 1, successfulQueries: 1, pageReads: 0 },
      trace: { traceId: 'trace', requestId: 'obj_test_geos_mind', objective: objective.currentObjective, profile: 'public_equity', startedAt: Date.now(), events: [], objectiveId: objective.id, objectiveVersion: objective.version, tickers: objective.tickers, finalState: 'PARTIAL' },
    })
    expect(report.certified).toBe(false)
    expect(report.metrics.missingEntities).toContain('MIND')
  })
})
