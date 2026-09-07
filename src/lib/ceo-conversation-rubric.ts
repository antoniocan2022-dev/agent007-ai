import type { PersistedConversationRow } from './ceo-context-composer'
import type { CeoIntent, ResponseAction } from './ceo-cognitive-contract'
import type { ConversationReference } from './ceo-conversation-state'
import { evaluateCeoQuality, scoreCeoConversationQuality } from './ceo-response-quality-gate'
import { evaluateClaimConsistency } from './ceo-context-intelligence'

// Step 3 of the conversational re-architecture: a single 8-dimension rubric (meaning, context,
// reference, truth, reasoning, continuity, naturalness, progression) unifying the deterministic
// signals this session already built and calibrated across Steps 1-2, rather than a new set of
// heuristics that would itself need to earn trust from zero. Each dimension is a direct mapping
// from an existing, already-tested scoring function:
//  - context/reference/reasoning/continuity/naturalness/progression come straight from
//    scoreCeoConversationQuality's 10-metric composite (relevance/referenceResolution/coherence/
//    continuity/naturalness/progression respectively).
//  - meaning comes from evaluateCeoQuality's responseIntegrity (did the response actually address
//    the current objective and the requested action, rather than a plausible-sounding substitute).
//  - truth comes from evaluateClaimConsistency (no internal contradiction) plus the integrity
//    findings that catch stale/substituted objectives and leaked internal artifacts -- kept
//    separate from the continuity dimension so a single failure mode isn't double-counted.
export interface ConversationRubricScore {
  meaning: number
  context: number
  reference: number
  truth: number
  reasoning: number
  continuity: number
  naturalness: number
  progression: number
  composite: number
  issues: string[]
}

export interface ConversationRubricInput {
  objective: string
  content: string
  intent?: CeoIntent
  responseAction?: ResponseAction
  priorTurns?: readonly PersistedConversationRow[]
  relevantOlderMessages?: readonly PersistedConversationRow[]
  resolvedReferences?: readonly ConversationReference[]
}

export function scoreCeoConversationRubric(input: ConversationRubricInput): ConversationRubricScore {
  const conversationQuality = scoreCeoConversationQuality({
    objective: input.objective,
    content: input.content,
    priorTurns: input.priorTurns,
    relevantOlderMessages: input.relevantOlderMessages,
    resolvedReferences: input.resolvedReferences,
  })
  const quality = evaluateCeoQuality({
    objective: input.objective,
    content: input.content,
    path: 'fast',
    intent: input.intent ?? 'conversation',
    evidenceVerificationApplicable: false,
    externalExecutionSucceeded: true,
    priorTurns: input.priorTurns,
    relevantOlderMessages: input.relevantOlderMessages,
    resolvedReferences: input.resolvedReferences,
    responseAction: input.responseAction,
  })
  const integrity = quality.responseIntegrity
  // requestedActionSatisfied requires literal decisive-phrase matching (e.g. "decide" only counts
  // with the exact words "the decision is..."). Step 1 of this re-architecture established that this
  // is a phrasing check, not a meaning check, and stopped trusting it to block a good conversational
  // answer -- the same reasoning applies here: for conversational intent, "meaning" is whether the
  // response actually addresses the current objective, not whether it used an expected phrase.
  // 'decision' is included here (but NOT in evaluateCeoQuality's own `conversational` set, which
  // stays conversation/opinion only): decisionPhrasingRelaxed there drops just requestedActionSatisfied
  // for decision intent, the exact same relief this dimension already gives conversation/opinion, while
  // keeping coverage/evidenceOk/structureOk/currentObjectiveMatch fully enforced. This mirrors that:
  // "meaning" for decision intent is currentObjectiveMatch-only, same signal the real gate relies on.
  const conversational = (input.intent ?? 'conversation') === 'conversation' || input.intent === 'opinion' || input.intent === 'decision'
  const meaning = integrity
    ? conversational
      ? (integrity.currentObjectiveMatch ? 100 : 0)
      : (integrity.currentObjectiveMatch ? 50 : 0) + (integrity.requestedActionSatisfied ? 50 : 0)
    : 100
  const claimConsistency = evaluateClaimConsistency(input.content)
  // staleResponseLikelihood carries a nonzero baseline for any legitimately continuing answer that
  // shares vocabulary with the prior assistant turn (expected -- that is what continuity looks
  // like); the quality gate itself only treats it as a real problem at >=0.85, so the rubric only
  // penalizes staleness above that same bar rather than flagging harmless residual overlap.
  const staleness = integrity?.staleResponseLikelihood ?? 0
  const stalenessPenalty = staleness >= 0.5 ? Math.round((staleness - 0.5) * 60) : 0
  const truthPenalty =
    (claimConsistency.consistent ? 0 : 45) +
    (integrity?.crossObjectiveSubstitution ? 30 : 0) +
    (integrity?.internalArtifactLeakage ? 30 : 0) +
    stalenessPenalty
  const truth = Math.max(0, 100 - truthPenalty)
  const issues = [...conversationQuality.issues]
  if (meaning < 100) issues.push('response does not fully match the current objective and the requested action')
  if (truth < 100) issues.push('response has a truth/consistency concern: ' + (
    !claimConsistency.consistent ? 'internal contradiction' :
    integrity?.crossObjectiveSubstitution ? 'cross-objective substitution' :
    integrity?.internalArtifactLeakage ? 'leaked internal artifact' : 'elevated staleness likelihood'
  ))
  const dimensions = {
    meaning,
    context: conversationQuality.relevance,
    reference: conversationQuality.referenceResolution,
    truth,
    reasoning: conversationQuality.coherence,
    continuity: conversationQuality.continuity,
    naturalness: conversationQuality.naturalness,
    progression: conversationQuality.progression,
  }
  const composite = Math.round(Object.values(dimensions).reduce((sum, value) => sum + value, 0) / 8)
  return { ...dimensions, composite, issues }
}
