/**
 * Operational autonomy evidence adapter.
 *
 * Converts persisted mission telemetry + executive audit evidence into the
 * operational scorecard contract. This adapter is deliberately strict:
 * missing evidence means the mission is not scoreable, rather than guessing.
 */

import type { AuditReport } from '../executive-audit-engine'
import type { MissionTelemetry } from '../mission-telemetry'
import type { OperationalMissionEvidence } from './autonomy-scorecard'

export function buildOperationalMissionEvidence(
  telemetry: MissionTelemetry,
  audit: AuditReport,
): OperationalMissionEvidence | null {
  const autonomy = telemetry.autonomyEvidence
  if (!autonomy) return null

  // Continuity is intentionally required as explicit evidence. A retry is not
  // proof of autonomous resumption, so this adapter never infers continuity.
  const continuity = (telemetry as MissionTelemetry & {
    resumedWithoutHumanRestart?: boolean
  }).resumedWithoutHumanRestart

  if (typeof continuity !== 'boolean') return null
  if (!Number.isFinite(audit.qualityScore)) return null

  return {
    completed: telemetry.status === 'completed' && audit.pipelineCompleted,
    independentlyVerified: autonomy.verificationIndependent === true,
    recoveredAfterFailure: autonomy.recoveryAutonomous === true,
    resumedWithoutHumanRestart: continuity,
    executedAutonomously: autonomy.executionAutonomous === true,
    outcomeQuality: audit.qualityScore,
  }
}
