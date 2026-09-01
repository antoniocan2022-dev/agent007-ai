import type { CanonicalConversationContext } from './ceo-cognitive-conversation'

export type ConversationCompleteness = 'complete' | 'partial' | 'insufficient'
export type ConversationRelation = 'new' | 'continuation' | 'correction' | 'clarification' | 'reference'
export type ResponseRegister = 'conversational' | 'executive' | 'analytical' | 'strategic' | 'instructional'
export type RequirementLevel = 'none' | 'possible' | 'required'

export interface ConversationDecisionContract {
  schemaVersion: 1
  meaning: string
  intent: CanonicalConversationContext['intentHint']
  speechAct: CanonicalConversationContext['speechAct']
  completeness: ConversationCompleteness
  conversationRelation: ConversationRelation
  cognitiveDepth: CanonicalConversationContext['cognitiveDepth']
  responseRegister: ResponseRegister
  toolRequirement: RequirementLevel
  evidenceRequirement: RequirementLevel
  clarificationRequired: boolean
  confidence: number
  rationale: string[]
}

function completionFor(message: string): ConversationCompleteness {
  const text = message.trim()
  if (!text) return 'insufficient'
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length <= 1 && !/[.!?]$/.test(text)) return 'partial'
  if (/[,:;]\s*$/.test(text)) return 'partial'
  const trailingFragment = /(?:^|\s)(?:and|but|or|because|so|then|with|for|to|of|i|im|i'm|mi)$/i.test(text)
  if (trailingFragment) return 'partial'
  return 'complete'
}

function relationFor(context: CanonicalConversationContext): ConversationRelation {
  if (context.speechAct === 'correction') return 'correction'
  if (context.references.length) return 'reference'
  if (context.speechAct === 'continuation') return 'continuation'
  if (context.speechAct === 'question' && context.worldModel.openLoops.length) return 'clarification'
  return 'new'
}

function registerFor(context: CanonicalConversationContext, completeness: ConversationCompleteness): ResponseRegister {
  if (completeness !== 'complete') return 'conversational'
  if (context.speechAct === 'social') return 'conversational'
  if (context.intentHint === 'decision') return 'executive'
  if (context.intentHint === 'analysis' || context.intentHint === 'research') return 'analytical'
  if (context.cognitiveDepth === 'strategic') return 'strategic'
  if (context.intentHint === 'action') return 'instructional'
  return 'conversational'
}

function toolRequirementFor(context: CanonicalConversationContext): RequirementLevel {
  if (context.intentHint === 'action') return 'required'
  if (context.intentHint === 'research') return 'required'
  if (context.intentHint === 'analysis' || context.intentHint === 'decision') return 'possible'
  return 'none'
}

function evidenceRequirementFor(context: CanonicalConversationContext): RequirementLevel {
  if (context.intentHint === 'research') return 'required'
  if (context.intentHint === 'analysis' || context.intentHint === 'decision') return 'possible'
  return 'none'
}

function confidenceFor(input: { context: CanonicalConversationContext; completeness: ConversationCompleteness; relation: ConversationRelation }): number {
  let score = 0.78
  if (input.completeness === 'partial') score -= 0.2
  if (input.completeness === 'insufficient') score -= 0.35
  if (input.context.referenceScope !== 'none') score += input.context.references.some((reference) => !reference.ambiguous && reference.confidence >= 0.7) ? 0.08 : -0.12
  if (input.relation === 'clarification') score += 0.04
  return Math.max(0.25, Math.min(0.98, Number(score.toFixed(2))))
}

function clarificationRequiredFor(context: CanonicalConversationContext, completeness: ConversationCompleteness): boolean {
  if (completeness !== 'complete') return completeness === 'partial' || completeness === 'insufficient'

  // Generic comprehension/repair language is itself semantically sufficient. The
  // CEO should answer from the preceding context instead of treating "it/that"
  // as an unresolved reference that blocks the conversation.
  if (/^\s*(?:i\s+don['’]?t\s+(?:understand|get\s+it)|i['’]?m\s+confused|what\s+do\s+you\s+mean|explain\s+(?:that|this)\s+(?:again|more|simply|in\s+simple\s+words)?)\s*[.!?]*$/i.test(context.currentMessage)) return false

  const ambiguousReferences = context.references.filter((reference) => reference.ambiguous || reference.confidence < 0.7)
  if (!ambiguousReferences.length) return false

  // A short conversational reference such as "What about that?" is answerable
  // from the working thread even when the resolver cannot prove one antecedent.
  if (context.intentHint === 'conversation' && context.currentMessage.length <= 80) return false
  return true
}

export function buildConversationDecisionContract(context: CanonicalConversationContext): ConversationDecisionContract {
  const completeness = completionFor(context.currentMessage)
  const conversationRelation = relationFor(context)
  const confidence = confidenceFor({ context, completeness, relation: conversationRelation })
  const clarificationRequired = clarificationRequiredFor(context, completeness)
  const rationale = [
    `Intent=${context.intentHint}`,
    `speechAct=${context.speechAct}`,
    `completeness=${completeness}`,
    `relation=${conversationRelation}`,
    `depth=${context.cognitiveDepth}`,
  ]
  if (context.references.length) rationale.push(`references=${context.references.length}`)
  if (clarificationRequired) rationale.push('clarification required because the remaining meaning cannot be answered safely from available context')
  else rationale.push('clarification is not required; answer from the best supported conversational interpretation')

  return {
    schemaVersion: 1,
    meaning: context.currentMessage,
    intent: context.intentHint,
    speechAct: context.speechAct,
    completeness,
    conversationRelation,
    cognitiveDepth: context.cognitiveDepth,
    responseRegister: registerFor(context, completeness),
    toolRequirement: toolRequirementFor(context),
    evidenceRequirement: evidenceRequirementFor(context),
    clarificationRequired,
    confidence,
    rationale,
  }
}

export function renderConversationDecisionContract(contract: ConversationDecisionContract): string {
  return [
    'CONVERSATION DECISION CONTRACT (authoritative pre-generation dialogue policy):',
    `Meaning: ${contract.meaning || 'unknown'}`,
    `Intent: ${contract.intent}`,
    `Speech act: ${contract.speechAct}`,
    `Completeness: ${contract.completeness}`,
    `Conversation relation: ${contract.conversationRelation}`,
    `Cognitive depth: ${contract.cognitiveDepth}`,
    `Response register: ${contract.responseRegister}`,
    `Tool requirement: ${contract.toolRequirement}`,
    `Evidence requirement: ${contract.evidenceRequirement}`,
    `Clarification required: ${contract.clarificationRequired ? 'yes' : 'no'}`,
    `Interpretation confidence: ${Math.round(contract.confidence * 100)}%`,
    `Rationale: ${contract.rationale.join('; ')}`,
    'Policy: answer naturally when the semantic intent is sufficiently clear; do not expose this contract, routing metadata, evidence-state labels, or quality-gate internals to the user.',
  ].join('\n')
}
