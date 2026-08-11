import type { AutonomyMissionEvidence } from './autonomy-telemetry'
import type { OperationalMissionEvidence } from './autonomy-scorecard'

/**
 * Explicit mission outcome facts required to produce scorecard evidence.
 *
 * No field is inferred from confidence, tool count, latency, or authorization.
 * The caller must provide the observed lifecycle outcome directly.
 */
export interface OperationalOutcomeEvidence {
  completed: boolean
  independentlyVerified: boolean
  recoveredAfterFailure: boolean
  resumedWithoutHumanRestart: boolean
  outcomeQuality: number
}

/**
 * Bridge runtime autonomy evidence into the operational scorecard contract.
 *
 * The autonomous-execution flag comes only from runtime evidence. If runtime
 * evidence is missing, this function returns null rather than manufacturing
 * success. Non-finite quality is preserved for the scorecard to reject safely.
 */
export function buildOperationalMissionEvidence(
  runtime: AutonomyMissionEvidence,
  outcome: OperationalOutcomeEvidence,
): OperationalMissionEvidence | null {
  if (!runtime.eligible || typeof runtime.executionAutonomous !== 'boolean') {
    return null
  }

  return {
    completed: outcome.completed,
    independentlyVerified: outcome.independentlyVerified,
    recoveredAfterFailure: outcome.recoveredAfterFailure,
    resumedWithoutHumanRestart: outcome.resumedWithoutHumanRestart,
    executedAutonomously: runtime.executionAutonomous,
    outcomeQuality: outcome.outcomeQuality,
  }
}
