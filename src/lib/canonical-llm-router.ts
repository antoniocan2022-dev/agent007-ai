import { getProviderTaskPolicy, type ProviderTaskPolicy } from './provider-intelligence-policy'
import {
  PROVIDER_RUNTIME_CONFIG,
  getConfiguredProviders,
  runGovernedProviderChat,
  type ProviderRuntimeOutcomeEvidence,
} from './provider-runtime-v2'
import { getHealthScore, isCircuitOpen } from './provider-intelligence'
import type { ProviderId, TaskType, VerificationTier } from './subagent-governance'
import { classifyExecution, type AdaptiveExecutionPlan, type ExecutionClass } from './adaptive-execution'

export type CanonicalLlmRequest = {
  messages: readonly { role: 'system' | 'user' | 'assistant'; content: string }[]
  taskType?: TaskType
  verification?: VerificationTier
  thinking?: boolean
  model?: string
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
  maxProviderAttempts?: number
  outcomeEvidence?: ProviderRuntimeOutcomeEvidence
  executionClass?: ExecutionClass
}

export type CanonicalLlmResult = {
  provider: ProviderId
  model: string
  content: string
  attempts: ProviderId[]
  responseMs: number
  policy: ProviderTaskPolicy
  executionClass: ExecutionClass
  adaptivePlan: AdaptiveExecutionPlan
}

export type ParallelCanonicalResult = { index: number; result?: CanonicalLlmResult; error?: unknown }

const TASK_HINTS: Array<[TaskType, RegExp]> = [
  ['coding', /\b(code|coding|bug|typescript|javascript|python|refactor|implement|patch|compile|build)\b/i],
  ['financial', /\b(finance|financial|investment|revenue|margin|cash|bank|trade|portfolio|payment)\b/i],
  ['security', /\b(security|vulnerability|auth|password|2fa|exploit|cve|owasp)\b/i],
  ['research', /\b(research|market|competitor|source|evidence|investigate|compare)\b/i],
  ['creative', /\b(write|content|creative|copy|headline|brand|design)\b/i],
  ['operations', /\b(health|monitor|incident|ops|deployment|uptime|status)\b/i],
  ['analysis', /\b(analyze|analysis|evaluate|diagnose|audit|assess)\b/i],
]

export function inferTaskType(messages: readonly { role: string; content: string }[]): TaskType {
  const latestUser = [...messages].reverse().find((message) => message.role === 'user')
  const text = latestUser?.content ?? messages[messages.length - 1]?.content ?? ''
  for (const [taskType, pattern] of TASK_HINTS) if (pattern.test(text)) return taskType
  return 'reasoning'
}

function explicitPlan(request: CanonicalLlmRequest): AdaptiveExecutionPlan {
  const inferred = classifyExecution(request.messages)
  if (!request.executionClass) return inferred
  if (request.executionClass === inferred.executionClass) return inferred
  const overrides: Record<ExecutionClass, AdaptiveExecutionPlan> = {
    fast: { ...inferred, executionClass: 'fast', maxProviderAttempts: 2, maxTokens: 1200, timeoutMs: 15000, parallelizable: false, reason: 'Caller explicitly selected the fast governed lane.' },
    standard: { ...inferred, executionClass: 'standard', maxProviderAttempts: 3, maxTokens: 4000, timeoutMs: 30000, parallelizable: true, reason: 'Caller explicitly selected the standard governed lane.' },
    deep: { ...inferred, executionClass: 'deep', maxProviderAttempts: 5, maxTokens: 8000, timeoutMs: 60000, parallelizable: true, reason: 'Caller explicitly selected the deep governed lane.' },
    mission: { ...inferred, executionClass: 'mission', maxProviderAttempts: 5, maxTokens: 8000, timeoutMs: 60000, parallelizable: true, reason: 'Caller explicitly selected the mission governed lane.' },
  }
  return overrides[request.executionClass]
}

export async function runCanonicalLlm(request: CanonicalLlmRequest): Promise<CanonicalLlmResult> {
  const adaptivePlan = explicitPlan(request)
  const taskType = request.taskType ?? inferTaskType(request.messages)
  const policy = getProviderTaskPolicy(taskType, request.verification)
  const result = await runGovernedProviderChat({
    messages: request.messages,
    taskType,
    verification: request.verification,
    model: request.model,
    temperature: request.temperature ?? (request.thinking === false ? 0.2 : 0.35),
    maxTokens: request.maxTokens ?? adaptivePlan.maxTokens,
    timeoutMs: request.timeoutMs ?? adaptivePlan.timeoutMs,
    maxProviderAttempts: request.maxProviderAttempts ?? adaptivePlan.maxProviderAttempts,
    outcomeEvidence: request.outcomeEvidence,
  })
  return { ...result, policy, executionClass: adaptivePlan.executionClass, adaptivePlan }
}

export async function runCanonicalLlmParallel(requests: readonly CanonicalLlmRequest[], concurrency = 4): Promise<ParallelCanonicalResult[]> {
  if (requests.length === 0) return []
  const limit = Math.min(Math.max(Math.trunc(concurrency), 1), 4)
  const results: ParallelCanonicalResult[] = []
  for (let start = 0; start < requests.length; start += limit) {
    const batch = requests.slice(start, start + limit)
    const batchResults = await Promise.all(batch.map(async (request, offset) => {
      try {
        const plan = explicitPlan(request)
        if (!plan.parallelizable) throw new Error('Adaptive execution rejected parallel fan-out for a fast lane request.')
        return { index: start + offset, result: await runCanonicalLlm(request) }
      } catch (error) {
        return { index: start + offset, error }
      }
    }))
    results.push(...batchResults)
  }
  return results
}

export function getCanonicalProviderTelemetry() {
  const configuredSet = new Set(getConfiguredProviders())
  const providers = (Object.keys(PROVIDER_RUNTIME_CONFIG) as Exclude<ProviderId, 'openai'>[]).map((provider) => {
    const configured = configuredSet.has(provider)
    const circuitOpen = isCircuitOpen(provider)
    const healthScore = getHealthScore(provider)
    return {
      provider,
      label: PROVIDER_RUNTIME_CONFIG[provider].label,
      model: PROVIDER_RUNTIME_CONFIG[provider].defaultModel,
      configured,
      circuitOpen,
      healthScore,
      status: !configured ? 'unavailable' : circuitOpen ? 'rate_limited' : healthScore >= 80 ? 'healthy' : healthScore >= 50 ? 'degraded' : 'unhealthy',
    } as const
  })
  const configured = providers.filter((provider) => provider.configured)
  const healthy = configured.filter((provider) => provider.status === 'healthy')
  const available = configured.filter((provider) => provider.status !== 'rate_limited')
  return { providerCount: providers.length, configuredCount: configured.length, healthyCount: healthy.length, availableCount: available.length, providers }
}

export function assertCanonicalProviderSet(): void {
  const actual = Object.keys(PROVIDER_RUNTIME_CONFIG).sort().join(',')
  const expected = ['cerebras', 'gemini', 'groq', 'mistral', 'zai'].sort().join(',')
  if (actual !== expected) throw new Error(`CANONICAL_PROVIDER_DRIFT: ${actual}`)
}