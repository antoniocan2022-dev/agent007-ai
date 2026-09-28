import { summarizeToolExecutionVerification } from './tool-action-verification'

export interface OperationalExecutionHandoff {
  externalExecutionSucceeded: boolean
  evidenceScope: 'internal_state' | 'live_system'
  evidenceFreshness?: { observedAt: number; maxAgeMs: number }
  verification: ReturnType<typeof summarizeToolExecutionVerification>
}

export interface OperationalExecutionHandoffInput {
  executionStatus: 'completed' | 'partial' | 'failed'
  steps: ReadonlyArray<{
    toolName?: string
    toolResult?: { ok: boolean }
    verification?: { verified: boolean }
  }>
  // Production incident (2026-09-28): the orchestrator's auto-diagnostics block (a "run a full
  // self-check" turn's 4 real production fetches) never shows up in `steps` -- it's consumed as inert
  // prompt text, not a tracked tool call. Without this, evidenceScope always fell back to
  // 'internal_state' for that turn, which can never satisfy the (correct) live_system evidence
  // requirement a genuine "is the system healthy right now" answer triggers -- so the response was
  // rejected, escalation burned the full retry budget on providers with the same missing evidence, and
  // the turn degraded despite real, fresh diagnostic data having just been gathered.
  diagnosticsEvidence?: { gathered: boolean; observedAt: number }
}

export function classifyOperationalExecution(result: OperationalExecutionHandoffInput): OperationalExecutionHandoff {
  const verification = summarizeToolExecutionVerification(result.steps)
  const manageSteps = result.steps.filter((step) => step.toolName === 'manage_action')
  const missionPipelineSteps = result.steps.filter((step) => step.toolName === 'mission_pipeline')
  const allManageSucceeded = manageSteps.length > 0 && manageSteps.every((step) => step.toolResult?.ok === true)
  const verifiedExternalActions = verification.knownActionSteps > 0 && verification.allKnownActionsVerified
  const completedInternalPipeline = missionPipelineSteps.length > 0 && result.executionStatus === 'completed'
  const noUnverifiedConsequentialAction = !verification.hasUnverifiedAction
  const externalExecutionSucceeded =
    result.executionStatus === 'completed' &&
    noUnverifiedConsequentialAction &&
    (verifiedExternalActions || allManageSucceeded || completedInternalPipeline)
  const freshDiagnosticEvidence = Boolean(result.diagnosticsEvidence?.gathered) && Date.now() - (result.diagnosticsEvidence?.observedAt ?? 0) <= 300000
  const evidenceScope = externalExecutionSucceeded || freshDiagnosticEvidence ? 'live_system' : 'internal_state'
  return {
    externalExecutionSucceeded,
    evidenceScope,
    evidenceFreshness: externalExecutionSucceeded
      ? { observedAt: Date.now(), maxAgeMs: 300000 }
      : freshDiagnosticEvidence
        ? { observedAt: result.diagnosticsEvidence!.observedAt, maxAgeMs: 300000 }
        : undefined,
    verification,
  }
}
