import { randomUUID } from 'node:crypto'
import type { PreRouteDecision, DecisionPlan } from './ceo-cognitive-contract'
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
  const maxEscalations = selfAssessment ? 0 : critical ? 2 : deep || conversationalIntent ? 1 : 0
  const maxProviderAttempts = selfAssessment ? 4 : critical ? 5 : deep ? 4 : 2
  const latencyBudgetMs = selfAssessment ? contract.latencyBudgetMs : critical ? 90000 : deep ? 60000 : contract.latencyBudgetMs
  const capabilityRequirements = capabilitiesForDecision(contract)
  const requiredCapabilities = [...new Set([taskClass, ...capabilityRequirements, ...(missionRelevant ? ['mission-memory', 'verification'] : [])])]
  return { requestId: randomUUID(), preRoute: input.preRoute.route, path, objective: latest.trim().slice(0, 4000), taskClass, missionRelevant, requiredCapabilities, qualityTier, reasoningStrategy, cognitiveDepth, verificationRequired, maxEscalations, maxProviderAttempts, latencyBudgetMs, executionContract: contract }
}
