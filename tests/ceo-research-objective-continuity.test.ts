import { describe, expect, test } from 'bun:test'
import { preRouteCeoRequest } from '../src/lib/ceo-pre-router'
import { buildCeoDecisionPlan } from '../src/lib/ceo-cognitive-kernel'
import { buildExternalEvidencePlan } from '../src/lib/ceo-evidence-planner'
import { buildEvidenceBundle, createEvidenceSource } from '../src/lib/ceo-evidence-bundle'
import { verifyClaimEvidence } from '../src/lib/ceo-claim-evidence-gate'
import { certifyCeoEvidenceRun } from '../src/lib/ceo-evidence-certification'
import type { ResearchObjectiveIdentity } from '../src/lib/ceo-research-objective'
import { shouldContinueResearchObjective, mergedResearchObjectiveEntities, extractResearchObjectiveTickers } from '../src/lib/ceo-research-objective'

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
    expect(shouldContinueResearchObjective('ok, go ahead', objective)).toBe(false)
    expect(shouldContinueResearchObjective('let\'s continue with our deployment', objective)).toBe(false)
    expect(shouldContinueResearchObjective('go ahead with more financial analysis', objective)).toBe(true)
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

// Production audit fix (2026-09-24): ensureResearchObjective (ceo-research-objective.ts) used to
// persist the tracked ticker/issuer set ONLY on a version-bumping write (CORRECTED/REFINED) -- an
// ordinary continuation wrote {lifecycleState, lastTurnSequence, updatedAt} only, silently discarding
// any newly-contributed ticker. "Continue the research, and also check MIND" on an active GEOS
// objective resolves to lifecycleState 'CONTINUED' (not a version bump), so MIND was never written --
// the durable objective stayed frozen at ['GEOS'], and ceo-evidence-certification.ts's
// entityCoverageSatisfied check (which iterates exactly objective.tickers) then never required any
// evidence coverage for MIND at all. mergedResearchObjectiveEntities is the extracted pure function
// that now backs every continuation write, version-bumping or not -- these tests exercise it directly
// since this codebase has no precedent for mocking the Prisma transaction it runs inside.
describe('mergedResearchObjectiveEntities: the tracked entity set never silently drops an entity', () => {
  test('a newly-mentioned ticker is unioned into the existing set, not discarded', () => {
    const active = { tickersJson: JSON.stringify(['GEOS']), issuersJson: JSON.stringify([]) }
    const candidate = { tickers: ['GEOS', 'MIND'], issuers: [] }
    const merged = mergedResearchObjectiveEntities(active, candidate)
    expect(merged.tickers).toEqual(expect.arrayContaining(['GEOS', 'MIND']))
  })

  test('a candidate reporting only the new ticker (not re-including the existing one) still preserves the existing ticker', () => {
    const active = { tickersJson: JSON.stringify(['GEOS']), issuersJson: JSON.stringify([]) }
    const candidate = { tickers: ['MIND'], issuers: [] }
    const merged = mergedResearchObjectiveEntities(active, candidate)
    expect(merged.tickers).toEqual(expect.arrayContaining(['GEOS', 'MIND']))
  })

  test('issuers merge the same way and stay deduplicated', () => {
    const active = { tickersJson: JSON.stringify(['GEOS']), issuersJson: JSON.stringify(['GEOS Inc']) }
    const candidate = { tickers: ['GEOS'], issuers: ['GEOS Inc', 'MIND Technology'] }
    const merged = mergedResearchObjectiveEntities(active, candidate)
    // unique() normalizes/uppercases every entry (existing behavior, unchanged by this fix).
    expect(merged.issuers).toEqual(expect.arrayContaining(['GEOS INC', 'MIND TECHNOLOGY']))
    expect(merged.issuers.filter((issuer) => issuer === 'GEOS INC')).toHaveLength(1)
  })

  test('an empty active set (first continuation after establishment) is not required for the merge to work', () => {
    const active = { tickersJson: JSON.stringify([]), issuersJson: JSON.stringify([]) }
    const candidate = { tickers: ['GEOS'], issuers: [] }
    expect(mergedResearchObjectiveEntities(active, candidate).tickers).toEqual(['GEOS'])
  })
})

// Production audit fix (2026-09-24): the acronym exclusion list only covered a handful of the
// all-caps 2-5 letter tokens that show up in ordinary equity-research prose -- ESG, IPO, GDP, CPI,
// ROI, YOY, COGS, USA and similar were all missing, so a sentence merely discussing e.g. "the
// company's ESG risk profile" could get misread as a real stock ticker and pollute the durable
// objective's tracked entity list.
describe('extractResearchObjectiveTickers: common business acronyms are not misread as tickers', () => {
  test.each(['ESG', 'IPO', 'GDP', 'CPI', 'ROI', 'ROE', 'YOY', 'COGS', 'USA', 'GAAP', 'FDA', 'CAGR', 'ARR', 'MRR', 'GDPR'])(
    '%s is excluded even when it appears as a standalone all-caps token',
    (acronym) => {
      expect(extractResearchObjectiveTickers(`We reviewed the company's ${acronym} figures for this quarter.`)).not.toContain(acronym)
    },
  )

  test('a real ticker alongside excluded acronyms is still extracted', () => {
    const tickers = extractResearchObjectiveTickers('GEOS reported strong ESG scores and an improving ROI this quarter.')
    expect(tickers).toContain('GEOS')
    expect(tickers).not.toContain('ESG')
    expect(tickers).not.toContain('ROI')
  })
})
