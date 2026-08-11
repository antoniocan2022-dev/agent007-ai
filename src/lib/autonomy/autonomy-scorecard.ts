/**
 * Deterministic operational autonomy scorecard.
 *
 * This measures observed mission independence; it does not grant authority and
 * must never be used as an authorization signal. A high score requires enough
 * mission evidence and distinguishes autonomous execution from owner-approved
 * execution.
 */

export interface OperationalMissionEvidence {
  completed: boolean
  independentlyVerified: boolean
  failureOccurred: boolean
  recoveredAfterFailure: boolean
  resumedWithoutHumanRestart: boolean
  executedAutonomously: boolean
  outcomeQuality: number
}

export interface AutonomyScorecard {
  score: number
  sampleSize: number
  confidence: 'insufficient' | 'provisional' | 'established'
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F'
  dimensions: {
    completion: number
    verification: number
    recovery: number
    continuity: number
    autonomousExecution: number
    outcomeQuality: number
  }
}

const MIN_ESTABLISHED_SAMPLE = 20
const MIN_PROVISIONAL_SAMPLE = 5

function clamp100(value: number): number {
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0))
}

function rate(values: OperationalMissionEvidence[], selector: (mission: OperationalMissionEvidence) => boolean): number {
  if (values.length === 0) return 0
  return Number((values.filter(selector).length / values.length * 100).toFixed(2))
}

function recoveryRate(values: OperationalMissionEvidence[]): number {
  const failures = values.filter((mission) => mission.failureOccurred)
  if (failures.length === 0) return 100
  return Number((failures.filter((mission) => mission.recoveredAfterFailure).length / failures.length * 100).toFixed(2))
}

function averageQuality(values: OperationalMissionEvidence[]): number {
  if (values.length === 0) return 0
  return Number((values.reduce((sum, mission) => sum + clamp100(mission.outcomeQuality), 0) / values.length).toFixed(2))
}

/**
 * Calculate a reproducible autonomy score from observed mission evidence.
 *
 * Recovery is conditional: missions that never experienced an observed failure
 * do not receive a false negative merely because no recovery was necessary.
 * When failures are observed, every failed mission is part of the recovery
 * denominator and must show actual recovery to score positively.
 */
export function calculateAutonomyScorecard(missions: readonly OperationalMissionEvidence[]): AutonomyScorecard {
  const values = [...missions]
  const sampleSize = values.length

  const dimensions = {
    completion: rate(values, (mission) => mission.completed),
    verification: rate(values, (mission) => mission.independentlyVerified),
    recovery: recoveryRate(values),
    continuity: rate(values, (mission) => mission.resumedWithoutHumanRestart),
    autonomousExecution: rate(values, (mission) => mission.executedAutonomously),
    outcomeQuality: averageQuality(values),
  }

  const score = Number(clamp100(
    dimensions.completion * 0.20 +
    dimensions.verification * 0.20 +
    dimensions.recovery * 0.15 +
    dimensions.continuity * 0.15 +
    dimensions.autonomousExecution * 0.20 +
    dimensions.outcomeQuality * 0.10,
  ).toFixed(2))

  const confidence = sampleSize >= MIN_ESTABLISHED_SAMPLE
    ? 'established'
    : sampleSize >= MIN_PROVISIONAL_SAMPLE
      ? 'provisional'
      : 'insufficient'

  const grade = score >= 97 ? 'A+' :
    score >= 93 ? 'A' :
      score >= 85 ? 'B' :
        score >= 75 ? 'C' :
          score >= 60 ? 'D' : 'F'

  return { score, sampleSize, confidence, grade, dimensions }
}

export function meetsAutonomyTarget(
  scorecard: AutonomyScorecard,
  target = 95,
): boolean {
  return scorecard.confidence === 'established' && scorecard.score >= clamp100(target)
}
