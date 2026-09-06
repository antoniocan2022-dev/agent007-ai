import type { CeoControlPlaneSummary, EvidenceState, QualityDecision, ResponseAction } from './ceo-cognitive-contract'
export type { CeoControlPlaneSummary } from './ceo-cognitive-contract'

export function buildCeoControlPlaneSummary(input: { requestId?: string; responseAction?: ResponseAction; evidenceState: EvidenceState; qualityDecision: QualityDecision; executionCompleted: boolean; verified: boolean; degraded: boolean }): CeoControlPlaneSummary {
  return Object.freeze({ schemaVersion: 1, requestId: input.requestId, responseAction: input.responseAction, evidenceState: input.evidenceState, qualityDecision: input.qualityDecision, executionCompleted: input.executionCompleted, verified: input.verified, degraded: input.degraded })
}

export function assertCeoControlPlaneSummary(summary: CeoControlPlaneSummary): void {
  if (summary.schemaVersion !== 1) throw new Error('CEO_CONTROL_PLANE_SUMMARY_SCHEMA_MISMATCH')
  if (!summary.evidenceState || !summary.qualityDecision) throw new Error('CEO_CONTROL_PLANE_SUMMARY_INVALID')
  if (summary.degraded && summary.executionCompleted) throw new Error('CEO_CONTROL_PLANE_DEGRADED_EXECUTION_INCONSISTENT')
  if (summary.verified && !summary.executionCompleted) throw new Error('CEO_CONTROL_PLANE_VERIFICATION_WITHOUT_EXECUTION')
}
