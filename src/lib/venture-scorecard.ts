/**
 * Venture Scorecard — predictive opportunity scoring + observed health scoring.
 *
 * Scores are pure functions. They never invent business outcomes and accept
 * only caller-supplied evidence or realized portfolio metrics.
 */

export const VENTURE_SCORECARD_VERSION = 1

export interface ScoreEvidence {
  source: string
  statement: string
  confidence: number // 0..1
  observedAt?: string
}

export interface OpportunityScoreInput {
  marketPain: number
  willingnessToPay: number
  competition: number
  acquisitionDifficulty: number
  automationPotential: number
  startupCost: number
  speedToMvp: number
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
  marketPain: 20,
  willingnessToPay: 20,
  competition: 10,
  acquisitionDifficulty: 15,
  automationPotential: 20,
  startupCost: 10,
  speedToMvp: 5,
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

function weightedScore(input: Record<string, number>, weights: Record<string, number>): number {
  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0)
  if (totalWeight <= 0) return 0
  return Math.round(Object.entries(weights).reduce((sum, [key, weight]) => sum + clampScore(input[key] ?? 0) * weight, 0) / totalWeight)
}

function evidenceConfidence(evidence: ScoreEvidence[]): number {
  if (evidence.length === 0) return 0
  const valid = evidence.map((item) => clampConfidence(item.confidence)).filter((value) => value > 0)
  if (valid.length === 0) return 0
  return valid.reduce((sum, value) => sum + value, 0) / valid.length
}

export function calculateOpportunityScore(input: OpportunityScoreInput): OpportunityScoreResult {
  const score = weightedScore(input, OPPORTUNITY_WEIGHTS)
  const confidence = Math.min(clampConfidence(input.evidenceConfidence), evidenceConfidence(input.evidence) || clampConfidence(input.evidenceConfidence))
  const blockingReasons: string[] = []

  if (input.evidence.length === 0) blockingReasons.push('No evidence supplied.')
  if (confidence < 0.75) blockingReasons.push('Evidence confidence is below the CEO validation threshold.')
  if (score < 87) blockingReasons.push('Opportunity score is below the 87/100 advance threshold.')

  return {
    score,
    confidence: Number(confidence.toFixed(3)),
    decisionReady: blockingReasons.length === 0,
    evidenceCount: input.evidence.length,
    breakdown: {
      marketPain: clampScore(input.marketPain),
      willingnessToPay: clampScore(input.willingnessToPay),
      competition: clampScore(input.competition),
      acquisitionDifficulty: clampScore(input.acquisitionDifficulty),
      automationPotential: clampScore(input.automationPotential),
      startupCost: clampScore(input.startupCost),
      speedToMvp: clampScore(input.speedToMvp),
    },
    blockingReasons,
  }
}

export function calculateVentureHealth(input: VentureHealthInput): VentureHealthResult {
  const score = weightedScore(input, HEALTH_WEIGHTS)
  const confidence = Math.min(clampConfidence(input.evidenceConfidence), evidenceConfidence(input.evidence) || clampConfidence(input.evidenceConfidence))
  const blockingReasons: string[] = []

  if (input.evidence.length === 0) blockingReasons.push('No outcome evidence supplied.')
  if (confidence < 0.5) blockingReasons.push('Outcome confidence is too low for an autonomous lifecycle decision.')

  let decision: VentureHealthResult['decision']
  if (score >= 80 && confidence >= 0.75) decision = 'scale'
  else if (score >= 65) decision = 'optimize'
  else if (score >= 50) decision = 'experiment'
  else decision = 'kill_or_pivot'

  if (decision === 'kill_or_pivot' && input.evidence.length < 2) {
    blockingReasons.push('Kill/pivot requires at least two independent evidence items.')
  }

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
  if (Object.values(OPPORTUNITY_WEIGHTS).reduce((a, b) => a + b, 0) !== 100) errors.push('Opportunity weights must total 100.')
  if (Object.values(HEALTH_WEIGHTS).reduce((a, b) => a + b, 0) !== 100) errors.push('Health weights must total 100.')
  if (Object.keys(OPPORTUNITY_WEIGHTS).length !== 7) errors.push('Opportunity scorecard must contain exactly 7 dimensions.')
  if (Object.keys(HEALTH_WEIGHTS).length !== 9) errors.push('Health scorecard must contain exactly 9 dimensions.')
  return errors
}
