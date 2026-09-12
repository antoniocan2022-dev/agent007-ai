import type { CanonicalConversationContext } from './ceo-cognitive-conversation'
import type { ConversationDecisionContract } from './ceo-conversation-decision-contract'
import { getExecutionFailures, getOpenExecutions, type ExecutionReceiptRecord } from './proof-ledger'
import { listOpenRecommendationsForVenture, type CeoRecommendation } from './ceo-outcome-learning'

export interface CeoSelfInspectionDecision { inspect: boolean; reason: string; questions: string[] }

// The internal-history counterpart to ceo-curiosity.ts's assessCeoCuriosity(): that function asks
// "should I investigate the world"; this one asks "should I investigate myself" before answering.
// Deliberately does not gate on phrase-matching alone (unlike the old self-assessment detector) --
// a recommend/decide response is exactly the moment a track-record check matters most, whether or
// not the user's wording mentions the past at all.
//
// Post-merge audit fix (2026-09-12): the first version of this regex matched a bare temporal word
// ("again", "before", "already", "earlier", "previously") ANYWHERE in the message, which meant
// ordinary sentences with no history-referencing intent at all -- "Can we schedule the call before
// Friday?", "I already paid the invoice", "Let's sync again next week" -- all set inspect:true and
// tripped route.ts's full CEO Grounding Policy fetch (a real DB-scan-backed executiveState/
// leadershipLedger/strategicHorizon computation) plus an extra recommendation-ledger query, directly
// contradicting this file's own "minimum sufficient live context" design goal. A temporal word now
// only counts when it appears near a verb that actually names a past action being asked about
// (tried, did, attempted, recommended, suggested, worked, happened, succeeded, failed) -- "do this
// again" (forward-looking) does not match, but "did we do this again" or "tried this before" does.
const HISTORY_ACTION_VERB = '(?:tr(?:y|ies|ied|ying)|attempt(?:s|ed|ing)?|done|did|recommend(?:s|ed|ing)?|suggest(?:s|ed|ing)?|work(?:s|ed|ing)?|happen(?:s|ed|ing)?|succeed(?:s|ed|ing)?|fail(?:s|ed|ing)?)'
const HISTORY_TEMPORAL_WORD = '(?:again|before|already|previously|earlier|last\\s+time|prior\\s+attempt)'
const SELF_HISTORY_SIGNAL_RE = new RegExp(
  '\\bhave\\s+(?:i|we)\\s+(?:already\\s+|previously\\s+)?(?:tried|done|recommended|attempted)\\b'
  + '|\\bdid\\s+(?:i|we)\\s+(?:already|previously)\\b'
  + '|\\bwhat\\s+happened\\s+(?:to|with)\\b'
  + '|\\bdid\\s+(?:this|that|it)\\s+work\\b'
  + '|\\bwas\\s+(?:this|that|it)\\s+tried\\b'
  + `|\\b${HISTORY_ACTION_VERB}\\b[^.?!]{0,25}\\b${HISTORY_TEMPORAL_WORD}\\b`
  + `|\\b${HISTORY_TEMPORAL_WORD}\\b[^.?!]{0,25}\\b${HISTORY_ACTION_VERB}\\b`,
  'i',
)

export function assessCeoSelfInspection(context: CanonicalConversationContext, contract: ConversationDecisionContract): CeoSelfInspectionDecision {
  const questions: string[] = []
  if (context.intentHint === 'self_assessment') questions.push('What is my current, real state?')
  if (contract.responseAction === 'recommend' || contract.responseAction === 'decide') questions.push('Have I already recommended or decided this, and what happened?')
  if (SELF_HISTORY_SIGNAL_RE.test(context.currentMessage)) questions.push('What does my own execution/outcome history show for this?')
  if (!questions.length) return { inspect: false, reason: 'No signal that this turn depends on my own execution history.', questions: [] }
  return { inspect: true, reason: 'The current decision, or the request itself, depends on what I have already done, decided, or observed.', questions }
}

export interface CeoSelfInspectionEvidence {
  // Post-merge audit fix (2026-09-12): a single blanket `dataAvailable` flag conflated two
  // independent dimensions -- recommendation-ledger state (gated on ventureId) and execution-receipt
  // history (gated on missionIds). Before this, route.ts never actually supplied missionIds, so
  // recentFailures/openExecutions were always [] while dataAvailable read true, and
  // renderCeoSelfInspectionContext printed a confident "none" where the honest answer was "not
  // checked". Each dimension now reports its own availability, exactly like ExecutiveBusinessState's
  // per-facet dataAvailable flags already do.
  recommendationsAvailable: boolean
  openRecommendations: readonly CeoRecommendation[]
  executionHistoryAvailable: boolean
  recentFailures: readonly ExecutionReceiptRecord[]
  openExecutions: readonly ExecutionReceiptRecord[]
}

export const EMPTY_SELF_INSPECTION_EVIDENCE: CeoSelfInspectionEvidence = Object.freeze({
  recommendationsAvailable: false,
  openRecommendations: [],
  executionHistoryAvailable: false,
  recentFailures: [],
  openExecutions: [],
})

// Bounds how many of the caller's active missions get queried for execution-receipt evidence per
// turn -- keeps the worst-case DB fan-out predictable even for a user running many missions at once.
const MAX_INSPECTED_MISSIONS = 5
// Bounds how many failure/open-execution records survive the merge across missions, so a user with
// many active missions doesn't get an unbounded wall of text in the rendered context.
const MAX_EXECUTIONS_PER_DIMENSION = 10

function byRecencyDesc(a: ExecutionReceiptRecord, b: ExecutionReceiptRecord): number {
  return Date.parse(b.createdAt) - Date.parse(a.createdAt)
}

// Read-only: gathers real evidence, never re-triggers or replays anything it finds. missionIds
// covers every mission the caller currently has active (route.ts passes the same shared list it
// already fetches for the leadership/strategic-horizon lanes) -- there is no single "the" mission in
// the general conversational entry point, so this fans out across all of them (bounded) rather than
// arbitrarily picking one or silently skipping the question.
export async function gatherCeoSelfInspectionEvidence(input: { ventureId?: string | null; missionIds?: readonly string[] | null }): Promise<CeoSelfInspectionEvidence> {
  const ventureId = input.ventureId?.trim()
  const missionIds = [...new Set((input.missionIds ?? []).map((id) => id?.trim()).filter((id): id is string => Boolean(id)))].slice(0, MAX_INSPECTED_MISSIONS)
  if (!ventureId && !missionIds.length) return EMPTY_SELF_INSPECTION_EVIDENCE

  const [openRecommendations, failureBatches, openBatches] = await Promise.all([
    ventureId ? listOpenRecommendationsForVenture(ventureId) : Promise.resolve([] as readonly CeoRecommendation[]),
    missionIds.length ? Promise.all(missionIds.map((missionId) => getExecutionFailures(missionId))) : Promise.resolve([] as (readonly ExecutionReceiptRecord[])[]),
    missionIds.length ? Promise.all(missionIds.map((missionId) => getOpenExecutions(missionId))) : Promise.resolve([] as (readonly ExecutionReceiptRecord[])[]),
  ])

  return {
    recommendationsAvailable: Boolean(ventureId),
    openRecommendations,
    executionHistoryAvailable: missionIds.length > 0,
    recentFailures: failureBatches.flat().sort(byRecencyDesc).slice(0, MAX_EXECUTIONS_PER_DIMENSION),
    openExecutions: openBatches.flat().sort(byRecencyDesc).slice(0, MAX_EXECUTIONS_PER_DIMENSION),
  }
}

export function renderCeoSelfInspectionContext(evidence: CeoSelfInspectionEvidence): string {
  if (!evidence.recommendationsAvailable && !evidence.executionHistoryAvailable) {
    return 'CEO SELF-INSPECTION (own execution/outcome history): not evaluated for this turn.'
  }
  const lines = ['CEO SELF-INSPECTION (own execution/outcome history; read-only -- informs the current answer, never re-triggers a past action):']
  lines.push(
    evidence.recommendationsAvailable
      ? (evidence.openRecommendations.length ? `Open recommendations awaiting outcome: ${evidence.openRecommendations.slice(0, 5).map((r) => r.objective.slice(0, 140)).join(' | ')}` : 'Open recommendations awaiting outcome: none.')
      : 'Open recommendations awaiting outcome: not evaluated for this turn.',
  )
  lines.push(
    evidence.executionHistoryAvailable
      ? (evidence.openExecutions.length ? `Executions started but not completed: ${evidence.openExecutions.length}.` : 'Executions started but not completed: none.')
      : 'Executions started but not completed: not evaluated for this turn.',
  )
  lines.push(
    evidence.executionHistoryAvailable
      ? (evidence.recentFailures.length ? `Recent execution failures: ${evidence.recentFailures.slice(0, 5).map((r) => `${r.action} (${r.status})`).join(', ')}.` : 'Recent execution failures: none.')
      : 'Recent execution failures: not evaluated for this turn.',
  )
  return lines.join('\n')
}
