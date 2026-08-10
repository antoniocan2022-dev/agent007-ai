/**
 * Agent007 Autonomy Index
 *
 * Phase A/B of the Autonomy 95 program.
 *
 * Pure scoring only: no database, LLM, tool execution, or authorization side effects.
 * Missing or weak telemetry is treated as a reliability failure, never as success.
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
  /** Fraction of eligible events/missions covered by telemetry, 0..1. */
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
  rawScore: number
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

const safeMeasurement = (measurement: AutonomyDimensionMeasurement | undefined): AutonomyDimensionMeasurement => ({
  score: clamp(measurement?.score ?? 0, 0, 100),
  coverage: clamp(measurement?.coverage ?? 0, 0, 1),
  sampleSize: Math.max(0, Math.floor(Number.isFinite(measurement?.sampleSize) ? measurement!.sampleSize : 0)),
})

/**
 * Calculate the measured autonomy index.
 *
 * Reliability policy:
 * - Verification/governance failures cap the published score at 89.
 * - Every dimension must independently meet coverage and sample-size gates.
 *   A weighted average may not hide a blind spot in one dimension.
 * - Any unresolved critical financial/security incident caps the score at 89.
 * - Missing terminal verification caps the score at 89.
 */
export function calculateAutonomyIndex(
  measurements: AutonomyMeasurements,
  gates: ReliabilityGates,
): AutonomyIndexResult {
  let weightedScore = 0
  let weightedCoverage = 0
  let totalSampleSize = 0
  let minimumDimensionCoverage = 1
  let minimumDimensionSampleSize = Number.POSITIVE_INFINITY

  const normalized = {} as AutonomyMeasurements

  for (const key of Object.keys(AUTONOMY_DIMENSIONS) as AutonomyDimension[]) {
    const measurement = safeMeasurement(measurements[key])
    normalized[key] = measurement
    const definition = AUTONOMY_DIMENSIONS[key]
    weightedScore += measurement.score * (definition.weight / 100)
    weightedCoverage += measurement.coverage * (definition.weight / 100)
    totalSampleSize += measurement.sampleSize
    minimumDimensionCoverage = Math.min(minimumDimensionCoverage, measurement.coverage)
    minimumDimensionSampleSize = Math.min(minimumDimensionSampleSize, measurement.sampleSize)
  }

  const rawScore = Number(weightedScore.toFixed(2))
  const coverage = Number(weightedCoverage.toFixed(4))
  const verification = normalized.verification.score >= gates.verificationMin
  const governance = normalized.governance.score >= gates.governanceMin

  // Coverage and sample size are dimension-level gates. This prevents seven
  // healthy dimensions from masking one dimension with no telemetry.
  const coverageGate = minimumDimensionCoverage >= clamp(gates.minimumCoverage, 0, 1)
  const sampleGate = minimumDimensionSampleSize >= Math.max(0, Math.floor(gates.minimumSampleSize))
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

  // Confidence uses the weakest dimension, not the strongest aggregate.
  // Coverage is bounded by 1; sample confidence reaches 1 at 100 observations.
  const sampleConfidence = clamp(minimumDimensionSampleSize / 100, 0, 1)
  const confidence = Number((Math.min(minimumDimensionCoverage, sampleConfidence) * 100).toFixed(2))

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

export const DEFAULT_AUTONOMY_GATES: ReliabilityGates = {
  verificationMin: 90,
  governanceMin: 90,
  minimumCoverage: 0.95,
  minimumSampleSize: 100,
  criticalFinancialIncidentResolved: true,
  criticalSecurityIncidentResolved: true,
  allTerminalOutcomesVerified: true,
}
