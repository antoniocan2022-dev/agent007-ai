import type { ProviderId, TaskType, VerificationTier } from './subagent-governance'

/**
 * Provider Intelligence 2.0 policy layer.
 *
 * The existing provider-intelligence.ts remains responsible for discovery,
 * health scoring, and circuit breaking. This module is the authoritative
 * policy layer for provider priority and task/risk requirements.
 *
 * Priority requested for Agent007:
 * Groq → OpenAI → Z.ai → Mistral.
 * "Mistral" is the provider; "Ministral" refers to Mistral's model family.
 */
export const CORE_PROVIDER_PRIORITY: readonly ProviderId[] = ['groq', 'openai', 'zai', 'mistral'] as const
export const SECONDARY_PROVIDER_PRIORITY: readonly ProviderId[] = ['openrouter', 'gemini', 'brave', 'cerebras'] as const
export const PROVIDER_PRIORITY: readonly ProviderId[] = [...CORE_PROVIDER_PRIORITY, ...SECONDARY_PROVIDER_PRIORITY] as const
export const PROVIDER_PARALLEL_LIMIT = 4


const STRICT_TASKS = new Set<TaskType>(['financial', 'security'])
const ENHANCED_TASKS = new Set<TaskType>(['research', 'reasoning', 'coding', 'analysis', 'operations'])

export interface ProviderTaskPolicy {
  providerOrder: readonly ProviderId[]
  taskType: TaskType
  minVerification: VerificationTier
  allowFallback: boolean
  requireIndependentVerification: boolean
}

export function getProviderTaskPolicy(taskType: TaskType, verification?: VerificationTier): ProviderTaskPolicy {
  const minVerification = verification ?? (
    STRICT_TASKS.has(taskType) ? 'dual-review' : ENHANCED_TASKS.has(taskType) ? 'enhanced' : 'standard'
  )

  return {
    providerOrder: PROVIDER_PRIORITY,
    taskType,
    minVerification,
    allowFallback: true,
    requireIndependentVerification: minVerification === 'dual-review',
  }
}

export function rankAvailableProviders(available: readonly ProviderId[]): ProviderId[] {
  const set = new Set(available)
  return PROVIDER_PRIORITY.filter((provider) => set.has(provider))
}

export function validateProviderPriority(order: readonly ProviderId[] = PROVIDER_PRIORITY): string[] {
  const errors: string[] = []
  if (order.length !== PROVIDER_PRIORITY.length) errors.push(`Provider priority must contain ${PROVIDER_PRIORITY.length} providers`)
  if (new Set(order).size !== order.length) errors.push('Provider priority contains duplicates')
  PROVIDER_PRIORITY.forEach((provider, index) => {
    if (order[index] !== provider) errors.push(`Provider priority mismatch at position ${index + 1}: expected ${provider}`)
  })
  return errors
}

export const PROVIDER_TASK_POLICIES: Readonly<Record<TaskType, ProviderTaskPolicy>> = {
  general: getProviderTaskPolicy('general'),
  research: getProviderTaskPolicy('research'),
  reasoning: getProviderTaskPolicy('reasoning'),
  coding: getProviderTaskPolicy('coding'),
  creative: getProviderTaskPolicy('creative'),
  financial: getProviderTaskPolicy('financial'),
  security: getProviderTaskPolicy('security'),
  operations: getProviderTaskPolicy('operations'),
  analysis: getProviderTaskPolicy('analysis'),
}
