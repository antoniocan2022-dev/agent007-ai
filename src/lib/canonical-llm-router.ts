import {
  getProviderTaskPolicy,
  type TaskType,
  type VerificationTier,
} from './provider-intelligence-policy'
import {
  PROVIDER_RUNTIME_CONFIG,
  getConfiguredProviders,
  runGovernedProviderChat,
  type ProviderRuntimeOutcomeEvidence,
} from './provider-runtime-v2'
import { getHealthScore, isCircuitOpen } from './provider-intelligence'
import type { ProviderId } from './subagent-governance'

export type CanonicalLlmRequest = {
  messages: readonly { role: 'system' | 'user' | 'assistant'; content: string }[]
  taskType?: TaskType
  verification?: VerificationTier
  thinking?: boolean
  model?: string
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
  outcomeEvidence?: ProviderRuntimeOutcomeEvidence
}

export type CanonicalLlmResult = {
  provider: ProviderId
  model: string
  content: string
  attempts: ProviderId[]
  responseMs: number
  policy: ReturnType<typeof getProviderTaskPolicy>
}

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
  const text = messages.map((message) => message.content).join('\n')
  for (const [taskType, pattern] of TASK_HINTS) if (pattern.test(text)) return taskType
  return 'reasoning'
}

export async function runCanonicalLlm(request: CanonicalLlmRequest): Promise<CanonicalLlmResult> {
  const taskType = request.taskType ?? inferTaskType(request.messages)
  const policy = getProviderTaskPolicy(taskType, request.verification)
  const result = await runGovernedProviderChat({
    messages: request.messages,
    taskType,
    verification: request.verification,
    model: request.model,
    temperature: request.temperature ?? (request.thinking === false ? 0.2 : 0.35),
    maxTokens: request.maxTokens ?? 8000,
    timeoutMs: request.timeoutMs ?? 60000,
    outcomeEvidence: request.outcomeEvidence,
  })
  return { ...result, policy }
}

export function getCanonicalProviderTelemetry() {
  const configuredSet = new Set(getConfiguredProviders())
  const providers = (Object.keys(PROVIDER_RUNTIME_CONFIG) as ProviderId[]).map((provider) => {
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
  return {
    providerCount: providers.length,
    configuredCount: configured.length,
    healthyCount: healthy.length,
    availableCount: available.length,
    providers,
  }
}

export function assertCanonicalProviderSet(): void {
  const actual = Object.keys(PROVIDER_RUNTIME_CONFIG).sort().join(',')
  const expected = ['groq', 'mistral', 'openai', 'zai'].sort().join(',')
  if (actual !== expected) throw new Error(`CANONICAL_PROVIDER_DRIFT: ${actual}`)
}
