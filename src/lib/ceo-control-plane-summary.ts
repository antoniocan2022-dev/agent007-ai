import type { CeoExecutionContract, EvidenceState, QualityDecision, ResponseAction } from './ceo-cognitive-contract'

export interface CeoControlPlaneSummary {
  schemaVersion: 1
  requestId?: string
  intent: CeoExecutionContract['intent']
  operation: CeoExecutionContract['operation']
  responseAction?: ResponseAction
  evidenceState: EvidenceState
  qualityDecision: QualityDecision
  executionCompleted: boolean
  verified: boolean
  degraded: boolean
}

export function buildCeoControlPlaneSummary(input: {
  requestId?: string
  executionContract: CeoExecutionContract
  responseAction?: ResponseAction
  evidenceState: EvidenceState
  qualityDecision: QualityDecision
  executionCompleted: boolean
  verified: boolean
  degraded: boolean
}): CeoControlPlaneSummary {
  return Object.freeze({
    schemaVersion: 1,
    requestId: input.requestId,
    intent: input.executionContract.intent,
    operation: input.executionContract.operation,
    responseAction: input.responseAction,
    evidenceState: input.evidenceState,
    qualityDecision: input.qualityDecision,
    executionCompleted: input.executionCompleted,
    verified: input.verified,
    degraded: input.degraded,
  })
}

export function renderCeoControlPlaneSummary(summary: CeoControlPlaneSummary): string {
  return JSON.stringify(summary)
}

export function assertCeoControlPlaneSummary(summary: CeoControlPlaneSummary): void {
  if (summary.schemaVersion !== 1) throw new Error('CEO_CONTROL_PLANE_SUMMARY_SCHEMA_MISMATCH')
  if (!summary.intent || !summary.operation || !summary.evidenceState || !summary.qualityDecision) throw new Error('CEO_CONTROL_PLANE_SUMMARY_INVALID')
}
