import type { AutonomyMissionEvidence } from './autonomy-telemetry'
import type { OperationalMissionEvidence } from './autonomy-scorecard'
import type { MissionTelemetry } from '../mission-telemetry'
import type { AuditReport } from '../executive-audit-engine'

/**
 * Explicit mission outcome facts required to produce scorecard evidence.
 *
 * No field is inferred from confidence, tool count, latency, or authorization.
 * The caller must provide the observed lifecycle outcome directly.
 */
export interface OperationalOutcomeEvidence {
  completed: boolean
  independentlyVerified: boolean
  failureOccurred: boolean
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
    failureOccurred: outcome.failureOccurred,
    recoveredAfterFailure: outcome.recoveredAfterFailure,
    resumedWithoutHumanRestart: outcome.resumedWithoutHumanRestart,
    executedAutonomously: runtime.executionAutonomous,
    outcomeQuality: outcome.outcomeQuality,
  }
}

/**
 * Build operational scorecard evidence directly from persisted mission
 * telemetry and its executive audit. This is the canonical runtime adapter.
 *
 * Continuity, failure occurrence, and outcome quality are required to be
 * explicitly recorded in telemetry; the adapter never substitutes retries,
 * confidence, or verification score for those fields.
 */
export function buildOperationalMissionEvidenceFromTelemetry(
  telemetry: MissionTelemetry,
  audit: AuditReport,
): OperationalMissionEvidence | null {
  const runtime = telemetry.autonomyEvidence
  if (!runtime) return null
  if (typeof telemetry.failureOccurred !== 'boolean') return null
  if (typeof telemetry.resumedWithoutHumanRestart !== 'boolean') return null
  if (typeof telemetry.outcomeQuality !== 'number' || !Number.isFinite(telemetry.outcomeQuality)) return null

  return buildOperationalMissionEvidence(runtime, {
    completed: telemetry.status === 'completed' && audit.pipelineCompleted,
    independentlyVerified: runtime.verificationIndependent === true,
    failureOccurred: telemetry.failureOccurred,
    recoveredAfterFailure: runtime.recoveryAutonomous === true,
    resumedWithoutHumanRestart: telemetry.resumedWithoutHumanRestart,
    outcomeQuality: telemetry.outcomeQuality,
  })
}
