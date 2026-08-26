import { GOVERNED_MODEL_PROFILES, getGovernedCandidates, getModelForProviderGoverned, PROVIDER_RUNTIME_CONFIG, type ActiveProviderId, type GovernedModelProfile, type ModelCapability } from './provider-control-plane'
import type { ProviderId, TaskType, VerificationTier } from './subagent-governance'

export type { GovernedModelProfile as ModelProfile, ModelCapability }
export const MODEL_PROFILES: readonly GovernedModelProfile[] = GOVERNED_MODEL_PROFILES

export interface ModelSelection { provider: ProviderId; model: string; fitScore: number; quality: number; speed: number; costTier: 1 | 2 | 3; rationale: string }

export function selectModelForTask(taskType: TaskType, availableProviders: readonly ProviderId[], verification?: VerificationTier): ModelSelection[] {
  const selections: ModelSelection[] = []
  for (const provider of availableProviders.filter((item): item is ActiveProviderId => item !== 'openai')) {
    const candidates = getGovernedCandidates(provider, taskType, verification)
    for (const model of candidates) {
      const profile = GOVERNED_MODEL_PROFILES.find((item) => item.provider === provider && item.model === model)
      if (!profile || !process.env[PROVIDER_RUNTIME_CONFIG[provider].apiKeyEnv]?.trim()) continue
      const fitScore = Math.round(profile.quality * 0.55 + profile.speed * 0.2 + (profile.costTier === 1 ? 15 : profile.costTier === 2 ? 8 : 0) + (verification === 'dual-review' && profile.quality >= 90 ? 5 : 0))
      selections.push({ provider, model, fitScore, quality: profile.quality, speed: profile.speed, costTier: profile.costTier, rationale: `${taskType}: governed model ${model}; quality ${profile.quality}; speed ${profile.speed}; cost tier ${profile.costTier}` })
    }
  }
  return selections.sort((a, b) => b.fitScore - a.fitScore)
}

export function getModelProfile(provider: ProviderId, model: string): GovernedModelProfile | undefined { return provider === 'openai' ? undefined : GOVERNED_MODEL_PROFILES.find((profile) => profile.provider === provider && profile.model === model) }
export function getModelForProvider(provider: ProviderId, taskType: TaskType, verification?: VerificationTier): string | undefined { return provider === 'openai' ? undefined : getModelForProviderGoverned(provider, taskType, verification) }
