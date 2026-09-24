import { randomUUID } from 'node:crypto'
import type { PreRouteDecision, DecisionPlan } from './ceo-cognitive-contract'
import { CEO_MESSAGE_CLAMP_CHARS } from './ceo-cognitive-contract'
import type { TaskType } from './subagent-governance'
import { capabilitiesForDecision } from './ceo-capability-architecture'

/**
 * Request-level reasoning planner.
 * The execution contract is authoritative for orchestration ownership;
 * this planner may increase cognitive depth within that owner but may never
 * transfer a request into a different orchestration owner.
 */
export function buildCeoDecisionPlan(input: {
  messages: readonly { role: string; content: string }[]
  preRoute: PreRouteDecision
  missionId?: string
  taskType?: TaskType
}): DecisionPlan {
  const latest = [...input.messages].reverse().find((message) => message.role === 'user')?.content ?? ''
  // The current user utterance is not necessarily the research objective. During a natural continuation,
  // the durable objective may be the only complete description of what the CEO is actually doing.
  const authoritativeObjective = input.preRoute.researchObjective?.currentObjective || input.preRoute.routingObjective || latest
  const taskClass = input.taskType ?? input.preRoute.taskClass ?? 'reasoning'
  const adaptiveClass = input.preRoute.adaptiveExecutionClass ?? 'standard'
  const missionRelevant = input.preRoute.missionRelevant || Boolean(input.missionId)
  const contract = input.preRoute.executionContract
  const selfAssessment = contract.intent === 'self_assessment'
  const conversationalIntent = contract.intent === 'conversation' || contract.intent === 'opinion'
  const critical = !selfAssessment && (missionRelevant || taskClass === 'financial' || taskClass === 'security')
  const preRouteFloor = input.preRoute.route === 'fast' ? 'fast' : 'full'
  const deep = !selfAssessment && (critical || preRouteFloor === 'full' || adaptiveClass === 'deep' || missionRelevant)
  const path = selfAssessment ? 'fast' : critical ? 'critical' : deep ? 'full' : 'fast'
  const reasoningStrategy = selfAssessment ? 'direct' : critical ? 'independent_review' : deep ? 'multi_pass' : 'direct'
  const cognitiveDepth = selfAssessment ? 0 : critical ? 4 : deep ? 2 : 0
  const qualityTier = critical ? 'critical' : deep ? 'high' : 'standard'
  const verificationRequired = critical || deep
  // Tier 4 hygiene fix (2026-09-13): on the fast (non-deep, non-critical) path this only granted a
  // retry budget to conversation/opinion intents, so a plain "decide between vendor A and vendor B"
  // that stayed fast got 0 escalations while "hi, how are you" got 1 -- backwards, since a decision's
  // failure modes (an unbacked claim, a false-completion claim) are exactly what the escalation loop in
  // ceo-cognitive-lifecycle.ts exists to repair, and casual chat rarely needs it. research/tool_action/
  // production_action/mission_action always route 'full' from the pre-router (see preRouteCeoRequest),
  // so they always have deep=true here regardless of this branch; only conversation/opinion/decision/
  // analysis can ever reach 'fast', so decision/analysis are added alongside conversation/opinion.
  const fastPathEscalationEligible = conversationalIntent || contract.intent === 'decision' || contract.intent === 'analysis'
  const maxEscalations = selfAssessment ? 0 : critical ? 2 : deep || fastPathEscalationEligible ? 1 : 0
  const maxProviderAttempts = selfAssessment ? 4 : critical ? 5 : deep ? 4 : 2
  const latencyBudgetMs = selfAssessment ? contract.latencyBudgetMs : critical ? 90000 : deep ? 60000 : contract.latencyBudgetMs
  const capabilityRequirements = capabilitiesForDecision(contract)
  const requiredCapabilities = [...new Set([taskClass, ...capabilityRequirements, ...(missionRelevant ? ['mission-memory', 'verification'] : [])])]
  // Long-document incident (2026-09-19): raised from a separately-hardcoded 4,000 chars to the shared
  // CEO_MESSAGE_CLAMP_CHARS -- this field used to disagree with the context composer's own 12,000-char
  // clamp (now also CEO_MESSAGE_CLAMP_CHARS) and the fully-unclamped objective the quality gate actually
  // judges against (objectiveFrom() in ceo-cognitive-lifecycle.ts), so the same turn had three
  // independently-sized views of itself. Nothing currently reads DecisionPlan.objective downstream, but
  // giving it the same canonical clamp as every other representation keeps that true if something starts.
  return { requestId: randomUUID(), preRoute: input.preRoute.route, path, objective: authoritativeObjective.trim().slice(0, CEO_MESSAGE_CLAMP_CHARS), taskClass, missionRelevant, requiredCapabilities, qualityTier, reasoningStrategy, cognitiveDepth, verificationRequired, maxEscalations, maxProviderAttempts, latencyBudgetMs, executionContract: contract, ...(input.preRoute.researchObjective ? { researchObjective: input.preRoute.researchObjective } : {}) }
}
