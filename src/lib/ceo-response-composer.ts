import type { EvidenceState, QualityResult } from './ceo-cognitive-contract'

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

  // Conversation is a user-facing dialogue surface, not an observability dump.
  // Execution/evidence/quality metadata stays in the machine-readable response
  // envelope unless a caller explicitly opts into user-facing status text.
  if (naturalConversation || !input.userFacingStatus) return content

  if (!input.degraded && (input.evidenceState === 'LIVE_VERIFIED' || input.evidenceState === 'LIVE_EXECUTED')) return content

  const evidenceLabel = `Evidence state: ${input.evidenceState}.`
  const qualityLabel = input.quality.decision === 'PASS' ? 'Quality gate: PASS.' : `Quality gate: ${input.quality.decision}.`
  return `${evidenceLabel}\n${qualityLabel}\n\n${content}`
}
