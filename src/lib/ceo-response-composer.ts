import type { EvidenceState, QualityResult } from './ceo-cognitive-contract'
import { assertUserFacingText, containsInternalArtifactToken } from './ceo-behavioral-policy'

const INTERNAL_RESPONSE_PATTERNS: RegExp[] = [
  /^\s*Evidence state:\s*[^\n]*\n?/gim,
  /^\s*Quality gate:\s*[^\n]*\n?/gim,
  /^\s*(?:INTERNAL[- ]STATE[- ]ONLY|UNAVAILABLE)(?:\s*[:.-].*)?\s*$/gim,
  /^\s*(?:failed capability|failure reason|provider failure|recovery path)\s*:\s*[^\n]*\n?/gim,
  /^\s*(?:evidence_trace|quality_trace|routing_trace|continuous_loop_trace)\s*[:=]\s*\{[\s\S]*?\}\s*$/gim,
  /^\s*\d+\.\s*\[(?:ceo_recommendation|ceo_recommendation_action|ceo_observed_outcome|ceo_conversation_incident|ceo_incident_regression_candidate|architecture_business_outcome|mission_telemetry|runtime_telemetry|ceo_runtime_metrics|provider_telemetry|evidence_trace|continuous_loop_trace)\][^\n]*$/gim,
  /\[continuous_loop_trace\][\s\S]*$/gi,
  /\bcontinuous_loop_trace\b[\s\S]*$/gi,
]

function sanitizeConversationalOutput(content: string): string {
  let sanitized = content
  for (const pattern of INTERNAL_RESPONSE_PATTERNS) sanitized = sanitized.replace(pattern, ' ')
  const checked = assertUserFacingText(sanitized)
  return checked.replace(/\n{3,}/g, '\n\n').trim()
}

export function sanitizeCeoErrorForUser(error: unknown): string {
  const errorCode = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code ?? '') : ''
  if (errorCode === 'ABSTAINED_REQUIRED_EVIDENCE' || error instanceof Error && /ABSTAINED_REQUIRED_EVIDENCE/i.test(error.message)) {
    return 'I can’t provide a responsible decision-grade answer yet because the evidence required for this high-risk decision is incomplete. I won’t substitute memory, stale information, or an unverified execution result for the missing evidence.'
  }
  if (errorCode === 'CEO_RECOVERY_BUDGET_EXCEEDED') return 'I stopped the request after reaching the governed recovery limit. The request state remains safe; please retry.'
  if (errorCode === 'AGENT_REQUEST_TIMEOUT') return 'I stopped the request before the execution budget was exhausted so the system can remain responsive. Please retry.'
  if (errorCode === 'CEO_REQUEST_ABORTED') return 'The request was cancelled before completion. No unverified action was treated as completed.'
  return 'I couldn’t complete this request because an internal execution step failed. I have not treated the incomplete result as verified or completed.'
}

export function composeCeoResponse(input: {
  content: string
  evidenceState: EvidenceState
  quality: QualityResult
  degraded: boolean
  conversational?: boolean
  /** Explicit opt-in for surfaces that intentionally expose execution state. */
  userFacingStatus?: boolean
}): string {
  const content = input.content.trim()
  if (!content) return 'Agent007 could not produce a usable response.'

  const naturalConversation = Boolean(
    input.conversational
    || input.quality.conversationQuality
    || (input.evidenceState === 'NOT_APPLICABLE' && input.quality.verificationStatus === 'NOT_REQUIRED'),
  )

  const sanitized = sanitizeConversationalOutput(content)
  if (!sanitized || containsInternalArtifactToken(sanitized)) return 'I couldn’t complete the user-facing response cleanly. Internal execution details were withheld.'

  if (naturalConversation) return sanitized

  // Conversation is a user-facing dialogue surface, not an observability dump.
  // Execution/evidence/quality metadata stays in the machine-readable response
  // envelope unless a caller explicitly opts into user-facing status text.
  if (!input.userFacingStatus) return sanitized

  if (!input.degraded && (input.evidenceState === 'LIVE_VERIFIED' || input.evidenceState === 'LIVE_EXECUTED')) return sanitized

  const evidenceLabel = `Evidence state: ${input.evidenceState}.`
  const qualityLabel = input.quality.decision === 'PASS' ? 'Quality gate: PASS.' : `Quality gate: ${input.quality.decision}.`
  return `${evidenceLabel}\n${qualityLabel}\n\n${sanitized}`
}
