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
//
// Self-repair follow-up (2026-09-25): 'contradictionPreservation' is not one of the six scored
// conversational dimensions below (it comes from ceo-structural-quality-gate.ts's boolean
// contradictionPreserved, not a 0-100 score) but sits at the FRONT of this priority order -- an
// answer that silently resolved a source contradiction to one side is factually wrong, the same
// severity class as a broken reference, not a polish issue like tone/coherence. It is deliberately
// the ONLY structural-quality-gate finding wired in here: claimCoverageOk (whether the answer draws
// on enough of the document) is excluded on purpose, because it is permanently unwinnable within a
// turn once sourceCoverageComplete is false (see isFutileStructuralCoverageEscalation in
// ceo-cognitive-lifecycle.ts) -- routing it through a "repair" pass would just spend a call
// reproducing the identical failure. Contradiction preservation is different: the escalation loop's
// own comment already establishes it as genuinely fixable by adding acknowledgment language, so it
// belongs in the same structured, priority-ordered repair mechanism conversational failures get,
// not the escalation loop's unstructured raw-reason-dump prompt.
const REPAIR_PRIORITY_ORDER = ['contradictionPreservation', 'referenceResolution', 'relevance', 'continuity', 'coherence', 'naturalness', 'personalityConsistency'] as const

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
  // Self-repair follow-up (2026-09-25): see REPAIR_PRIORITY_ORDER's comment above for why this is the
  // one structural-quality-gate finding wired into failedDimensions here (never claimCoverageOk).
  const contradictionUnpreserved = input.quality.structuralQuality?.applicable === true && !input.quality.structuralQuality.contradictionPreserved
  if (contradictionUnpreserved) failedDimensions.unshift('contradictionPreservation')
  const repairPriority = REPAIR_PRIORITY_ORDER.filter((dimension) => failedDimensions.includes(dimension))

  // Deep-audit finding: this used to be a second, independently-drifting copy of the same "genuine
  // overclaim, never repair -- degrade outright" list kept in ceo-cognitive-lifecycle.ts's own local
  // isGenuineOverclaim, and neither included false_completion_claim/internal_artifact_leak (both used to
  // be indistinguishable from an ordinary phrasing miss under the generic 'quality_failure' reason). A
  // false completion claim or a leaked artifact must never be sent through a "repair the specific issues"
  // pass that could just as easily produce a more polished version of the same violation -- straight to
  // DEGRADE, matching the factual/evidentiary reasons already here.
  const isGenuineOverclaim = input.quality.failureReason === 'evidence_unavailable' || input.quality.failureReason === 'evidence_insufficient' || input.quality.failureReason === 'claim_consistency_failure' || input.quality.failureReason === 'false_completion_claim' || input.quality.failureReason === 'internal_artifact_leak'
  let decision: SemanticQualityDecision
  if (!evidenceDiscipline || isGenuineOverclaim) decision = 'DEGRADE'
  // Ahead of contractSatisfied/meaningSatisfied/the scored dimensions: a silently-resolved source
  // contradiction is a correctness defect in what the answer asserts, not a phrasing or relevance
  // gap, so it takes priority the same way isGenuineOverclaim does -- the difference is this one is
  // repairable (per REPAIR_PRIORITY_ORDER's comment above), so it goes to REPAIR, not DEGRADE.
  else if (contradictionUnpreserved) decision = 'REPAIR'
  else if (!contractSatisfied) decision = 'REPAIR'
  else if (!meaningSatisfied) decision = 'REPAIR'
  else if (failedDimensions.length > 0) decision = 'REPAIR'
  else decision = 'PASS'

  return { schemaVersion: 1, decision, meaningSatisfied, contractSatisfied, continuity, referenceResolution, relevance, naturalness, coherence, evidenceDiscipline, personalityConsistency, failedDimensions, repairPriority }
}

const REPAIR_INSTRUCTION_FOR: Record<string, string> = {
  contradictionPreservation: 'The source material contained an apparent contradiction or discrepancy between sections that your previous answer did not acknowledge. Add explicit acknowledgment of the discrepancy (e.g., note that the sources disagree, or present the differing figures/claims side by side) instead of silently resolving it to one side.',
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
  const evidenceConstraints = ['Do not introduce any new factual claim, number, or assertion that was not already present in the draft or directly supported by the conversation.']
  // A contradiction repair's own failure mode is different from an ordinary phrasing fix: the model
  // might "resolve" it by picking whichever side it now finds more plausible rather than genuinely
  // acknowledging the discrepancy -- call that out explicitly, not just the generic no-new-claims rule.
  if (report.failedDimensions.includes('contradictionPreservation')) evidenceConstraints.push('Do not resolve the contradiction by silently picking one side as correct -- acknowledge that the source material itself disagrees.')
  return {
    schemaVersion: 1,
    failedDimensions: report.failedDimensions,
    preserveDimensions,
    repairInstructions,
    evidenceConstraints,
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
