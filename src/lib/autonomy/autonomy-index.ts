/**
 * Agent007 Autonomy Index
 *
 * Phase A of the Autonomy 95 program.
 *
 * This module is intentionally pure: it does not read the database, invoke an
 * LLM, dispatch tools, or make authorization decisions. It converts measured
 * autonomy signals into a bounded score and explicit reliability gates.
 *
 * Important: a missing metric is not treated as success. Coverage and data
 * quality are first-class inputs so the system cannot manufacture a 95% score
 * from incomplete telemetry.
 */

export const AUTONOMY_DIMENSIONS = {
  goalMission: { weight: 18, target: 97 },
  planningDecision: { weight: 15, target: 96 },
  execution: { weight: 15, target: 97 },
  verification: { weight: 15, target: 98 },
  recovery: { weight: 12, target: 95 },
  learning: { weight: 10, target: 93 },
  governance: { weight: 15, target: 98 },
} as const

export type AutonomyDimension = keyof typeof AUTONOMY_DIMENSIONS

export interface AutonomyDimensionMeasurement {
  /** Score in the inclusive range 0..100. */
  score: number
  /** Fraction of the underlying events/missions covered by telemetry, 0..1. */
  coverage: number
  /** Number of eligible observations represented by the measurement. */
  sampleSize: number
}

export type AutonomyMeasurements = Record<AutonomyDimension, AutonomyDimensionMeasurement>

export interface ReliabilityGates {
  verificationMin: number
  governanceMin: number
  minimumCoverage: number
  minimumSampleSize: number
  criticalFinancialIncidentResolved: boolean
  criticalSecurityIncidentResolved: boolean
  allTerminalOutcomesVerified: boolean
}

export interface AutonomyIndexResult {
  /** Weighted score before reliability gates. */
  rawScore: number
  /** Published score. This can never exceed rawScore and is capped when gates fail. */
  score: number
  passed: boolean
  confidence: number
  coverage: number
  totalSampleSize: number
  gates: {
    verification: boolean
    governance: boolean
    coverage: boolean
    sampleSize: boolean
    financial: boolean
    security: boolean
    verificationCompleteness: boolean
  }
  failingGates: string[]
  dimensions: Record<AutonomyDimension, {
    score: number
    target: number
    weight: number
    coverage: number
    sampleSize: number
    meetsTarget: boolean
  }>
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))

const safeMeasurement = (measurement: AutonomyDimensionMeasurement): AutonomyDimensionMeasurement => ({
  score: clamp(measurement.score, 0, 100),
  coverage: clamp(measurement.coverage, 0, 1),
  sampleSize: Math.max(0, Math.floor(Number.isFinite(measurement.sampleSize) ? measurement.sampleSize : 0)),
})

/**
 * Calculate the measured autonomy index.
 *
 * Reliability policy:
 * - Verification and governance failures cap the published score at 89.
 * - Insufficient coverage/sample size caps the score at 89.
 * - Any unresolved critical financial/security incident caps the score at 89.
 * - Missing terminal verification caps the score at 89.
 *
 * 89 is deliberately below the program's 95% claim threshold and makes it
 * impossible for excellent execution metrics to conceal an unsafe system.
 */
export function calculateAutonomyIndex(
  measurements: AutonomyMeasurements,
  gates: ReliabilityGates,
): AutonomyIndexResult {
  const normalized = {} as AutonomyMeasurements
  let weightedScore = 0
  let weightedCoverage = 0
  let totalSampleSize = 0

  for (const key of Object.keys(AUTONOMY_DIMENSIONS) as AutonomyDimension[]) {
    const measurement = safeMeasurement(measurements[key])
    normalized[key] = measurement
    const definition = AUTONOMY_DIMENSIONS[key]
    weightedScore += measurement.score * (definition.weight / 100)
    weightedCoverage += measurement.coverage * (definition.weight / 100)
    totalSampleSize += measurement.sampleSize
  }

  const rawScore = Number(weightedScore.toFixed(2))
  const coverage = Number(weightedCoverage.toFixed(4))
  const verification = normalized.verification.score >= gates.verificationMin
  const governance = normalized.governance.score >= gates.governanceMin
  const coverageGate = coverage >= gates.minimumCoverage
  const sampleGate = totalSampleSize >= gates.minimumSampleSize
  const financialGate = gates.criticalFinancialIncidentResolved
  const securityGate = gates.criticalSecurityIncidentResolved
  const verificationCompleteness = gates.allTerminalOutcomesVerified

  const gateMap = {
    verification,
    governance,
    coverage: coverageGate,
    sampleSize: sampleGate,
    financial: financialGate,
    security: securityGate,
    verificationCompleteness,
  }

  const failingGates = Object.entries(gateMap)
    .filter(([, passed]) => !passed)
    .map(([name]) => name)

  const allGatesPass = failingGates.length === 0
  const score = Number((allGatesPass ? rawScore : Math.min(rawScore, 89)).toFixed(2))

  // Confidence is deliberately conservative. Coverage and sample size each
  // contribute 50%; a single observation can never produce high confidence.
  const sampleConfidence = clamp(totalSampleSize / 100, 0, 1)
  const confidence = Number((Math.min(coverage, sampleConfidence) * 100).toFixed(2))

  const dimensions = {} as AutonomyIndexResult['dimensions']
  for (const key of Object.keys(AUTONOMY_DIMENSIONS) as AutonomyDimension[]) {
    const definition = AUTONOMY_DIMENSIONS[key]
    const measurement = normalized[key]
    dimensions[key] = {
      score: Number(measurement.score.toFixed(2)),
      target: definition.target,
      weight: definition.weight,
      coverage: Number((measurement.coverage * 100).toFixed(2)),
      sampleSize: measurement.sampleSize,
      meetsTarget: measurement.score >= definition.target,
    }
  }

  return {
    rawScore,
    score,
    passed: score >= 95 && allGatesPass,
    confidence,
    coverage: Number((coverage * 100).toFixed(2)),
    totalSampleSize,
    gates: gateMap,
    failingGates,
    dimensions,
  }
}

/** Default production policy for the first measurement phase. */
export const DEFAULT_AUTONOMY_GATES: ReliabilityGates = {
  verificationMin: 90,
  governanceMin: 90,
  minimumCoverage: 0.95,
  minimumSampleSize: 100,
  criticalFinancialIncidentResolved: true,
  criticalSecurityIncidentResolved: true,
  allTerminalOutcomesVerified: true,
}
