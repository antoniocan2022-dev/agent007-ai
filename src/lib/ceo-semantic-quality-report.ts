import type { QualityResult, ResponseAction } from './ceo-cognitive-contract'
import type { ConversationDecisionContract } from './ceo-conversation-decision-contract'
import type { ConversationQualityScore } from './ceo-response-quality-gate'

export type SemanticQualityDecision = 'PASS' | 'REPAIR' | 'DEGRADE'

export interface SemanticQualityReport {
  schemaVersion: 1
  decision: SemanticQualityDecision
  meaningSatisfied: boolean
  contractSatisfied: boolean
  continuity: number
  referenceResolution: number
  relevance: number
  naturalness: number
  coherence: number
  evidenceDiscipline: boolean
  personalityConsistency: number
  failedDimensions: string[]
  repairPriority: string[]
}

export interface SemanticRepairPlan {
  schemaVersion: 1
  failedDimensions: string[]
  preserveDimensions: string[]
  repairInstructions: string[]
  evidenceConstraints: string[]
  maxAttempts: number
}

const DIMENSION_THRESHOLD = 70

// Repair priority is ordered by how foundational a dimension is to the answer being usable at all:
// a broken reference or a claim that isn't grounded in what the user actually asked makes the
// answer wrong outright, while tone/coherence/personality issues make an otherwise-correct answer
// merely less polished. Fix the former before the latter.
const REPAIR_PRIORITY_ORDER = ['referenceResolution', 'relevance', 'continuity', 'coherence', 'naturalness', 'personalityConsistency'] as const

function meaningSatisfiedFor(contract: ConversationDecisionContract, conversationQuality: ConversationQualityScore | undefined): boolean {
  if (!contract.meaning.trim()) return true
  if (!conversationQuality) return true
  return conversationQuality.relevance >= DIMENSION_THRESHOLD
}

// A dedicated, deterministic check per response action -- not another free-text judgment call.
// This is what makes the contract genuinely load-bearing for quality, not just for routing:
// a 'clarify' response that doesn't actually ask anything, or a 'challenge' response that never
// pushes back, has failed to do what the contract said it would do, independent of how fluent it reads.
function contractSatisfiedFor(action: ResponseAction, content: string): boolean {
  const text = content.trim()
  if (!text) return false
  if (action === 'clarify') return /\?\s*$/.test(text) || /\b(?:could you clarify|which (?:one|option)|do you mean)\b/i.test(text)
  if (action === 'challenge') return /\b(?:i(?:'d| would)?\s+push\s+back|i\s+want\s+to\s+challenge|worth\s+questioning|i'?m\s+not\s+sure\s+that'?s\s+right|i\s+don'?t\s+think\s+that'?s\s+quite\s+right)\b/i.test(text)
  if (action === 'execute' || action === 'verify') return text.length > 0
  return true
}

export function buildSemanticQualityReport(input: {
  quality: QualityResult
  conversationQuality?: ConversationQualityScore
  contract: ConversationDecisionContract
  content: string
}): SemanticQualityReport {
  const cq = input.conversationQuality
  const continuity = cq?.continuity ?? 100
  const referenceResolution = cq?.referenceResolution ?? 100
  const relevance = cq?.relevance ?? 100
  const naturalness = cq?.naturalness ?? 100
  const coherence = cq?.coherence ?? 100
  const personalityConsistency = cq?.personalityConsistency ?? 100
  const evidenceDiscipline = input.quality.checks.evidenceDiscipline
  const meaningSatisfied = meaningSatisfiedFor(input.contract, cq)
  const contractSatisfied = contractSatisfiedFor(input.contract.responseAction, input.content)

  const dimensionScores: Record<string, number> = { continuity, referenceResolution, relevance, naturalness, coherence, personalityConsistency }
  const failedDimensions = Object.entries(dimensionScores).filter(([, score]) => score < DIMENSION_THRESHOLD).map(([name]) => name)
  const repairPriority = REPAIR_PRIORITY_ORDER.filter((dimension) => failedDimensions.includes(dimension))

  const isGenuineOverclaim = input.quality.failureReason === 'evidence_unavailable' || input.quality.failureReason === 'evidence_insufficient' || input.quality.failureReason === 'claim_consistency_failure'
  let decision: SemanticQualityDecision
  if (!evidenceDiscipline || isGenuineOverclaim) decision = 'DEGRADE'
  else if (!contractSatisfied) decision = 'REPAIR'
  else if (!meaningSatisfied) decision = 'REPAIR'
  else if (failedDimensions.length > 0) decision = 'REPAIR'
  else decision = 'PASS'

  return { schemaVersion: 1, decision, meaningSatisfied, contractSatisfied, continuity, referenceResolution, relevance, naturalness, coherence, evidenceDiscipline, personalityConsistency, failedDimensions, repairPriority }
}

const REPAIR_INSTRUCTION_FOR: Record<string, string> = {
  referenceResolution: 'Resolve the reference the user made precisely -- state plainly what "it"/"that"/"the second one" refers to before continuing.',
  relevance: 'Directly address what the user actually asked or meant; do not answer an adjacent or more general question instead.',
  continuity: 'Ground the answer in what was actually established earlier in this conversation, not a generic restatement.',
  coherence: 'Make the logical connection between ideas explicit; do not leave claims unconnected or contradictory.',
  naturalness: 'Rewrite in plain, natural conversational language; remove any clinical, procedural, or robotic phrasing.',
  personalityConsistency: 'Speak with the same direct, confident, engaged voice used elsewhere in this conversation.',
}

export function buildSemanticRepairPlan(report: SemanticQualityReport): SemanticRepairPlan {
  const preserveDimensions = (['continuity', 'referenceResolution', 'relevance', 'naturalness', 'coherence', 'personalityConsistency'] as const)
    .filter((dimension) => !report.failedDimensions.includes(dimension))
  const repairInstructions = report.repairPriority.map((dimension) => REPAIR_INSTRUCTION_FOR[dimension]).filter((instruction): instruction is string => Boolean(instruction))
  if (!report.contractSatisfied) repairInstructions.unshift('The response did not fulfill what was actually asked (a clarifying question, a respectful challenge, or a completed action); produce a response that genuinely does so.')
  return {
    schemaVersion: 1,
    failedDimensions: report.failedDimensions,
    preserveDimensions,
    repairInstructions,
    evidenceConstraints: ['Do not introduce any new factual claim, number, or assertion that was not already present in the draft or directly supported by the conversation.'],
    maxAttempts: 1,
  }
}

export function renderSemanticRepairPrompt(objective: string, draft: string, plan: SemanticRepairPlan): { role: 'user'; content: string } {
  const preserve = plan.preserveDimensions.length ? `Preserve exactly what is already working: ${plan.preserveDimensions.join(', ')}. Do not rewrite these aspects.` : ''
  const instructions = plan.repairInstructions.map((instruction) => `- ${instruction}`).join('\n')
  return {
    role: 'user',
    content: `Repair only the specific problems below in your previous answer. This is a targeted repair, not a full rewrite.\n\nORIGINAL OBJECTIVE:\n${objective}\n\nPREVIOUS ANSWER:\n${draft.slice(0, 20000)}\n\nSPECIFIC PROBLEMS TO FIX:\n${instructions}\n\n${preserve}\n${plan.evidenceConstraints.join(' ')}\n\nReturn the repaired answer only.`,
  }
}
