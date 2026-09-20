import type { CanonicalConversationContext } from './ceo-cognitive-conversation'
import type { ConversationDecisionContract } from './ceo-conversation-decision-contract'
import type { CeoWorldModel } from './ceo-world-model'

export interface CeoCuriosityDecision {
  investigate: boolean
  reason: string
  materialUnknowns: string[]
}

const EXTERNAL_SIGNAL_RE = /\b(?:competitor(?:s)?|rival(?:s)?|news|headlines?|market(?:s)?|industry|sector|macro(?:economic)?|stock(?:s)?|shares?|equity|ticker|valuation|10-k|10-q|sec\s+filing|latest|recent|research|search|look\s+up|fact[- ]check)\b/i
const EXPLICIT_EXTERNAL_REGULATORY_RE = /\b(?:current|latest|recent|new|changed|updated|what(?: does| do) .* law|legal requirement(?:s)?|regulatory requirement(?:s)?|regulation(?:s)?|rule(?:s)?|filing(?:s)?)\b/i
const INTERNAL_ONLY_RE = /\b(?:our|we|us|my|internal|this business|our business|our operations|our process|our system)\b/i

// Deep-audit fix (2026-09-13): this re-inclusion list used to also contain 'latest'/'recent', but
// those two words are already REQUIRED to reach this line at all -- they're part of EXTERNAL_SIGNAL_RE
// above, which gates entry via the `if (!EXTERNAL_SIGNAL_RE.test(text)) return false` at the top. Any
// text that reached this point via "latest"/"recent" would therefore always contain "latest"/"recent"
// itself and automatically satisfy this re-inclusion check, making the whole INTERNAL_ONLY_RE exclusion
// a no-op for those two triggers: "Any recent changes to our internal process?" matched
// EXTERNAL_SIGNAL_RE on "recent", matched INTERNAL_ONLY_RE on "our"/"internal", but then also matched
// this re-inclusion regex on the same "recent" -- so the exclusion never actually fired. Genuinely
// external-flavored words (competitor/rival/news/market/industry/sector/research/search/etc.) are
// still real, independent re-inclusion signals and are kept.
const EXTERNAL_REINCLUSION_RE = /\b(?:competitor|rival|news|market|industry|sector|research|search|look\s+up|fact[- ]check)\b/i
function externalInvestigationSignal(text: string): boolean {
  if (!EXTERNAL_SIGNAL_RE.test(text)) return false
  if (/\b(?:compliance|regulatory)\b/i.test(text) && !EXPLICIT_EXTERNAL_REGULATORY_RE.test(text)) return false
  if (INTERNAL_ONLY_RE.test(text) && !EXTERNAL_REINCLUSION_RE.test(text)) return false
  return true
}

// Deep-audit fix (2026-09-20, Source Authority Phase 4 follow-up): this used to scan
// context.currentMessage -- the ENTIRE raw message, including any pasted source document -- so a
// long document that merely mentioned "research"/"search"/"news"/"market"/"competitor" anywhere in
// its own body could trigger real external web evidence acquisition regardless of what the user
// actually asked, bypassing the whole instruction/source separation the rest of this initiative
// exists to enforce (this module was never touched by PRs #185/#186/#188-195). Now prefers the
// canonical authoritative instruction segment (turnEnvelope.instruction.authoritativeText), falling
// back to currentMessage only for callers/tests without a populated turnEnvelope.
// context.meaning is deliberately NOT concatenated here anymore: deterministicMeaning
// (ceo-cognitive-conversation.ts) falls back to normalize(currentMessage) -- the entire raw message
// again -- whenever there's no resolved reference and no conversation topic, which silently
// reintroduced the exact same unbounded-source leak this fix removes from currentMessage directly.
function externalRequirementSignal(context: CanonicalConversationContext): boolean {
  const text = (context.turnEnvelope?.instruction?.authoritativeText ?? context.currentMessage).trim()
  if (INTERNAL_ONLY_RE.test(text) && !externalInvestigationSignal(text)) return false
  // Deep-audit fix (2026-09-20): context.intentHint comes from userIntentHint's plain research
  // check, which (unlike its self-assessment branch) was never gated on sourceMaterialPresent -- it
  // still scans the full windowed instruction, head AND tail. A source-tail "research the latest
  // public information... search for recent news" appendix could set intentHint to 'research' even
  // though the authoritative instruction asked for something else entirely, and this check trusted
  // that unconditionally. turnEnvelope.requestedOperation is computed from the authoritative
  // instruction segment alone, so it isn't exposed to that tail contamination.
  // context.semanticInterpretation.suggestedIntent is left as-is: it's the model-assisted layer's own
  // judgment, not a raw keyword match over source-contaminated text.
  if (context.turnEnvelope?.requestedOperation === 'research' || context.semanticInterpretation.suggestedIntent === 'research') return true
  return externalInvestigationSignal(text)
}

export function assessCeoCuriosity(context: CanonicalConversationContext, contract: ConversationDecisionContract, world?: CeoWorldModel): CeoCuriosityDecision {
  if (contract.toolRequirement === 'none' && contract.evidenceRequirement === 'none') {
    return { investigate: false, reason: 'No external information is required by the current decision.', materialUnknowns: [] }
  }
  if (contract.responseAction === 'clarify' || contract.responseAction === 'explain' || contract.responseAction === 'challenge') {
    return { investigate: false, reason: 'Resolve the conversational objective before acquiring external evidence.', materialUnknowns: [] }
  }
  const requiresExternal = externalRequirementSignal(context)
  const alreadyHasEvidence = world?.external.data.evidenceState === 'available'
  if (alreadyHasEvidence && requiresExternal) {
    return { investigate: false, reason: 'External evidence relevant to this request has already been acquired; investigating again would be redundant.', materialUnknowns: [] }
  }
  if (contract.evidenceRequirement === 'required' && requiresExternal) {
    return { investigate: true, reason: 'The canonical decision contract requires evidence and the request explicitly depends on external reality.', materialUnknowns: ['Current external facts needed to satisfy the request'] }
  }
  if (contract.evidenceRequirement === 'possible' && requiresExternal) {
    return { investigate: true, reason: 'External evidence is optional in the abstract, but the request contains a material external-world signal that could change the decision.', materialUnknowns: ['External facts may materially change the recommendation or decision'] }
  }
  return { investigate: false, reason: 'The available context is sufficient and no material external uncertainty has been identified.', materialUnknowns: [] }
}
