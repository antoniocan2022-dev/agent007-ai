import type { EvidenceBundle, EvidenceSource } from './ceo-evidence-bundle'
import { evidencePolicyFor } from './architecture-integrity-contract'

export type DecisionEvidenceDimension =
  | 'issuer_identity'
  | 'market_data'
  | 'financials'
  | 'cash_debt'
  | 'filings'
  | 'recent_events'
  | 'catalysts'
  | 'risks'
  | 'valuation'
  | 'decision'

export interface DecisionGradeEvidenceRequirements {
  policy: 'NONE' | 'REQUIRED' | 'DECISION_GRADE'
  minimumSources: number
  minimumIndependentTierOneSources: number
  // Deep-audit fix (P0, 2026-09-13): independentTierOneCount only ever counted distinct DOMAINS among
  // tier-1 (SEC-only) sources -- Reuters/Yahoo Finance/a blog/an aggregator all quoting the same wire
  // story were, and remain, always four distinct URLs at tier 3/4 and were never checked for shared
  // origin at all. This is a separate, additive requirement across every tier using sourceFamily (see
  // ceo-evidence-bundle.ts) -- a wire-service byline detected in the article text counts as the SAME
  // family regardless of which domain hosts it, so four re-publications of one Reuters story now count
  // as one independent family, not four independent sources.
  minimumIndependentSourceFamilies: number
  maxAgeMs: number
  requiredDimensions: readonly DecisionEvidenceDimension[]
  claimVerificationRequired: boolean
  failClosed: boolean
}

export interface DecisionGradeEvidenceAssessment {
  decisionGrade: boolean
  sufficient: boolean
  policy: DecisionGradeEvidenceRequirements['policy']
  // Deep-audit fix (P0, 2026-09-13): surfaced onto the assessment so assertDecisionGradeEvidence can
  // gate on the requirement TIER's own failClosed value (see requirementsForDecisionEvidence) instead of
  // a separate, coarser riskClassForDomain(domain) re-check that had no way to distinguish a pure
  // research question ("tell me about GEOS") from a decision question ("should I buy GEOS") -- both
  // were domain:'public_equity' and both got the identical fail-closed, 10-dimension, 4-source,
  // 15-minute-freshness bar, including a 'decision' dimension that literally required the ACQUIRED
  // SOURCES to contain buy/sell/recommend vocabulary even for a pure research request.
  failClosed: boolean
  requiredDimensions: readonly DecisionEvidenceDimension[]
  coveredDimensions: DecisionEvidenceDimension[]
  missingDimensions: DecisionEvidenceDimension[]
  sourceCount: number
  tierOneSourceCount: number
  independentTierOneSourceCount: number
  independentSourceFamilyCount: number
  freshSourceCount: number
  verifiedClaimCount: number
  unverifiedClaimCount: number
  reasons: string[]
}

const EQUITY_DIMENSION_PATTERNS: Readonly<Record<DecisionEvidenceDimension, RegExp>> = Object.freeze({
  issuer_identity: /\b(?:issuer|registrant|company|corporation|ticker|nasdaq|nyse)\b/i,
  market_data: /\b(?:share price|stock price|market price|quote|market cap|market capitalization|shares outstanding)\b/i,
  financials: /\b(?:revenue|sales|earnings|net income|operating income|gross margin|ebitda|eps)\b/i,
  cash_debt: /\b(?:cash|cash equivalents|debt|liabilit(?:y|ies)|working capital|liquidity)\b/i,
  filings: /\b(?:10-k|10-q|8-k|sec filing|company facts|annual report|quarterly report)\b/i,
  recent_events: /\b(?:recent|latest|q[1-4]|quarter|announcement|news|event|contract|order|backlog)\b/i,
  catalysts: /\b(?:catalyst|contract|order|backlog|growth|launch|approval|recovery|turnaround)\b/i,
  risks: /\b(?:risk|risks|risk factor|downside|dilution|liquidity|cyclic(?:al|ality)|uncertainty)\b/i,
  valuation: /\b(?:valuation|p\/e|price to sales|ev\/sales|enterprise value|market cap|multiple|discount)\b/i,
  decision: /\b(?:recommend|recommendation|buy|sell|hold|invest|investment|decision|position|watchlist)\b/i,
})

const EQUITY_RESEARCH_DIMENSIONS: readonly DecisionEvidenceDimension[] = Object.freeze([
  'issuer_identity', 'market_data', 'financials', 'cash_debt', 'filings',
  'recent_events', 'catalysts', 'risks', 'valuation',
])
// Deep-audit fix (P0, 2026-09-13): both a pure research question ("tell me about GEOS and MIND") and a
// decision question ("should I buy GEOS or MIND") produced domain:'public_equity' with no other
// distinguishing signal reaching this file, so both were held to the identical bar below -- including a
// fail-closed 'decision' dimension requiring the SOURCES THEMSELVES to contain buy/sell/recommend
// vocabulary, which a pure research question's sources have no reason to. requirementsForDecisionEvidence
// now selects between these two tiers based on `operation` (recommend/decide vs. everything else a
// research-intent turn can produce -- research/explain/compare/forecast/verify). RESEARCH keeps every
// other requirement identical (same source count, same freshness, same independence bar, same claim-
// verification requirement) -- it is not a lower rigor bar, only a non-fail-closed one that also drops
// the one dimension that only makes sense for an actual buy/sell/hold recommendation. A research request
// that can't clear it gets an honest, transparent "here's what's missing" instead of the whole turn
// hard-failing (see ceo-evidence-executor.ts's use of assessment.failClosed).
const EQUITY_RESEARCH_REQUIREMENTS: Omit<DecisionGradeEvidenceRequirements, 'policy'> = {
  minimumSources: 4,
  minimumIndependentTierOneSources: 1,
  minimumIndependentSourceFamilies: 2,
  maxAgeMs: 15 * 60 * 1000,
  requiredDimensions: EQUITY_RESEARCH_DIMENSIONS,
  claimVerificationRequired: true,
  failClosed: false,
}
const EQUITY_DECISION_REQUIREMENTS: Omit<DecisionGradeEvidenceRequirements, 'policy'> = {
  minimumSources: 4,
  minimumIndependentTierOneSources: 1,
  minimumIndependentSourceFamilies: 2,
  maxAgeMs: 15 * 60 * 1000,
  requiredDimensions: Object.freeze([...EQUITY_RESEARCH_DIMENSIONS, 'decision']),
  claimVerificationRequired: true,
  failClosed: true,
}

function sourceText(sources: readonly EvidenceSource[]): string {
  return sources.map((source) => `${source.title}\n${source.url}\n${source.text}`).join('\n')
}

function freshSources(bundle: EvidenceBundle, now = Date.now()): EvidenceSource[] {
  return bundle.sources.filter((source) => {
    const age = now - source.retrievedAt
    return age >= 0 && age <= bundle.freshness.maxAgeMs
  })
}

function sourceDomain(source: EvidenceSource): string {
  try { return new URL(source.url).hostname.toLowerCase().replace(/^www\./, '') }
  catch { return source.id.trim().toLowerCase() }
}

function independentTierOneCount(sources: readonly EvidenceSource[]): number {
  return new Set(sources.filter((source) => source.sourceTier === 1).map(sourceDomain)).size
}

// Deep-audit fix (P0, 2026-09-13): counts distinct sourceFamily values (ceo-evidence-bundle.ts) across
// EVERY tier, not just tier-1 -- independentTierOneCount above is left unchanged (it's a real,
// SEC-specific dimension worth keeping on its own) but was the ONLY independence check anywhere in the
// pipeline, and it structurally can't see non-SEC republication: four sources at tier 3/4 that are all
// really the same wire story (one on reuters.com, one on finance.yahoo.com quoting it, one on an
// aggregator, one on a blog) previously counted as four independent corroborating sources everywhere.
function independentSourceFamilyCount(sources: readonly EvidenceSource[]): number {
  return new Set(sources.map((source) => source.sourceFamily)).size
}

function dimensionCoverage(sources: readonly EvidenceSource[], dimension: DecisionEvidenceDimension): boolean {
  return EQUITY_DIMENSION_PATTERNS[dimension].test(sourceText(sources))
}

export function requirementsForDecisionEvidence(input: { domain: string; operation?: string; evidenceRequired?: boolean }): DecisionGradeEvidenceRequirements {
  const policy = evidencePolicyFor(input)
  const normalized = input.domain.trim().toLowerCase()
  // Deep-audit fix (P0, 2026-09-13): recommend/decide are the only two EvidenceOperation values that
  // represent an actual buy/sell/hold judgment (see ceo-cognitive-contract.ts's EvidenceOperation union
  // and ceo-pre-router.ts's inferEvidenceOperation) -- research/explain/compare/forecast/verify are all
  // genuinely research-shaped operations and get the non-fail-closed research tier instead.
  if (normalized === 'public_equity') return { policy, ...(input.operation === 'recommend' || input.operation === 'decide' ? EQUITY_DECISION_REQUIREMENTS : EQUITY_RESEARCH_REQUIREMENTS) }
  if (policy === 'DECISION_GRADE') return {
    policy,
    minimumSources: 3,
    minimumIndependentTierOneSources: 1,
    minimumIndependentSourceFamilies: 0,
    maxAgeMs: 60 * 60 * 1000,
    requiredDimensions: Object.freeze([]),
    claimVerificationRequired: true,
    failClosed: true,
  }
  return {
    policy,
    minimumSources: input.evidenceRequired ? 2 : 0,
    minimumIndependentTierOneSources: 0,
    minimumIndependentSourceFamilies: 0,
    maxAgeMs: 60 * 60 * 1000,
    requiredDimensions: Object.freeze([]),
    claimVerificationRequired: false,
    failClosed: false,
  }
}

export function assessDecisionGradeEvidence(input: {
  domain: string
  operation?: string
  bundle?: EvidenceBundle
  verifiedClaimCount?: number
  unverifiedClaimCount?: number
  now?: number
}): DecisionGradeEvidenceAssessment {
  const requirements = requirementsForDecisionEvidence(input)
  const verifiedClaimCount = input.verifiedClaimCount ?? 0
  const unverifiedClaimCount = input.unverifiedClaimCount ?? 0
  const bundle = input.bundle

  if (!bundle) return {
    decisionGrade: requirements.policy === 'NONE',
    sufficient: requirements.policy === 'NONE',
    policy: requirements.policy,
    failClosed: requirements.failClosed,
    requiredDimensions: requirements.requiredDimensions,
    coveredDimensions: [],
    missingDimensions: [...requirements.requiredDimensions],
    sourceCount: 0,
    tierOneSourceCount: 0,
    independentTierOneSourceCount: 0,
    independentSourceFamilyCount: 0,
    freshSourceCount: 0,
    verifiedClaimCount,
    unverifiedClaimCount,
    reasons: requirements.policy === 'NONE' ? [] : ['A decision-grade evidence bundle is required.'],
  }

  const fresh = freshSources(bundle, input.now)
  const covered = requirements.requiredDimensions.filter((dimension) => dimensionCoverage(fresh, dimension))
  const missing = requirements.requiredDimensions.filter((dimension) => !covered.includes(dimension))
  const tierOneSources = fresh.filter((source) => source.sourceTier === 1)
  const tierOneSourceCount = tierOneSources.length
  const independentTierOneSourceCount = independentTierOneCount(fresh)
  const independentFamilyCount = independentSourceFamilyCount(fresh)
  const reasons: string[] = []

  if (!bundle.sufficient) reasons.push('Base evidence bundle is insufficient.')
  if (fresh.length < requirements.minimumSources) reasons.push(`Need at least ${requirements.minimumSources} fresh sources; only ${fresh.length} qualify.`)
  if (independentTierOneSourceCount < requirements.minimumIndependentTierOneSources) reasons.push(`Need at least ${requirements.minimumIndependentTierOneSources} independent Tier-1 source; only ${independentTierOneSourceCount} qualifies.`)
  if (independentFamilyCount < requirements.minimumIndependentSourceFamilies) reasons.push(`Need at least ${requirements.minimumIndependentSourceFamilies} independent source(s) (by publisher/wire-service family, not just URL); only ${independentFamilyCount} qualify -- some sources may be republications of the same underlying story.`)
  if (missing.length) reasons.push(`Missing evidence dimensions: ${missing.join(', ')}.`)
  if (requirements.claimVerificationRequired && unverifiedClaimCount > 0) reasons.push(`${unverifiedClaimCount} claim(s) remain unverified.`)

  const sufficient = requirements.policy === 'NONE' || (
    bundle.sufficient &&
    fresh.length >= requirements.minimumSources &&
    independentTierOneSourceCount >= requirements.minimumIndependentTierOneSources &&
    independentFamilyCount >= requirements.minimumIndependentSourceFamilies &&
    missing.length === 0
  )
  const decisionGrade = sufficient && (!requirements.claimVerificationRequired || unverifiedClaimCount === 0)

  return {
    decisionGrade,
    sufficient,
    policy: requirements.policy,
    failClosed: requirements.failClosed,
    requiredDimensions: requirements.requiredDimensions,
    coveredDimensions: covered,
    missingDimensions: missing,
    sourceCount: bundle.sources.length,
    tierOneSourceCount,
    independentTierOneSourceCount,
    independentSourceFamilyCount: independentFamilyCount,
    freshSourceCount: fresh.length,
    verifiedClaimCount,
    unverifiedClaimCount,
    reasons,
  }
}

export function assertDecisionGradeEvidence(input: {
  domain: string
  operation?: string
  bundle?: EvidenceBundle
  verifiedClaimCount?: number
  unverifiedClaimCount?: number
  now?: number
}): DecisionGradeEvidenceAssessment {
  const assessment = assessDecisionGradeEvidence(input)
  // Deep-audit fix (P0, 2026-09-13): failClosed was a field defined per requirement tier but never
  // actually read here -- this threw purely off riskClassForDomain(domain, operation) === 'HIGH', which
  // for public_equity is unconditionally true regardless of operation (it's domain-only in
  // architecture-integrity-contract.ts), so the field had no effect. Gating on the tier's own
  // failClosed (now threaded onto the assessment) is what actually makes the research/decision split in
  // requirementsForDecisionEvidence take effect: a research-tier assessment can be !decisionGrade (real,
  // honestly-reported gaps) without the whole turn hard-failing, while a decision-tier assessment still
  // throws exactly as before -- this is a no-op for every other requirement branch, which already set
  // failClosed to match what riskClassForDomain would have produced.
  if (assessment.failClosed && !assessment.decisionGrade) throw new DecisionGradeEvidenceBlockedError(assessment)
  return assessment
}

export class DecisionGradeEvidenceBlockedError extends Error {
  readonly code = 'ABSTAINED_REQUIRED_EVIDENCE'
  readonly technicalMessage: string
  readonly assessment: DecisionGradeEvidenceAssessment
  constructor(assessment: DecisionGradeEvidenceAssessment) {
    super('I can’t provide a responsible decision-grade answer yet because the required evidence is incomplete.')
    this.name = 'DecisionGradeEvidenceBlockedError'
    this.technicalMessage = `ABSTAINED_REQUIRED_EVIDENCE: decision-grade evidence is incomplete. ${assessment.reasons.join(' ')}`
    this.assessment = assessment
  }
}
