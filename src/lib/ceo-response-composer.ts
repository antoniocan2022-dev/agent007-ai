import type { EvidenceState, QualityResult } from './ceo-cognitive-contract'

function sanitizeConversationalOutput(content: string): string {
  return content
    .replace(/^\s*Evidence state:\s*[^\n]*\n?/gim, '')
    .replace(/^\s*Quality gate:\s*[^\n]*\n?/gim, '')
    .replace(/^\s*(?:INTERNAL[- ]STATE[- ]ONLY|UNAVAILABLE)(?:\s*[:.-].*)?\s*$/gim, '')
    .replace(/^\s*(?:failed capability|failure reason|provider failure|recovery path)\s*:\s*[^\n]*\n?/gim, '')
    .replace(/^\s*(?:evidence_trace|quality_trace|routing_trace)\s*[:=]\s*\{[\s\S]*?\}\s*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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

  if (naturalConversation) {
    const sanitized = sanitizeConversationalOutput(content)
    return sanitized || 'I’m still with you. I couldn’t complete the internal response path cleanly, but I can continue from the context we already have.'
  }

  // Conversation is a user-facing dialogue surface, not an observability dump.
  // Execution/evidence/quality metadata stays in the machine-readable response
  // envelope unless a caller explicitly opts into user-facing status text.
  if (!input.userFacingStatus) return content

  if (!input.degraded && (input.evidenceState === 'LIVE_VERIFIED' || input.evidenceState === 'LIVE_EXECUTED')) return content

  const evidenceLabel = `Evidence state: ${input.evidenceState}.`
  const qualityLabel = input.quality.decision === 'PASS' ? 'Quality gate: PASS.' : `Quality gate: ${input.quality.decision}.`
  return `${evidenceLabel}\n${qualityLabel}\n\n${content}`
}
