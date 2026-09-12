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
const SELF_HISTORY_SIGNAL_RE = /\b(?:again|before|already|previously|last\s+time|earlier|prior\s+attempt|have\s+(?:i|we)\s+(?:tried|done|recommended|attempted)|did\s+(?:i|we)\s+(?:already|previously)|what\s+happened\s+(?:to|with)|did\s+(?:this|that|it)\s+work|was\s+(?:this|that|it)\s+tried)\b/i

export function assessCeoSelfInspection(context: CanonicalConversationContext, contract: ConversationDecisionContract): CeoSelfInspectionDecision {
  const questions: string[] = []
  if (context.intentHint === 'self_assessment') questions.push('What is my current, real state?')
  if (contract.responseAction === 'recommend' || contract.responseAction === 'decide') questions.push('Have I already recommended or decided this, and what happened?')
  if (SELF_HISTORY_SIGNAL_RE.test(context.currentMessage)) questions.push('What does my own execution/outcome history show for this?')
  if (!questions.length) return { inspect: false, reason: 'No signal that this turn depends on my own execution history.', questions: [] }
  return { inspect: true, reason: 'The current decision, or the request itself, depends on what I have already done, decided, or observed.', questions }
}

export interface CeoSelfInspectionEvidence {
  dataAvailable: boolean
  openRecommendations: readonly CeoRecommendation[]
  recentFailures: readonly ExecutionReceiptRecord[]
  openExecutions: readonly ExecutionReceiptRecord[]
}

export const EMPTY_SELF_INSPECTION_EVIDENCE: CeoSelfInspectionEvidence = Object.freeze({ dataAvailable: false, openRecommendations: [], recentFailures: [], openExecutions: [] })

// Read-only: gathers real evidence, never re-triggers or replays anything it finds. missionId is
// only ever available in the mission-execution lane (not the general conversational entry point,
// where no reliable missionId extractor exists) -- the execution-receipt questions are honestly
// skipped, not guessed, when it's absent, same discipline as executiveState's dataAvailable flag.
export async function gatherCeoSelfInspectionEvidence(input: { ventureId?: string | null; missionId?: string | null }): Promise<CeoSelfInspectionEvidence> {
  const ventureId = input.ventureId?.trim()
  const missionId = input.missionId?.trim()
  if (!ventureId && !missionId) return EMPTY_SELF_INSPECTION_EVIDENCE
  const [openRecommendations, recentFailures, openExecutions] = await Promise.all([
    ventureId ? listOpenRecommendationsForVenture(ventureId) : Promise.resolve([] as readonly CeoRecommendation[]),
    missionId ? getExecutionFailures(missionId) : Promise.resolve([] as readonly ExecutionReceiptRecord[]),
    missionId ? getOpenExecutions(missionId) : Promise.resolve([] as readonly ExecutionReceiptRecord[]),
  ])
  return { dataAvailable: true, openRecommendations, recentFailures, openExecutions }
}

export function renderCeoSelfInspectionContext(evidence: CeoSelfInspectionEvidence): string {
  if (!evidence.dataAvailable) return 'CEO SELF-INSPECTION (own execution/outcome history): not evaluated for this turn.'
  const lines = ['CEO SELF-INSPECTION (own execution/outcome history; read-only -- informs the current answer, never re-triggers a past action):']
  lines.push(evidence.openRecommendations.length ? `Open recommendations awaiting outcome: ${evidence.openRecommendations.slice(0, 5).map((r) => r.objective.slice(0, 140)).join(' | ')}` : 'Open recommendations awaiting outcome: none.')
  lines.push(evidence.openExecutions.length ? `Executions started but not completed: ${evidence.openExecutions.length}.` : 'Executions started but not completed: none.')
  lines.push(evidence.recentFailures.length ? `Recent execution failures: ${evidence.recentFailures.slice(0, 5).map((r) => `${r.action} (${r.status})`).join(', ')}.` : 'Recent execution failures: none.')
  return lines.join('\n')
}
