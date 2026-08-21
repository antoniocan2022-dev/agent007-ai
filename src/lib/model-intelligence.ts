import type { ProviderId, TaskType, VerificationTier } from './subagent-governance'

export type ModelCapability = 'reasoning' | 'coding' | 'research' | 'analysis' | 'creative' | 'tool-use' | 'long-context' | 'speed'

export interface ModelProfile {
  provider: ProviderId
  model: string
  capabilities: readonly ModelCapability[]
  quality: number
  speed: number
  costTier: 1 | 2 | 3
  maxOutputTokens: number
}

/** Active governed model matrix. OpenAI is intentionally absent. */
export const MODEL_PROFILES: readonly ModelProfile[] = [
  { provider: 'groq', model: 'llama-3.3-70b-versatile', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'tool-use', 'speed'], quality: 86, speed: 96, costTier: 1, maxOutputTokens: 8000 },
  { provider: 'zai', model: 'glm-5.1', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'tool-use', 'long-context'], quality: 92, speed: 84, costTier: 2, maxOutputTokens: 12000 },
  { provider: 'mistral', model: 'mistral-large-latest', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'creative', 'tool-use', 'long-context'], quality: 91, speed: 80, costTier: 2, maxOutputTokens: 12000 },
  { provider: 'gemini', model: 'gemini-3.7-flash', capabilities: ['reasoning', 'research', 'analysis', 'creative', 'tool-use', 'long-context', 'speed'], quality: 93, speed: 91, costTier: 2, maxOutputTokens: 12000 },
  { provider: 'cerebras', model: 'gpt-oss-120b', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'tool-use', 'speed'], quality: 89, speed: 99, costTier: 1, maxOutputTokens: 16000 },
]

const PROVIDER_KEY_ENV: Readonly<Record<ProviderId, string>> = {
  groq: 'GROQ_API_KEY',
  openai: '',
  zai: 'ZAI_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  gemini: 'GEMINI_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
}

const TASK_CAPABILITIES: Record<TaskType, readonly ModelCapability[]> = {
  general: ['reasoning', 'tool-use'], research: ['research', 'long-context'], reasoning: ['reasoning', 'analysis'], coding: ['coding', 'tool-use', 'reasoning'], creative: ['creative', 'reasoning'], financial: ['analysis', 'reasoning', 'long-context'], security: ['reasoning', 'coding', 'analysis'], operations: ['analysis', 'tool-use', 'speed'], analysis: ['analysis', 'reasoning'],
}

export interface ModelSelection { provider: ProviderId; model: string; fitScore: number; quality: number; speed: number; costTier: 1 | 2 | 3; rationale: string }

function configured(provider: ProviderId): boolean { const envName = PROVIDER_KEY_ENV[provider]; return !!envName && Boolean(process.env[envName]?.trim()) }

export function selectModelForTask(taskType: TaskType, availableProviders: readonly ProviderId[], verification?: VerificationTier): ModelSelection[] {
  const required = TASK_CAPABILITIES[taskType]
  const strict = verification === 'dual-review' || taskType === 'financial' || taskType === 'security'
  const candidates = MODEL_PROFILES.filter((profile) => availableProviders.includes(profile.provider) && configured(profile.provider))
  return candidates.map((profile) => {
    const capabilityHits = required.filter((capability) => profile.capabilities.includes(capability)).length
    const capabilityScore = required.length ? capabilityHits / required.length * 100 : 50
    const riskBonus = strict && profile.quality >= 90 ? 5 : 0
    const fitScore = Math.round(capabilityScore * 0.55 + profile.quality * 0.3 + profile.speed * 0.1 + (profile.costTier === 1 ? 5 : profile.costTier === 2 ? 3 : 0) + riskBonus)
    return { provider: profile.provider, model: profile.model, fitScore, quality: profile.quality, speed: profile.speed, costTier: profile.costTier, rationale: `${taskType}: ${capabilityHits}/${required.length} required capabilities; quality ${profile.quality}; speed ${profile.speed}; cost tier ${profile.costTier}${riskBonus ? '; strict-risk quality bonus' : ''}` }
  }).sort((a, b) => b.fitScore - a.fitScore)
}

export function getModelProfile(provider: ProviderId, model: string): ModelProfile | undefined { return MODEL_PROFILES.find((profile) => profile.provider === provider && profile.model === model) }
export function getModelForProvider(provider: ProviderId, taskType: TaskType, verification?: VerificationTier): string | undefined { return selectModelForTask(taskType, [provider], verification)[0]?.model }
