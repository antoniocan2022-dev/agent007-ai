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
 * The existing provider-intelligence engine remains responsible for health,
 * discovery, and circuit breaking. This layer applies the authoritative
 * Governance 2.0 provider priority and only skips providers that are not
 * available or currently circuit-open.
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
}

export function selectPrimaryProvider(
  taskType: TaskType,
  availableProviders: readonly ProviderId[],
  verification?: VerificationTier,
): ProviderSelection | undefined {
  return selectProvidersForTask(taskType, availableProviders, verification)[0]
}
