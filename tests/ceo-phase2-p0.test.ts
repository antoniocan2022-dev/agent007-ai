import { describe, expect, test } from 'bun:test'
import { buildExternalEvidencePlan, extractEquityTickers } from '@/lib/ceo-evidence-planner'
import { buildEvidenceBundle, createEvidenceSource, renderEvidenceBundleForPrompt } from '@/lib/ceo-evidence-bundle'
import {
  assertDecisionGradeEvidence,
  assessDecisionGradeEvidence,
  DecisionGradeEvidenceBlockedError,
  requirementsForDecisionEvidence,
} from '@/lib/ceo-decision-grade-evidence'
import { detectContradictions, renderContradictions } from '@/lib/ceo-contradiction-resolver'
import {
  matchIssuerByName,
  matchIssuerByTicker,
  resolveEquityIssuers,
  resolveIssuerFromMap,
  type SecTickerMap,
} from '@/lib/ceo-issuer-resolution'

// Synthetic registry, no live SEC fetch -- this sandbox has no egress to sec.gov (confirmed directly).
const MOCK_TICKER_MAP: SecTickerMap = {
  GEOS: { cik_str: 940578, title: 'Geospace Technologies Corporation', ticker: 'GEOS' },
  ACMR: { cik_str: 111111, title: 'Acme Robotics Corp', ticker: 'ACMR' },
  ACMS: { cik_str: 222222, title: 'Acme Robotics Systems', ticker: 'ACMS' },
}

describe('P0: issuer/entity resolution (ceo-issuer-resolution.ts)', () => {
  test('exact ticker match resolves a real issuer identity', () => {
    expect(matchIssuerByTicker('geos', MOCK_TICKER_MAP)).toEqual({ ticker: 'GEOS', cik: '0000940578', title: 'Geospace Technologies Corporation' })
  })

  test('an unregistered ticker-shaped query does not resolve', () => {
    expect(matchIssuerByTicker('ZZZZ', MOCK_TICKER_MAP)).toBeNull()
  })

  test('a fuzzy company-name match absorbs a small typo', () => {
    const resolution = resolveIssuerFromMap('Geospce Technologies', MOCK_TICKER_MAP)
    expect(resolution.resolved?.ticker).toBe('GEOS')
    expect(resolution.method).toBe('name_match')
  })

  test('an unrelated name does not fuzzy-match', () => {
    expect(matchIssuerByName('Totally Unrelated Widgets', MOCK_TICKER_MAP)).toEqual([])
  })

  test('an ambiguous company name returns multiple candidates and no single resolution', () => {
    const resolution = resolveIssuerFromMap('Acme Robotics', MOCK_TICKER_MAP)
    expect(resolution.resolved).toBeNull()
    expect(resolution.candidates.length).toBe(2)
    expect(resolution.method).toBe('name_match')
  })

  test('resolveEquityIssuers finds a bare company name that extractEquityTickers structurally cannot', () => {
    const objective = 'Tell me about Geospace Technologies Corporation and whether it is a good long-term investment.'
    expect(extractEquityTickers(objective)).toEqual([])
    const resolutions = resolveEquityIssuers(objective, MOCK_TICKER_MAP)
    expect(resolutions.length).toBe(1)
    expect(resolutions[0].resolved?.ticker).toBe('GEOS')
    expect(resolutions[0].method).toBe('name_match')
  })

  test('resolveEquityIssuers still resolves a real ticker token and does not duplicate a name-matched one', () => {
    const objective = 'Compare Geospace Technologies Corporation (GEOS) against its peers.'
    const resolutions = resolveEquityIssuers(objective, MOCK_TICKER_MAP)
    expect(resolutions.length).toBe(1)
    expect(resolutions[0].resolved?.ticker).toBe('GEOS')
    expect(resolutions[0].method).toBe('ticker_exact')
  })
})

describe('P0: entity resolution wired into evidence planning (ceo-evidence-planner.ts)', () => {
  test('a bare company name with no ticker token only reaches the equity-specific query plan when resolvedIssuers is supplied', () => {
    const objective = 'Tell me about Geospace Technologies Corporation and whether it is a good long-term investment.'
    const resolvedIssuers = resolveEquityIssuers(objective, MOCK_TICKER_MAP)

    const withoutResolution = buildExternalEvidencePlan({ objective, evidenceClass: 'external_web', domain: 'public_equity', operation: 'research', temporalScope: 'current', evidenceProfile: 'public_equity' })
    expect(withoutResolution.queries.some((query) => query.ticker)).toBe(false)

    const withResolution = buildExternalEvidencePlan({ objective, evidenceClass: 'external_web', domain: 'public_equity', operation: 'research', temporalScope: 'current', evidenceProfile: 'public_equity', resolvedIssuers })
    expect(withResolution.queries.some((query) => query.ticker === 'GEOS')).toBe(true)
    expect(withResolution.minimumSources).toBeGreaterThanOrEqual(3)
  })
})

describe('P0: research/decision separation (ceo-decision-grade-evidence.ts)', () => {
  test('the decision dimension and fail-closed policy only apply to the recommend/decide tier', () => {
    const research = requirementsForDecisionEvidence({ domain: 'public_equity', operation: 'research' })
    const decide = requirementsForDecisionEvidence({ domain: 'public_equity', operation: 'decide' })
    expect(research.requiredDimensions).not.toContain('decision')
    expect(decide.requiredDimensions).toContain('decision')
    expect(research.failClosed).toBe(false)
    expect(decide.failClosed).toBe(true)
  })

  // Independent post-merge review fix (2026-09-13): an unspecified operation used to fall to the
  // permissive research tier here, disagreeing with the conservative ("undefined -> treat as decision
  // grade") default this session's other two fail-closed checks -- ceo-claim-evidence-gate.ts's
  // verifyClaimEvidence and ceo-degraded-mode.ts's requiresDecisionGradeAbstention -- both already use.
  // Only a positively-identified non-decision operation should earn the research tier.
  test('an unspecified operation for public_equity defaults to the conservative decision tier, not the permissive research tier', () => {
    const unspecified = requirementsForDecisionEvidence({ domain: 'public_equity' })
    expect(unspecified.failClosed).toBe(true)
    expect(unspecified.requiredDimensions).toContain('decision')
  })

  test('an incomplete research-operation assessment reports honest gaps without throwing', () => {
    const source = createEvidenceSource({ url: 'https://example.com/sparse', title: 'Sparse', sourceType: 'web', sourceTier: 3, retrievedAt: Date.now(), text: 'Some unrelated commentary about the sector in general.' })
    const bundle = buildEvidenceBundle({ profile: 'public_equity', operation: 'research', sources: [source], minimumSources: 1, minimumTierOneSources: 0 })
    const assessment = assertDecisionGradeEvidence({ domain: 'public_equity', operation: 'research', bundle })
    expect(assessment.decisionGrade).toBe(false)
    expect(assessment.failClosed).toBe(false)
    expect(assessment.missingDimensions.length).toBeGreaterThan(0)
  })

  test('the identical incomplete bundle throws for a recommend operation', () => {
    const source = createEvidenceSource({ url: 'https://example.com/sparse2', title: 'Sparse', sourceType: 'web', sourceTier: 3, retrievedAt: Date.now(), text: 'Some unrelated commentary about the sector in general.' })
    const bundle = buildEvidenceBundle({ profile: 'public_equity', operation: 'recommend', sources: [source], minimumSources: 1, minimumTierOneSources: 0 })
    expect(() => assertDecisionGradeEvidence({ domain: 'public_equity', operation: 'recommend', bundle })).toThrow(DecisionGradeEvidenceBlockedError)
  })
})

describe('P0: source-family independence (ceo-evidence-bundle.ts + ceo-decision-grade-evidence.ts)', () => {
  test('a wire-service byline collapses different hosting domains into one source family', () => {
    const a = createEvidenceSource({ url: 'https://www.reuters.com/markets/story', title: 'Reuters wire', sourceType: 'news', sourceTier: 3, retrievedAt: Date.now(), text: '(Reuters) - The company reported revenue of $50 million this quarter.' })
    const b = createEvidenceSource({ url: 'https://finance.yahoo.com/news/story', title: 'Yahoo republication', sourceType: 'news', sourceTier: 4, retrievedAt: Date.now(), text: '-- Reuters Revenue was $50 million this quarter, according to sources.' })
    expect(a.sourceFamily).toBe('reuters')
    expect(b.sourceFamily).toBe('reuters')
    expect(a.publisher).not.toBe(b.publisher)
  })

  test('a source with no wire-service byline falls back to its hosting domain', () => {
    const source = createEvidenceSource({ url: 'https://www.example-aggregator.com/story', title: 'Aggregator', sourceType: 'web', sourceTier: 4, retrievedAt: Date.now(), text: 'The company reported strong results this quarter.' })
    expect(source.sourceFamily).toBe('example-aggregator.com')
  })

  test('four wire-attributed sources across different domains count as only one independent source family', () => {
    const now = Date.now()
    const domains = ['reuters.com', 'finance.yahoo.com', 'example-aggregator.com', 'some-blog.com']
    const sources = domains.map((domain, index) => createEvidenceSource({
      url: `https://${domain}/story-${index}`,
      title: `Story ${index}`,
      sourceType: 'news',
      sourceTier: 3,
      retrievedAt: now,
      text: '(Reuters) - The company reported revenue of $50 million this quarter.',
    }))
    const bundle = buildEvidenceBundle({ profile: 'public_equity', operation: 'research', sources, minimumSources: 4, minimumTierOneSources: 0 })
    const assessment = assessDecisionGradeEvidence({ domain: 'public_equity', operation: 'research', bundle })
    expect(assessment.independentSourceFamilyCount).toBe(1)
    expect(assessment.reasons.some((reason) => reason.toLowerCase().includes('independent source'))).toBe(true)
  })
})

describe('P0: contradiction resolver (ceo-contradiction-resolver.ts)', () => {
  test('a genuine >15% revenue disagreement between two sources is flagged, preferring the higher-tier source', () => {
    const now = Date.now()
    const a = createEvidenceSource({ url: 'https://sec.gov/a', title: 'SEC filing', sourceType: 'sec_filing', sourceTier: 1, retrievedAt: now, publishedAt: now - 1000, text: 'Revenue was $100 million for the quarter.' })
    const b = createEvidenceSource({ url: 'https://example.com/b', title: 'News', sourceType: 'news', sourceTier: 3, retrievedAt: now, publishedAt: now - 500, text: 'Revenue was $130 million for the quarter, sources say.' })
    const contradictions = detectContradictions([a, b])
    expect(contradictions.length).toBe(1)
    expect(contradictions[0].metric).toBe('revenue')
    expect(contradictions[0].preferredSourceId).toBe(a.id)
  })

  test('a small relative difference is not flagged as a contradiction', () => {
    const now = Date.now()
    const a = createEvidenceSource({ url: 'https://sec.gov/a2', title: 'SEC filing', sourceType: 'sec_filing', sourceTier: 1, retrievedAt: now, text: 'Revenue was $100 million for the quarter.' })
    const b = createEvidenceSource({ url: 'https://example.com/b2', title: 'News', sourceType: 'news', sourceTier: 3, retrievedAt: now, text: 'Revenue was $105 million for the quarter.' })
    expect(detectContradictions([a, b]).length).toBe(0)
  })

  test('buildEvidenceBundle wires real contradiction detection into claim candidates (previously always dead)', () => {
    const now = Date.now()
    const a = createEvidenceSource({ url: 'https://sec.gov/c1', title: 'SEC filing', sourceType: 'sec_filing', sourceTier: 1, retrievedAt: now, text: 'Revenue was $100 million for the quarter.' })
    const b = createEvidenceSource({ url: 'https://example.com/c2', title: 'News report', sourceType: 'news', sourceTier: 3, retrievedAt: now, text: 'Revenue was $140 million for the quarter, according to estimates.' })
    const bundle = buildEvidenceBundle({ profile: 'general_research', sources: [a, b], minimumSources: 2, minimumTierOneSources: 0 })
    expect(bundle.contradictions.length).toBe(1)
    const contradictoryClaims = bundle.claims.filter((claim) => claim.state === 'contradictory')
    expect(contradictoryClaims.length).toBeGreaterThan(0)
    for (const claim of contradictoryClaims) expect(claim.contradictionSourceIds?.length ?? 0).toBeGreaterThan(0)
  })

  test('renderEvidenceBundleForPrompt discloses contradictions when present and omits the block when absent', () => {
    const now = Date.now()
    const a = createEvidenceSource({ url: 'https://sec.gov/d1', title: 'SEC filing', sourceType: 'sec_filing', sourceTier: 1, retrievedAt: now, text: 'Revenue was $100 million for the quarter.' })
    const b = createEvidenceSource({ url: 'https://example.com/d2', title: 'News report', sourceType: 'news', sourceTier: 3, retrievedAt: now, text: 'Revenue was $140 million for the quarter, according to estimates.' })
    const contradictoryBundle = buildEvidenceBundle({ profile: 'general_research', sources: [a, b], minimumSources: 2, minimumTierOneSources: 0 })
    expect(renderEvidenceBundleForPrompt(contradictoryBundle)).toContain('CONTRADICTIONS DETECTED')

    const cleanSource = createEvidenceSource({ url: 'https://example.com/clean', title: 'Clean', sourceType: 'news', sourceTier: 3, retrievedAt: now, text: 'The company announced a new product line today.' })
    const cleanBundle = buildEvidenceBundle({ profile: 'general_research', sources: [cleanSource], minimumSources: 1, minimumTierOneSources: 0 })
    expect(cleanBundle.contradictions.length).toBe(0)
    expect(renderEvidenceBundleForPrompt(cleanBundle)).not.toContain('CONTRADICTIONS DETECTED')
  })

  test('renderContradictions renders an empty string for no contradictions', () => {
    expect(renderContradictions([])).toBe('')
  })
})
