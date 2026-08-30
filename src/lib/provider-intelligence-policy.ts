import type { ProviderId, TaskType, VerificationTier } from './subagent-governance'

/**
 * Authoritative Agent007 provider policy.
 * The canonical provider order remains stable for compatibility. CEO
 * conversation/reasoning can use the quality-first preference below without
 * changing the platform-wide provider contract.
 */
export const PROVIDER_PRIORITY: readonly ProviderId[] = ['groq', 'cloudflare', 'mistral', 'cerebras', 'openrouter'] as const
export const CEO_CONVERSATION_PROVIDER_PRIORITY: readonly ProviderId[] = ['cloudflare', 'mistral', 'groq', 'cerebras', 'openrouter'] as const

const STRICT_TASKS = new Set<TaskType>(['financial', 'security'])
const ENHANCED_TASKS = new Set<TaskType>(['research', 'reasoning', 'coding', 'analysis', 'operations'])

export interface ProviderTaskPolicy { providerOrder: readonly ProviderId[]; taskType: TaskType; minVerification: VerificationTier; allowFallback: boolean; requireIndependentVerification: boolean }

export function getProviderTaskPolicy(taskType: TaskType, verification?: VerificationTier): ProviderTaskPolicy {
  const minVerification = verification ?? (STRICT_TASKS.has(taskType) ? 'dual-review' : ENHANCED_TASKS.has(taskType) ? 'enhanced' : 'standard')
  return { providerOrder: PROVIDER_PRIORITY, taskType, minVerification, allowFallback: true, requireIndependentVerification: minVerification === 'dual-review' }
}
export function rankAvailableProviders(available: readonly ProviderId[], order: readonly ProviderId[] = PROVIDER_PRIORITY): ProviderId[] { const set = new Set(available); return order.filter((provider) => set.has(provider)) }
export function validateProviderPriority(order: readonly ProviderId[] = PROVIDER_PRIORITY): string[] {
  const errors: string[] = []
  if (order.length !== PROVIDER_PRIORITY.length) errors.push(`Provider priority must contain ${PROVIDER_PRIORITY.length} providers`)
  if (new Set(order).size !== order.length) errors.push('Provider priority contains duplicates')
  PROVIDER_PRIORITY.forEach((provider, index) => { if (order[index] !== provider) errors.push(`Provider priority mismatch at position ${index + 1}: expected ${provider}`) })
  if (order.includes('openai')) errors.push('OpenAI is disabled and must not appear in provider priority')
  return errors
}
export const PROVIDER_TASK_POLICIES: Readonly<Record<TaskType, ProviderTaskPolicy>> = {
  general: getProviderTaskPolicy('general'), research: getProviderTaskPolicy('research'), reasoning: getProviderTaskPolicy('reasoning'), coding: getProviderTaskPolicy('coding'), creative: getProviderTaskPolicy('creative'), financial: getProviderTaskPolicy('financial'), security: getProviderTaskPolicy('security'), operations: getProviderTaskPolicy('operations'), analysis: getProviderTaskPolicy('analysis'),
}
