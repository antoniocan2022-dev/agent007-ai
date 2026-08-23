import { randomUUID } from 'node:crypto'
import type { PreRouteDecision, DecisionPlan } from './ceo-cognitive-contract'
import type { TaskType } from './subagent-governance'

/**
 * Request-level reasoning planner.
 * This is deliberately separate from ceo-decision-kernel.ts, which is the
 * mission governance/approval gate. The planner decides how much cognition
 * the request warrants; it never authorizes protected mission actions.
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
  const missionRelevant = input.preRoute.missionRelevant || Boolean(input.missionId) || adaptiveClass === 'mission'
  const critical = missionRelevant || taskClass === 'financial' || taskClass === 'security' || adaptiveClass === 'mission'
  const deep = critical || input.preRoute.complexitySignals > 0 || adaptiveClass === 'deep' || resolvePath(input.preRoute) === 'full'

  return {
    requestId: randomUUID(),
    path: critical ? 'critical' : deep ? 'full' : 'fast',
    objective: latest.trim().slice(0, 4000),
    taskClass,
    missionRelevant,
    requiredCapabilities: [taskClass, ...(missionRelevant ? ['mission-memory', 'verification'] : [])],
    qualityTier: critical ? 'critical' : deep ? 'high' : 'standard',
    reasoningStrategy: critical ? 'independent_review' : deep ? 'multi_pass' : 'direct',
    cognitiveDepth: critical ? 4 : deep ? 2 : 0,
    verificationRequired: critical || deep,
    maxEscalations: critical ? 2 : deep ? 1 : 0,
    maxProviderAttempts: critical ? 5 : deep ? 4 : 2,
    latencyBudgetMs: critical ? 90000 : deep ? 60000 : 15000,
  }
}

function resolvePath(preRoute: PreRouteDecision): 'fast' | 'full' {
  return preRoute.route === 'fast' ? 'fast' : 'full'
}
