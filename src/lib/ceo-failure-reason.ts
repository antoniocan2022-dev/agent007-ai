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

export interface CeoFailure {
  reason: CeoFailureReason
  message: string
  retryable: boolean
  capability?: 'conversation' | 'reasoning' | 'evidence' | 'tool' | 'mission' | 'production' | 'context'
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

export function createCeoFailure(input: Omit<CeoFailure, 'retryable'> & { retryable?: boolean }): CeoFailure {
  return {
    ...input,
    retryable: input.retryable ?? CEO_FAILURE_RETRYABLE[input.reason],
  }
}
