import { summarizeToolExecutionVerification } from './tool-action-verification'

export interface OperationalExecutionHandoff {
  externalExecutionSucceeded: boolean
  evidenceScope: 'internal_state' | 'live_system'
  evidenceFreshness?: { observedAt: number; maxAgeMs: number }
  verification: ReturnType<typeof summarizeToolExecutionVerification>
}

export interface OperationalExecutionHandoffInput {
  executionStatus: 'completed' | 'partial' | 'failed'
  steps: readonly Array<{
    toolName?: string
    toolResult?: { ok: boolean }
    verification?: { verified: boolean }
  }>
}

export function classifyOperationalExecution(result: OperationalExecutionHandoffInput): OperationalExecutionHandoff {
  const verification = summarizeToolExecutionVerification(result.steps)
  const manageSteps = result.steps.filter((step) => step.toolName === 'manage_action')
  const missionPipelineSteps = result.steps.filter((step) => step.toolName === 'mission_pipeline')
  const allManageSucceeded = manageSteps.length > 0 && manageSteps.every((step) => step.toolResult?.ok === true)
  const verifiedExternalActions = verification.knownActionSteps > 0 && verification.allKnownActionsVerified
  const completedInternalPipeline = missionPipelineSteps.length > 0 && result.executionStatus === 'completed'
  const externalExecutionSucceeded =
    result.executionStatus !== 'failed' &&
    (verifiedExternalActions || allManageSucceeded || completedInternalPipeline)
  const evidenceScope = externalExecutionSucceeded ? 'live_system' : 'internal_state'
  return {
    externalExecutionSucceeded,
    evidenceScope,
    evidenceFreshness: externalExecutionSucceeded ? { observedAt: Date.now(), maxAgeMs: 300000 } : undefined,
    verification,
  }
}
