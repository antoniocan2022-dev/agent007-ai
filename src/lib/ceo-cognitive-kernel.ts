import { randomUUID } from 'node:crypto'
import type { TaskType } from './subagent-governance'
import { classifyExecution } from './adaptive-execution'
import type { PreRouteDecision, DecisionPlan } from './ceo-cognitive-contract'

function inferTask(text: string): TaskType {
  if (/\b(code|coding|typescript|javascript|python|bug|refactor|compile|build)\b/i.test(text)) return 'coding'
  if (/\b(finance|financial|investment|revenue|margin|cash|bank|portfolio|payment)\b/i.test(text)) return 'financial'
  if (/\b(security|vulnerability|auth|password|2fa|cve|owasp)\b/i.test(text)) return 'security'
  if (/\b(research|market|competitor|source|evidence|investigate|compare)\b/i.test(text)) return 'research'
  if (/\b(write|content|creative|copy|headline|brand|design)\b/i.test(text)) return 'creative'
  if (/\b(health|monitor|incident|ops|deployment|uptime|status)\b/i.test(text)) return 'operations'
  if (/\b(analyze|analysis|evaluate|diagnose|audit|assess)\b/i.test(text)) return 'analysis'
  return 'reasoning'
}

export function buildCeoDecisionPlan(input: {
  messages: readonly { role: string; content: string }[]
  preRoute: PreRouteDecision
  missionId?: string
  taskType?: TaskType
}): DecisionPlan {
  const latest = [...input.messages].reverse().find((message) => message.role === 'user')?.content ?? ''
  const adaptive = classifyExecution(input.messages)
  const taskClass = input.taskType ?? inferTask(latest)
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
