import type { EvidenceState, QualityResult } from './ceo-cognitive-contract'
import { buildFinalizationProvenance, finalizeCeoResponse, prepareCeoCandidateContent, type FinalizedCeoResponse } from './ceo-response-finalizer'
import { buildCeoResponseDecisionEnvelope, type CeoResponseDecisionEnvelope } from './ceo-response-contract'
import { buildCeoControlPlaneSummary } from './ceo-control-plane-summary'

export function sanitizeCeoErrorForUser(error: unknown): string {
  const errorCode = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code ?? '') : ''
  if (errorCode === 'ABSTAINED_REQUIRED_EVIDENCE' || error instanceof Error && /ABSTAINED_REQUIRED_EVIDENCE/i.test(error.message)) return 'I can’t provide a responsible decision-grade answer yet because the evidence required for this high-risk decision is incomplete. I won’t substitute memory, stale information, or an unverified execution result for the missing evidence.'
  if (errorCode === 'CEO_RECOVERY_BUDGET_EXCEEDED') return 'I stopped the request after reaching the governed recovery limit. The request state remains safe; please retry.'
  if (errorCode === 'AGENT_REQUEST_TIMEOUT') return 'I stopped the request before the execution budget was exhausted so the system can remain responsive. Please retry.'
  if (errorCode === 'CEO_REQUEST_ABORTED') return 'The request was cancelled before completion. No unverified action was treated as completed.'
  return 'I couldn’t complete this request because an internal execution step failed. I have not treated the incomplete result as verified or completed.'
}

export function buildAuthoritativeCeoResponseDecision(input: { content: string; quality: QualityResult; evidenceState: EvidenceState; degraded: boolean; conversational?: boolean; requestId?: string }): CeoResponseDecisionEnvelope {
  const prepared = prepareCeoCandidateContent(input.content)
  if (prepared.rejected) throw new Error('CEO_RESPONSE_CANDIDATE_NOT_USER_SAFE')
  const controlPlaneSummary = buildCeoControlPlaneSummary({ requestId: input.requestId, responseAction: undefined, evidenceState: input.evidenceState, qualityDecision: input.quality.decision, executionCompleted: !input.degraded, verified: input.evidenceState === 'LIVE_VERIFIED', degraded: input.degraded })
  return buildCeoResponseDecisionEnvelope({ content: prepared.content, quality: input.quality, controlPlaneSummary, requestId: input.requestId })
}

export function finalizeCeoResponseForSurface(input: { content: string; quality: QualityResult; evidenceState: EvidenceState; degraded: boolean; conversational?: boolean; userFacingStatus?: boolean; context?: string; requestId?: string }): FinalizedCeoResponse {
  const decisionEnvelope = buildAuthoritativeCeoResponseDecision({ content: input.content, quality: input.quality, evidenceState: input.evidenceState, degraded: input.degraded, conversational: input.conversational, requestId: input.requestId })
  // Deliberately do not add post-quality user-facing labels. Evidence/quality metadata is already transported out-of-band.
  return finalizeCeoResponse({ content: decisionEnvelope.candidate.content, finalizationContext: input.context, decisionEnvelope })
}

/** Applies the same finalization sanitization composeCeoResponse will apply, so the quality gate judges what the user actually receives instead of the pre-sanitization draft. */
export function sanitizeCeoContentForQualityGate(content: string): string {
  return finalizeCeoResponse({ content }).content
}

export function composeCeoResponse(input: { content: string; evidenceState: EvidenceState; quality: QualityResult; degraded: boolean; conversational?: boolean; userFacingStatus?: boolean; requestId?: string }): string {
  const finalized = finalizeCeoResponseForSurface(input)
  const provenance = buildFinalizationProvenance(finalized)
  Object.assign(input.quality, { finalResponseProvenance: provenance })
  return finalized.content
}
