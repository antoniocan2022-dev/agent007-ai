export type OrchestratorExecutionStatus = 'completed' | 'partial' | 'failed'

export type OrchestratorCompletionReason =
  | 'done'
  | 'fast_path'
  | 'mission_pipeline'
  | 'llm_error'
  | 'invalid_llm_output'
  | 'iteration_limit'

export interface OrchestratorExecutionResult {
  /** Internal execution evidence only; never a user-facing answer. */
  executionSummary: string
  executionStatus: OrchestratorExecutionStatus
  completionReason: OrchestratorCompletionReason
}

export function buildOrchestratorExecutionSummary(input: {
  executionStatus: OrchestratorExecutionStatus
  completionReason: OrchestratorCompletionReason
  toolSteps: ReadonlyArray<{
    toolName?: string
    toolResult?: { ok: boolean; result?: string | null }
    verification?: { verified: boolean; artifactType?: string; warning?: string | null }
  }>
  notes?: readonly string[]
  terminalError?: string
}): string {
  const lines = [
    'INTERNAL ORCHESTRATION RECEIPT — NOT USER-FACING',
    `Execution status: ${input.executionStatus}`,
    `Completion reason: ${input.completionReason}`,
    `Execution steps: ${input.toolSteps.length}`,
  ]

  if (input.terminalError) lines.push(`Terminal execution error: ${input.terminalError.slice(0, 600)}`)

  for (const step of input.toolSteps.slice(-20)) {
    const outcome = step.toolResult?.ok === false ? 'FAILED' : step.toolResult?.ok === true ? 'OK' : 'NO_RESULT'
    const verification = step.verification
      ? step.verification.verified
        ? ` verification=VERIFIED artifact=${step.verification.artifactType ?? 'artifact'}`
        : ` verification=UNVERIFIED${step.verification.warning ? ` warning=${step.verification.warning.slice(0, 500).replace(/\\s+/g, ' ').trim()}` : ''}`
      : ''
    const preview = typeof step.toolResult?.result === 'string' ? step.toolResult.result.slice(0, 700).replace(/\s+/g, ' ').trim() : ''
    lines.push(`- ${step.toolName ?? 'unknown_tool'}: ${outcome}${verification}${preview ? ` — ${preview}` : ''}`)
  }

  for (const note of (input.notes ?? []).slice(-10)) {
    const normalized = note.replace(/\s+/g, ' ').trim()
    if (normalized) lines.push(`- execution-note: ${normalized.slice(0, 900)}`)
  }

  return lines.join('\n').slice(0, 18000)
}
