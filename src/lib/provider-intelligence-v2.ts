import { getHealthScore, isCircuitOpen } from './provider-intelligence'
import { getProviderTaskPolicy, rankAvailableProviders, type ProviderTaskPolicy } from './provider-intelligence-policy'
import type { ProviderId, TaskType, VerificationTier } from './subagent-governance'

export interface ProviderSelection {
  provider: ProviderId
  policy: ProviderTaskPolicy
  score: number
  priority: number
}

/**
 * Provider Intelligence 2 coordinator.
 *
 * This does not replace the existing provider-intelligence engine. It combines
 * its health/circuit state with the authoritative Governance 2.0 priority.
 * Health may influence selection, but priority remains the deterministic
 * tie-breaker requested for Agent007.
 */
export function selectProvidersForTask(
  taskType: TaskType,
  availableProviders: readonly ProviderId[],
  verification?: VerificationTier,
): ProviderSelection[] {
  const policy = getProviderTaskPolicy(taskType, verification)
  const ranked = rankAvailableProviders(availableProviders)

  return ranked
    .filter((provider) => !isCircuitOpen(provider))
    .map((provider) => ({
      provider,
      policy,
      score: getHealthScore(provider),
      priority: policy.providerOrder.indexOf(provider),
    }))
    .sort((a, b) => b.score - a.score || a.priority - b.priority)
}

export function selectPrimaryProvider(
  taskType: TaskType,
  availableProviders: readonly ProviderId[],
  verification?: VerificationTier,
): ProviderSelection | undefined {
  return selectProvidersForTask(taskType, availableProviders, verification)[0]
}
