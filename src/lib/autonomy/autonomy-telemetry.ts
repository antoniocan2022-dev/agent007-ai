import {
  calculateAutonomyIndex,
  DEFAULT_AUTONOMY_GATES,
  type AutonomyDimension,
  type AutonomyDimensionMeasurement,
  type AutonomyIndexResult,
  type AutonomyMeasurements,
  type ReliabilityGates,
} from './autonomy-index'

/**
 * Evidence captured by the runtime for one eligible mission.
 *
 * Every field is optional on purpose: older mission telemetry remains readable,
 * while missing evidence produces zero coverage instead of an optimistic score.
 */
export interface AutonomyMissionEvidence {
  eligible: boolean
  goalAutonomous?: boolean
  decisionAutonomous?: boolean
  executionAutonomous?: boolean
  verificationIndependent?: boolean
  recoveryAutonomous?: boolean
  learningApplied?: boolean
  governancePassed?: boolean
}

export interface AutonomyTelemetrySummary {
  eligibleMissions: number
  evidenceCoverage: Record<AutonomyDimension, number>
  measurements: AutonomyMeasurements
  index: AutonomyIndexResult
}

const DIMENSION_KEYS: readonly AutonomyDimension[] = [
  'goalMission',
  'planningDecision',
  'execution',
  'verification',
  'recovery',
  'learning',
  'governance',
]

const DIMENSION_EVIDENCE: Record<AutonomyDimension, keyof Omit<AutonomyMissionEvidence, 'eligible'>> = {
  goalMission: 'goalAutonomous',
  planningDecision: 'decisionAutonomous',
  execution: 'executionAutonomous',
  verification: 'verificationIndependent',
  recovery: 'recoveryAutonomous',
  learning: 'learningApplied',
  governance: 'governancePassed',
}

function aggregateDimension(
  missions: AutonomyMissionEvidence[],
  key: AutonomyDimension,
): AutonomyDimensionMeasurement {
  const evidenceKey = DIMENSION_EVIDENCE[key]
  const observed = missions.filter((mission) => typeof mission[evidenceKey] === 'boolean')
  const positive = observed.filter((mission) => mission[evidenceKey] === true).length

  return {
    score: observed.length > 0 ? (positive / observed.length) * 100 : 0,
    coverage: missions.length > 0 ? observed.length / missions.length : 0,
    sampleSize: observed.length,
  }
}

/**
 * Convert runtime evidence into the canonical Autonomy 95 measurement model.
 *
 * This function intentionally refuses to infer autonomy from unrelated signals
 * such as tool count, latency, or model confidence. Those may be useful
 * operational metrics but are not proof that the mission ran autonomously.
 */
export function buildAutonomyTelemetrySummary(
  evidence: readonly AutonomyMissionEvidence[],
  gates: ReliabilityGates = DEFAULT_AUTONOMY_GATES,
): AutonomyTelemetrySummary {
  const eligible = evidence.filter((mission) => mission.eligible)
  const measurements = {} as AutonomyMeasurements
  const evidenceCoverage = {} as Record<AutonomyDimension, number>

  for (const key of DIMENSION_KEYS) {
    const measurement = aggregateDimension(eligible, key)
    measurements[key] = measurement
    evidenceCoverage[key] = measurement.coverage
  }

  return {
    eligibleMissions: eligible.length,
    evidenceCoverage,
    measurements,
    index: calculateAutonomyIndex(measurements, gates),
  }
}
