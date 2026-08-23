import { randomUUID } from 'node:crypto'
import { classifyExecution } from './adaptive-execution'
import { inferTaskType } from './canonical-llm-router'
import type { PreRouteDecision, DecisionPlan } from './ceo-cognitive-contract'
import type { TaskType } from './subagent-governance'

export function buildCeoDecisionPlan(input: {
  messages: readonly { role: string; content: string }[]
  preRoute: PreRouteDecision
  missionId?: string
  taskType?: TaskType
}): DecisionPlan {
  const latest = [...input.messages].reverse().find((message) => message.role === 'user')?.content ?? ''
  const adaptive = classifyExecution(input.messages)
  const taskClass = input.taskType ?? inferTaskType(input.messages)
  const missionRelevant = input.preRoute.missionRelevant || Boolean(input.missionId) || adaptive.executionClass === 'mission'
  const critical = missionRelevant || taskClass === 'financial' || taskClass === 'security' || adaptive.executionClass === 'mission'
  const deep = critical || input.preRoute.complexitySignals > 0 || adaptive.executionClass === 'deep'

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
