/**
 * Venture Scorecard — canonical VID opportunity score + observed lifecycle health.
 *
 * Opportunity scoring reuses the existing VID Venture Score contract so there
 * is exactly one opportunity taxonomy. The CEO layer adds health scoring for
 * post-validation operation. Evidence may carry structured observed metrics.
 */

import { VENTURE_SCORE_CATEGORIES, VENTURE_SCORE_THRESHOLD } from './vid-data'

export const VENTURE_SCORECARD_VERSION = 3

export interface ScoreEvidence {
  source: string
  statement: string
  confidence: number
  observedAt?: string
  metric?: { name: string; value: number; unit?: string }
}

export interface OpportunityScoreInput {
  marketDemand: number
  competition: number
  automationPotential: number
  timeToRevenue: number
  scalability: number
  recurringRevenue: number
  aiAdvantage: number
  evidenceConfidence: number
  evidence: ScoreEvidence[]
}

export interface OpportunityScoreResult {
  score: number
  confidence: number
  decisionReady: boolean
  evidenceCount: number
  breakdown: Record<string, number>
  blockingReasons: string[]
}

export const OPPORTUNITY_WEIGHTS = {
  marketDemand: 20,
  competition: 10,
  automationPotential: 15,
  timeToRevenue: 15,
  scalability: 15,
  recurringRevenue: 15,
  aiAdvantage: 10,
} as const

export interface VentureHealthInput {
  marketEvidence: number
  demand: number
  conversion: number
  revenue: number
  margin: number
  customerSatisfaction: number
  acquisitionEfficiency: number
  automation: number
  operationalRisk: number
  evidenceConfidence: number
  evidence: ScoreEvidence[]
}

export interface VentureHealthResult {
  score: number
  confidence: number
  decision: 'scale' | 'optimize' | 'experiment' | 'kill_or_pivot'
  breakdown: Record<string, number>
  evidenceCount: number
  blockingReasons: string[]
}

export const HEALTH_WEIGHTS = {
  marketEvidence: 20,
  demand: 15,
  conversion: 15,
  revenue: 15,
  margin: 10,
  customerSatisfaction: 10,
  acquisitionEfficiency: 5,
  automation: 5,
  operationalRisk: 5,
} as const

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function weightedScore(input: object, weights: Record<string, number>): number {
  const values = input as Record<string, unknown>
  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0)
  if (totalWeight <= 0) return 0
  return Math.round(Object.entries(weights).reduce((sum, [key, weight]) => {
    const value = typeof values[key] === 'number' ? values[key] as number : 0
    return sum + clampScore(value) * weight
  }, 0) / totalWeight)
}

function averageEvidenceConfidence(evidence: ScoreEvidence[]): number {
  if (evidence.length === 0) return 0
  return evidence.reduce((sum, item) => sum + clampConfidence(item.confidence), 0) / evidence.length
}

export function calculateOpportunityScore(input: OpportunityScoreInput): OpportunityScoreResult {
  const score = weightedScore(input, OPPORTUNITY_WEIGHTS)
  const confidence = Math.min(clampConfidence(input.evidenceConfidence), averageEvidenceConfidence(input.evidence))
  const blockingReasons: string[] = []

  if (input.evidence.length === 0) blockingReasons.push('No evidence supplied.')
  if (confidence < 0.75) blockingReasons.push('Evidence confidence is below the CEO validation threshold.')
  if (score < VENTURE_SCORE_THRESHOLD) blockingReasons.push(`Opportunity score is below the ${VENTURE_SCORE_THRESHOLD}/100 advance threshold.`)

  return {
    score,
    confidence: Number(confidence.toFixed(3)),
    decisionReady: blockingReasons.length === 0,
    evidenceCount: input.evidence.length,
    breakdown: {
      marketDemand: clampScore(input.marketDemand),
      competition: clampScore(input.competition),
      automationPotential: clampScore(input.automationPotential),
      timeToRevenue: clampScore(input.timeToRevenue),
      scalability: clampScore(input.scalability),
      recurringRevenue: clampScore(input.recurringRevenue),
      aiAdvantage: clampScore(input.aiAdvantage),
    },
    blockingReasons,
  }
}

export function calculateVentureHealth(input: VentureHealthInput): VentureHealthResult {
  const score = weightedScore(input, HEALTH_WEIGHTS)
  const confidence = Math.min(clampConfidence(input.evidenceConfidence), averageEvidenceConfidence(input.evidence))
  const blockingReasons: string[] = []

  if (input.evidence.length === 0) blockingReasons.push('No outcome evidence supplied.')
  if (confidence < 0.5) blockingReasons.push('Outcome confidence is too low for an autonomous lifecycle decision.')

  let decision: VentureHealthResult['decision']
  if (score >= 80 && confidence >= 0.75) decision = 'scale'
  else if (score >= 65) decision = 'optimize'
  else if (score >= 50) decision = 'experiment'
  else decision = 'kill_or_pivot'

  if (decision === 'kill_or_pivot' && input.evidence.length < 2) blockingReasons.push('Kill/pivot requires at least two independent evidence items.')

  return {
    score,
    confidence: Number(confidence.toFixed(3)),
    decision,
    breakdown: {
      marketEvidence: clampScore(input.marketEvidence),
      demand: clampScore(input.demand),
      conversion: clampScore(input.conversion),
      revenue: clampScore(input.revenue),
      margin: clampScore(input.margin),
      customerSatisfaction: clampScore(input.customerSatisfaction),
      acquisitionEfficiency: clampScore(input.acquisitionEfficiency),
      automation: clampScore(input.automation),
      operationalRisk: clampScore(input.operationalRisk),
    },
    evidenceCount: input.evidence.length,
    blockingReasons,
  }
}

export function isScorecardContractValid(): string[] {
  const errors: string[] = []
  const existingWeights = VENTURE_SCORE_CATEGORIES.reduce((sum, category) => sum + category.weight, 0)
  const opportunityWeights = Object.values(OPPORTUNITY_WEIGHTS).reduce((a, b) => a + b, 0)
  const healthWeights = Object.values(HEALTH_WEIGHTS).reduce((a, b) => a + b, 0)
  if (existingWeights !== 100) errors.push('VID Venture Score weights must total 100.')
  if (opportunityWeights !== 100) errors.push('Opportunity weights must total 100.')
  if (healthWeights !== 100) errors.push('Health weights must total 100.')
  if (Object.keys(OPPORTUNITY_WEIGHTS).length !== VENTURE_SCORE_CATEGORIES.length) errors.push('Opportunity Scorecard dimension count drifts from VID Venture Score.')
  if (Object.keys(HEALTH_WEIGHTS).length !== 9) errors.push('Health scorecard must contain exactly 9 dimensions.')
  if (opportunityWeights !== existingWeights) errors.push('Opportunity Scorecard weights drifted from VID Venture Score weights.')
  return errors
}
