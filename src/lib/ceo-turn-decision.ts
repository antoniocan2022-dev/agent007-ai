import { buildCeoDecisionPlan } from './ceo-cognitive-kernel'
import type { DecisionPlan, PreRouteDecision, CeoIntent, ResponseAction, OrchestrationOwner, CognitivePath } from './ceo-cognitive-contract'
import type { ConversationDecisionContract } from './ceo-conversation-decision-contract'
import type { ResearchObjectiveIdentity } from './ceo-research-objective'
import type { TaskType } from './subagent-governance'

/**
 * ceo-turn-decision.ts — Phase 2 of the CEO Conversation Kernel migration (external audit, 2026-09-19),
 * issue 1.
 *
 * Stage 2 investigated literally merging buildCeoDecisionPlan (execution/orchestration policy: path,
 * cognitive depth, escalation budget, orchestration owner) and buildConversationDecisionContract
 * (conversational/semantic decision: meaning, speech act, response action, behavioral policy) into one
 * type, and correctly concluded that was the wrong fix -- they answer genuinely different questions,
 * only responseAction bridges them, and a type-level merge would have touched ~20 call sites for no
 * correctness or performance benefit. See ceo-kernel-migration-baseline.test.ts for that finding.
 *
 * What was still missing, and what the external audit's issue 1 correctly named: even with both
 * artifacts legitimately separate, the codebase had no single object representing "the decision for
 * this turn" -- callers that needed both had to know to fetch each independently, and nothing stopped
 * a new call site from building either one fresh instead of reusing the turn's canonical copy (that
 * gap is issue 8, fixed in the same commit -- see route.ts's single buildCeoTurnDecision() call and the
 * decisionPlan?/optional threading this adds to runCeoCognitiveLifecycle and
 * tryOperationalDirectResponse).
 *
 * CeoTurnDecision is that single object: a thin, non-duplicating envelope built exactly once per turn,
 * at the earliest point both a PreRouteDecision and (when available) a ConversationDecisionContract are
 * known. It does not replace either underlying type -- DecisionPlan and ConversationDecisionContract are
 * both still fully real, still independently exported, still built by their own functions -- it is the
 * one place a caller goes to get "the turn's decision" instead of assembling it themselves from parts
 * that might not actually be the same turn's parts.
 */
export interface CeoTurnDecision {
  requestId: string
  decisionPlan: DecisionPlan
  decisionContract?: ConversationDecisionContract
  intent: CeoIntent
  responseAction?: ResponseAction
  orchestrationOwner: OrchestrationOwner
  path: CognitivePath
  researchObjective?: ResearchObjectiveIdentity
}

export function buildCeoTurnDecision(input: {
  messages: readonly { role: string; content: string }[]
  preRoute: PreRouteDecision
  missionId?: string
  taskType?: TaskType
  decisionContract?: ConversationDecisionContract
}): CeoTurnDecision {
  const decisionPlan = buildCeoDecisionPlan({ messages: input.messages, preRoute: input.preRoute, missionId: input.missionId, taskType: input.taskType })
  return {
    requestId: decisionPlan.requestId,
    decisionPlan,
    decisionContract: input.decisionContract,
    intent: decisionPlan.executionContract.intent,
    responseAction: input.decisionContract?.responseAction,
    orchestrationOwner: decisionPlan.executionContract.orchestrationOwner,
    path: decisionPlan.path,
    researchObjective: decisionPlan.researchObjective ?? input.preRoute.researchObjective ?? decisionPlan.executionContract.researchObjective,
  }
}
