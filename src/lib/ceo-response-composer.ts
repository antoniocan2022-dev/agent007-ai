import type { EvidenceState, QualityResult } from './ceo-cognitive-contract'

export function composeCeoResponse(input: {
  content: string
  evidenceState: EvidenceState
  quality: QualityResult
  degraded: boolean
  conversational?: boolean
}): string {
  const content = input.content.trim()
  if (!content) return 'Agent007 could not produce a usable response.'

  const naturalConversation = Boolean(
    input.conversational
    || input.quality.conversationQuality
    || (input.evidenceState === 'NOT_APPLICABLE' && input.quality.verificationStatus === 'NOT_REQUIRED'),
  )

  // Conversation is a user-facing dialogue surface, not an observability dump.
  // Evidence, routing, and quality metadata remain available in the SSE answer
  // envelope but never leak into ordinary conversational text.
  if (naturalConversation) return content

  // Non-conversational degraded/cached/partial results may surface their state
  // because that state can materially change how the user should interpret the answer.
  if (!input.degraded && (input.evidenceState === 'LIVE_VERIFIED' || input.evidenceState === 'LIVE_EXECUTED')) return content

  const evidenceLabel = `Evidence state: ${input.evidenceState}.`
  const qualityLabel = input.quality.decision === 'PASS' ? 'Quality gate: PASS.' : `Quality gate: ${input.quality.decision}.`
  return `${evidenceLabel}\n${qualityLabel}\n\n${content}`
}
