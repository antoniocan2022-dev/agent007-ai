import type { EvidenceState, QualityResult } from './ceo-cognitive-contract'
import { buildFinalizationProvenance, finalizeCeoResponse, type FinalizedCeoResponse } from './ceo-response-finalizer'

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

export function finalizeCeoResponseForSurface(input: {
  content: string
  quality: QualityResult
  evidenceState: EvidenceState
  degraded: boolean
  conversational?: boolean
  userFacingStatus?: boolean
  context?: string
}): FinalizedCeoResponse {
  const naturalConversation = Boolean(
    input.conversational
    || input.quality.conversationQuality
    || (input.evidenceState === 'NOT_APPLICABLE' && input.quality.verificationStatus === 'NOT_REQUIRED'),
  )
  let candidate = input.content.trim()
  if (!candidate) candidate = 'Agent007 could not produce a usable response.'

  if (!naturalConversation && input.userFacingStatus) {
    if (input.degraded || !['LIVE_VERIFIED', 'LIVE_EXECUTED'].includes(input.evidenceState)) {
      const evidenceLabel = `Evidence state: ${input.evidenceState}.`
      const qualityLabel = input.quality.decision === 'PASS' ? 'Quality gate: PASS.' : `Quality gate: ${input.quality.decision}.`
      candidate = `${evidenceLabel}\n${qualityLabel}\n\n${candidate}`
    }
  }

  return finalizeCeoResponse({ content: candidate, finalizationContext: input.context })
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
  const finalized = finalizeCeoResponseForSurface(input)
  const provenance = buildFinalizationProvenance(finalized)
  Object.assign(input.quality, { finalResponseProvenance: provenance })
  return finalized.content
}
