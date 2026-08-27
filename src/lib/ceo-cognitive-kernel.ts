import { randomUUID } from 'node:crypto'
import type { PreRouteDecision, DecisionPlan } from './ceo-cognitive-contract'
import type { TaskType } from './subagent-governance'

/**
 * Request-level reasoning planner.
 * Separate from ceo-decision-kernel.ts, which remains the mission governance
 * gate. The execution contract is authoritative for orchestration ownership;
 * this planner may increase cognitive depth inside that owner but may not
 * transfer ownership implicitly.
 */
export function buildCeoDecisionPlan(input: {
  messages: readonly { role: string; content: string }[]
  preRoute: PreRouteDecision
  missionId?: string
  taskType?: TaskType
}): DecisionPlan {
  const latest = [...input.messages].reverse().find((message) => message.role === 'user')?.content ?? ''
  const taskClass = input.taskType ?? input.preRoute.taskClass ?? 'reasoning'
  const adaptiveClass = input.preRoute.adaptiveExecutionClass ?? 'standard'
  const missionRelevant = input.preRoute.missionRelevant || Boolean(input.missionId)
  const contract = input.preRoute.executionContract
  const critical = missionRelevant || taskClass === 'financial' || taskClass === 'security'
  const contractIsCeoOwned = contract.orchestrationOwner === 'ceo_lifecycle'
  const selfAssessment = contract.intent === 'self_assessment'
  const preRouteFloor = input.preRoute.route === 'fast' ? 'fast' : 'full'
  const deep = !selfAssessment && (critical || preRouteFloor === 'full' || input.preRoute.complexitySignals > 0 || adaptiveClass === 'deep' || missionRelevant)
  const path = selfAssessment
    ? 'fast'
    : critical
      ? 'critical'
      : deep
        ? 'full'
        : 'fast'
  const reasoningStrategy = selfAssessment
    ? 'direct'
    : critical
      ? 'independent_review'
      : deep
        ? 'multi_pass'
        : 'direct'
  const cognitiveDepth = selfAssessment ? 0 : critical ? 4 : deep ? 2 : 0
  const qualityTier = critical ? 'critical' : deep ? 'high' : 'standard'

  // A non-operational contract must never be escalated into mission execution
  // solely because generic task metadata happens to look complex.
  const effectiveVerificationRequired = critical || deep
  const effectiveMaxEscalations = selfAssessment ? 0 : critical ? 2 : deep ? 1 : 0
  const effectiveMaxProviderAttempts = selfAssessment ? 2 : critical ? 5 : deep ? 4 : 2
  const effectiveLatencyBudgetMs = selfAssessment
    ? contract.latencyBudgetMs
    : critical
      ? 90000
      : deep
        ? 60000
        : contract.latencyBudgetMs

  return {
    requestId: randomUUID(),
    path,
    objective: latest.trim().slice(0, 4000),
    taskClass,
    missionRelevant,
    requiredCapabilities: [taskClass, ...(missionRelevant ? ['mission-memory', 'verification'] : [])],
    qualityTier,
    reasoningStrategy,
    cognitiveDepth,
    verificationRequired: effectiveVerificationRequired,
    maxEscalations: effectiveMaxEscalations,
    maxProviderAttempts: effectiveMaxProviderAttempts,
    latencyBudgetMs: effectiveLatencyBudgetMs,
    executionContract: contractIsCeoOwned ? contract : contract,
  }
}
