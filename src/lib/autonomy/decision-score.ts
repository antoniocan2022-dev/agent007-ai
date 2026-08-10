/**
 * Deterministic executive decision scoring primitives.
 *
 * LLMs may supply estimates, but this module keeps the final normalization and
 * weighting deterministic. The output is a prioritization signal, not an
 * authorization decision; authorization remains the Autonomy Governor's job.
 */

export interface DecisionFactors {
  expectedValue: number
  probabilityOfSuccess: number
  strategicAlignment: number
  urgency: number
  reversibility: number
  confidence: number
  risk: number
  cost: number
}

export interface DecisionScore {
  score: number
  expectedReturn: number
  riskAdjustedValue: number
  priority: 'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5'
}

const clamp100 = (value: number): number => Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0))

/**
 * Score a candidate action from normalized 0..100 factors.
 *
 * Value and success probability form the economic core. Alignment and urgency
 * pull strategically useful work forward; risk and cost subtract; confidence
 * prevents weakly-supported opportunities from outranking well-supported ones.
 */
export function scoreExecutiveDecision(factors: DecisionFactors): DecisionScore {
  const value = clamp100(factors.expectedValue)
  const success = clamp100(factors.probabilityOfSuccess)
  const alignment = clamp100(factors.strategicAlignment)
  const urgency = clamp100(factors.urgency)
  const reversibility = clamp100(factors.reversibility)
  const confidence = clamp100(factors.confidence)
  const risk = clamp100(factors.risk)
  const cost = clamp100(factors.cost)

  const expectedReturn = value * (success / 100)
  const riskAdjustedValue = expectedReturn * (1 - risk / 200)

  const score = clamp100(
    riskAdjustedValue * 0.35 +
    alignment * 0.20 +
    urgency * 0.10 +
    reversibility * 0.05 +
    confidence * 0.20 -
    cost * 0.10,
  )

  const rounded = Number(score.toFixed(2))
  const priority = rounded >= 90 ? 'P0' :
    rounded >= 80 ? 'P1' :
      rounded >= 70 ? 'P2' :
        rounded >= 55 ? 'P3' :
          rounded >= 40 ? 'P4' : 'P5'

  return {
    score: rounded,
    expectedReturn: Number(expectedReturn.toFixed(2)),
    riskAdjustedValue: Number(riskAdjustedValue.toFixed(2)),
    priority,
  }
}
