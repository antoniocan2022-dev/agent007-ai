/** Canonical CEO failure taxonomy shared across runtime, recovery, degraded mode, and diagnostics. */
export type CeoFailureReason =
  | 'invalid_request'
  | 'context_unavailable'
  | 'provider_unavailable'
  | 'provider_timeout'
  | 'provider_error'
  | 'tool_unavailable'
  | 'tool_error'
  | 'evidence_unavailable'
  | 'evidence_insufficient'
  | 'quality_failure'
  | 'continuity_failure'
  | 'claim_consistency_failure'
  | 'recovery_budget_exhausted'
  | 'execution_timeout'
  | 'production_verification_failure'
  | 'unknown'

export type CeoFailureCapability = 'conversation' | 'reasoning' | 'evidence' | 'tool' | 'mission' | 'production' | 'context'

export interface CeoFailure {
  reason: CeoFailureReason
  message: string
  retryable: boolean
  capability?: CeoFailureCapability
  stage?: string
  cause?: string
}

export const CEO_FAILURE_RETRYABLE: Record<CeoFailureReason, boolean> = {
  invalid_request: false,
  context_unavailable: true,
  provider_unavailable: true,
  provider_timeout: true,
  provider_error: true,
  tool_unavailable: true,
  tool_error: true,
  evidence_unavailable: true,
  evidence_insufficient: true,
  quality_failure: true,
  continuity_failure: true,
  claim_consistency_failure: true,
  recovery_budget_exhausted: false,
  execution_timeout: true,
  production_verification_failure: true,
  unknown: true,
}

export function inferCeoFailureReason(error: unknown): CeoFailureReason {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? '')
  if (/CEO_RECOVERY_BUDGET_EXCEEDED|recovery budget/i.test(text)) return 'recovery_budget_exhausted'
  if (/AGENT_REQUEST_TIMEOUT|timeout|timed out/i.test(text)) return 'execution_timeout'
  if (/evidence|source|research/i.test(text)) return /insufficient/i.test(text) ? 'evidence_insufficient' : 'evidence_unavailable'
  if (/claim.{0,40}consisten|contradiction/i.test(text)) return 'claim_consistency_failure'
  if (/quality|objective coverage/i.test(text)) return 'quality_failure'
  if (/tool/i.test(text)) return /unavailable|missing/i.test(text) ? 'tool_unavailable' : 'tool_error'
  if (/provider|model|llm/i.test(text)) return /unavailable|no provider/i.test(text) ? 'provider_unavailable' : 'provider_error'
  if (/context|conversation|memory/i.test(text)) return 'context_unavailable'
  if (/production|release|traffic|deployment/i.test(text)) return 'production_verification_failure'
  if (/invalid|missing .*request|bad request/i.test(text)) return 'invalid_request'
  return 'unknown'
}

export function createCeoFailure(input: Omit<CeoFailure, 'retryable'> & { retryable?: boolean }): CeoFailure {
  return { ...input, retryable: input.retryable ?? CEO_FAILURE_RETRYABLE[input.reason] }
}
