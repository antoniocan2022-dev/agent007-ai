import type { CanonicalConversationContext } from './ceo-cognitive-conversation'
import type { ConversationDecisionContract } from './ceo-conversation-decision-contract'

export interface CeoCuriosityDecision {
  investigate: boolean
  reason: string
  materialUnknowns: string[]
}

const EXTERNAL_SIGNAL_RE = /\b(?:competitor(?:s)?|rival(?:s)?|news|headlines?|market(?:s)?|industry|sector|macro(?:economic)?|stock(?:s)?|shares?|equity|ticker|valuation|10-k|10-q|sec\s+filing|latest|recent|research|search|look\s+up|verify|validate|fact[- ]check)\b/i
const EXPLICIT_EXTERNAL_REGULATORY_RE = /\b(?:current|latest|recent|new|changed|updated|what(?: does| do) .* law|legal requirement(?:s)?|regulatory requirement(?:s)?|regulation(?:s)?|rule(?:s)?|filing(?:s)?)\b/i
const INTERNAL_ONLY_RE = /\b(?:our|we|us|my|internal|this business|our business|our operations|our process|our system)\b/i

function externalInvestigationSignal(text: string): boolean {
  if (!EXTERNAL_SIGNAL_RE.test(text)) return false
  if (/\b(?:compliance|regulatory)\b/i.test(text) && !EXPLICIT_EXTERNAL_REGULATORY_RE.test(text)) return false
  if (INTERNAL_ONLY_RE.test(text) && !/\b(?:competitor|rival|news|market|industry|sector|latest|recent|research|search|verify|validate)\b/i.test(text)) return false
  return true
}

function externalRequirementSignal(context: CanonicalConversationContext): boolean {
  if (context.intentHint === 'research') return true
  if (context.semanticInterpretation.suggestedIntent === 'research') return true
  return externalInvestigationSignal(`${context.currentMessage} ${context.meaning}`)
}

export function assessCeoCuriosity(context: CanonicalConversationContext, contract: ConversationDecisionContract): CeoCuriosityDecision {
  if (contract.toolRequirement === 'none' && contract.evidenceRequirement === 'none') {
    return { investigate: false, reason: 'No external information is required by the current decision.', materialUnknowns: [] }
  }
  if (contract.responseAction === 'clarify' || contract.responseAction === 'explain' || contract.responseAction === 'challenge') {
    return { investigate: false, reason: 'Resolve the conversational objective before acquiring external evidence.', materialUnknowns: [] }
  }
  const requiresExternal = externalRequirementSignal(context)
  if (contract.evidenceRequirement === 'required' && requiresExternal) {
    return { investigate: true, reason: 'The canonical decision contract requires evidence and the request explicitly depends on external reality.', materialUnknowns: ['Current external facts needed to satisfy the request'] }
  }
  if (contract.evidenceRequirement === 'possible' && requiresExternal) {
    return { investigate: true, reason: 'External evidence is optional in the abstract, but the request contains a material external-world signal that could change the decision.', materialUnknowns: ['External facts may materially change the recommendation or decision'] }
  }
  return { investigate: false, reason: 'The available context is sufficient and no material external uncertainty has been identified.', materialUnknowns: [] }
}
