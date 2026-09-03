import type { EvidenceBundle, EvidenceSource } from './ceo-evidence-bundle'
import { riskClassForDomain, evidencePolicyFor } from './architecture-integrity-contract'

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
  maxAgeMs: number
  requiredDimensions: readonly DecisionEvidenceDimension[]
  claimVerificationRequired: boolean
  failClosed: boolean
}

export interface DecisionGradeEvidenceAssessment {
  decisionGrade: boolean
  sufficient: boolean
  policy: DecisionGradeEvidenceRequirements['policy']
  requiredDimensions: readonly DecisionEvidenceDimension[]
  coveredDimensions: DecisionEvidenceDimension[]
  missingDimensions: DecisionEvidenceDimension[]
  sourceCount: number
  tierOneSourceCount: number
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

const EQUITY_REQUIREMENTS: Omit<DecisionGradeEvidenceRequirements, 'policy'> = {
  minimumSources: 4,
  minimumIndependentTierOneSources: 1,
  maxAgeMs: 15 * 60 * 1000,
  requiredDimensions: Object.freeze([
    'issuer_identity', 'market_data', 'financials', 'cash_debt', 'filings',
    'recent_events', 'catalysts', 'risks', 'valuation', 'decision',
  ] as DecisionEvidenceDimension[]),
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

function dimensionCoverage(sources: readonly EvidenceSource[], dimension: DecisionEvidenceDimension): boolean {
  return EQUITY_DIMENSION_PATTERNS[dimension].test(sourceText(sources))
}

export function requirementsForDecisionEvidence(input: { domain: string; operation?: string; evidenceRequired?: boolean }): DecisionGradeEvidenceRequirements {
  const policy = evidencePolicyFor(input)
  const normalized = input.domain.trim().toLowerCase()
  if (normalized === 'public_equity') return { policy, ...EQUITY_REQUIREMENTS }
  if (policy === 'DECISION_GRADE') return {
    policy,
    minimumSources: 3,
    minimumIndependentTierOneSources: 1,
    maxAgeMs: 60 * 60 * 1000,
    requiredDimensions: Object.freeze([]),
    claimVerificationRequired: true,
    failClosed: true,
  }
  return {
    policy,
    minimumSources: input.evidenceRequired ? 2 : 0,
    minimumIndependentTierOneSources: 0,
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

  if (!bundle) {
    return {
      decisionGrade: requirements.policy === 'NONE',
      sufficient: requirements.policy === 'NONE',
      policy: requirements.policy,
      requiredDimensions: requirements.requiredDimensions,
      coveredDimensions: [],
      missingDimensions: [...requirements.requiredDimensions],
      sourceCount: 0,
      tierOneSourceCount: 0,
      freshSourceCount: 0,
      verifiedClaimCount,
      unverifiedClaimCount,
      reasons: requirements.policy === 'NONE' ? [] : ['A decision-grade evidence bundle is required.'],
    }
  }

  const fresh = freshSources(bundle, input.now)
  const covered = requirements.requiredDimensions.filter((dimension) => dimensionCoverage(fresh, dimension))
  const missing = requirements.requiredDimensions.filter((dimension) => !covered.includes(dimension))
  const tierOne = fresh.filter((source) => source.sourceTier === 1).length
  const reasons: string[] = []

  if (!bundle.sufficient) reasons.push('Base evidence bundle is insufficient.')
  if (fresh.length < requirements.minimumSources) reasons.push(`Need at least ${requirements.minimumSources} fresh sources; only ${fresh.length} qualify.`)
  if (tierOne < requirements.minimumIndependentTierOneSources) reasons.push(`Need at least ${requirements.minimumIndependentTierOneSources} Tier-1 source; only ${tierOne} qualifies.`)
  if (missing.length) reasons.push(`Missing evidence dimensions: ${missing.join(', ')}.`)
  if (requirements.claimVerificationRequired && unverifiedClaimCount > 0) reasons.push(`${unverifiedClaimCount} claim(s) remain unverified.`)

  const sufficient = requirements.policy === 'NONE' || (
    fresh.length >= requirements.minimumSources &&
    tierOne >= requirements.minimumIndependentTierOneSources &&
    missing.length === 0
  )
  const decisionGrade = sufficient && (!requirements.claimVerificationRequired || unverifiedClaimCount === 0)

  return {
    decisionGrade,
    sufficient,
    policy: requirements.policy,
    requiredDimensions: requirements.requiredDimensions,
    coveredDimensions: covered,
    missingDimensions: missing,
    sourceCount: bundle.sources.length,
    tierOneSourceCount: tierOne,
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
  if (riskClassForDomain(input.domain, input.operation) === 'HIGH' && !assessment.decisionGrade) {
    throw new DecisionGradeEvidenceBlockedError(assessment)
  }
  return assessment
}

export class DecisionGradeEvidenceBlockedError extends Error {
  readonly code = 'ABSTAINED_REQUIRED_EVIDENCE'
  readonly assessment: DecisionGradeEvidenceAssessment

  constructor(assessment: DecisionGradeEvidenceAssessment) {
    super(`ABSTAINED_REQUIRED_EVIDENCE: decision-grade evidence is incomplete. ${assessment.reasons.join(' ')}`)
    this.name = 'DecisionGradeEvidenceBlockedError'
    this.assessment = assessment
  }
}
