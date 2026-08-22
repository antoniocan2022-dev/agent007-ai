import type { ProviderId, TaskType, VerificationTier } from './subagent-governance'

export type ActiveProviderId = Exclude<ProviderId, 'openai'>
export type ProviderErrorKind =
  | 'AUTHENTICATION'
  | 'AUTHORIZATION'
  | 'BILLING'
  | 'RATE_LIMIT'
  | 'MODEL_UNAVAILABLE'
  | 'MODEL_NOT_GOVERNED'
  | 'CATALOG_UNAVAILABLE'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'INVALID_REQUEST'
  | 'UPSTREAM'
  | 'UNKNOWN'

export interface ProviderControlPlaneErrorShape {
  provider: ActiveProviderId
  kind: ProviderErrorKind
  status?: number
  message: string
  retryable: boolean
}

export class ProviderControlPlaneError extends Error implements ProviderControlPlaneErrorShape {
  readonly provider: ActiveProviderId
  readonly kind: ProviderErrorKind
  readonly status?: number
  readonly retryable: boolean

  constructor(shape: ProviderControlPlaneErrorShape) {
    super(shape.message)
    this.name = 'ProviderControlPlaneError'
    this.provider = shape.provider
    this.kind = shape.kind
    this.status = shape.status
    this.retryable = shape.retryable
  }
}

export type ModelCapability = 'reasoning' | 'coding' | 'research' | 'analysis' | 'creative' | 'tool-use' | 'long-context' | 'speed'

export interface GovernedModelProfile {
  provider: ActiveProviderId
  model: string
  capabilities: readonly ModelCapability[]
  quality: number
  speed: number
  costTier: 1 | 2 | 3
  maxOutputTokens: number
}

export interface ProviderRuntimeConfig {
  id: ActiveProviderId
  label: string
  baseUrl: string
  apiKeyEnv: string
  modelEnv: string
  defaultModel: string
  modelsUrl?: string
  preferredModels: readonly string[]
  catalogMode: 'live-api' | 'execution-validated'
}

export const PROVIDER_RUNTIME_CONFIG: Readonly<Record<ActiveProviderId, ProviderRuntimeConfig>> = {
  groq: {
    id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1/chat/completions', apiKeyEnv: 'GROQ_API_KEY', modelEnv: 'GROQ_MODEL',
    defaultModel: 'llama-3.3-70b-versatile', modelsUrl: 'https://api.groq.com/openai/v1/models',
    preferredModels: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'llama-3.1-8b-instant'], catalogMode: 'live-api',
  },
  zai: {
    id: 'zai', label: 'Z.AI', baseUrl: 'https://api.z.ai/api/paas/v4/chat/completions', apiKeyEnv: 'ZAI_API_KEY', modelEnv: 'ZAI_MODEL',
    defaultModel: 'glm-5.1', preferredModels: ['glm-5.1', 'glm-5', 'glm-4.6', 'glm-4.5-air', 'glm-4.5-flash'], catalogMode: 'execution-validated',
  },
  mistral: {
    id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1/chat/completions', apiKeyEnv: 'MISTRAL_API_KEY', modelEnv: 'MISTRAL_MODEL',
    defaultModel: 'mistral-large-latest', modelsUrl: 'https://api.mistral.ai/v1/models',
    preferredModels: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest'], catalogMode: 'live-api',
  },
  gemini: {
    id: 'gemini', label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', apiKeyEnv: 'GEMINI_API_KEY', modelEnv: 'GEMINI_MODEL',
    defaultModel: 'gemini-3.7-flash', modelsUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/models',
    preferredModels: ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'], catalogMode: 'live-api',
  },
  cerebras: {
    id: 'cerebras', label: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1/chat/completions', apiKeyEnv: 'CEREBRAS_API_KEY', modelEnv: 'CEREBRAS_MODEL',
    defaultModel: 'gpt-oss-120b', modelsUrl: 'https://api.cerebras.ai/v1/models',
    preferredModels: ['gpt-oss-120b', 'llama-3.3-70b', 'llama-3.1-70b'], catalogMode: 'live-api',
  },
}

export const GOVERNED_MODEL_PROFILES: readonly GovernedModelProfile[] = [
  { provider: 'groq', model: 'llama-3.3-70b-versatile', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'tool-use', 'speed'], quality: 86, speed: 96, costTier: 1, maxOutputTokens: 8000 },
  { provider: 'groq', model: 'openai/gpt-oss-120b', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'tool-use', 'speed'], quality: 89, speed: 92, costTier: 1, maxOutputTokens: 8000 },
  { provider: 'zai', model: 'glm-5.1', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'tool-use', 'long-context'], quality: 92, speed: 84, costTier: 2, maxOutputTokens: 12000 },
  { provider: 'zai', model: 'glm-5', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'tool-use', 'long-context'], quality: 90, speed: 86, costTier: 2, maxOutputTokens: 12000 },
  { provider: 'zai', model: 'glm-4.6', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'tool-use', 'long-context'], quality: 88, speed: 88, costTier: 2, maxOutputTokens: 12000 },
  { provider: 'mistral', model: 'mistral-large-latest', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'creative', 'tool-use', 'long-context'], quality: 91, speed: 80, costTier: 2, maxOutputTokens: 12000 },
  { provider: 'mistral', model: 'mistral-medium-latest', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'creative', 'tool-use', 'speed'], quality: 88, speed: 84, costTier: 2, maxOutputTokens: 12000 },
  { provider: 'mistral', model: 'mistral-small-latest', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'creative', 'tool-use', 'speed'], quality: 84, speed: 92, costTier: 1, maxOutputTokens: 8000 },
  { provider: 'gemini', model: 'gemini-3.7-flash', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'creative', 'tool-use', 'long-context', 'speed'], quality: 96, speed: 91, costTier: 2, maxOutputTokens: 64000 },
  { provider: 'gemini', model: 'gemini-3.6-flash', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'creative', 'tool-use', 'long-context', 'speed'], quality: 93, speed: 91, costTier: 2, maxOutputTokens: 12000 },
  { provider: 'gemini', model: 'gemini-3.5-flash', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'creative', 'tool-use', 'long-context', 'speed'], quality: 90, speed: 90, costTier: 2, maxOutputTokens: 12000 },
  { provider: 'gemini', model: 'gemini-3.5-flash-lite', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'tool-use', 'speed'], quality: 84, speed: 96, costTier: 1, maxOutputTokens: 8000 },
  { provider: 'gemini', model: 'gemini-2.5-flash', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'creative', 'tool-use', 'long-context', 'speed'], quality: 87, speed: 92, costTier: 1, maxOutputTokens: 8000 },
  { provider: 'cerebras', model: 'gpt-oss-120b', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'tool-use', 'speed'], quality: 89, speed: 99, costTier: 1, maxOutputTokens: 16000 },
  { provider: 'cerebras', model: 'llama-3.3-70b', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'tool-use', 'speed'], quality: 86, speed: 99, costTier: 1, maxOutputTokens: 12000 },
]

const TASK_CAPABILITIES: Record<TaskType, readonly ModelCapability[]> = {
  general: ['reasoning', 'tool-use'], research: ['research', 'long-context'], reasoning: ['reasoning', 'analysis'], coding: ['coding', 'tool-use', 'reasoning'], creative: ['creative', 'reasoning'], financial: ['analysis', 'reasoning', 'long-context'], security: ['reasoning', 'coding', 'analysis'], operations: ['analysis', 'tool-use', 'speed'], analysis: ['analysis', 'reasoning'],
}

function configured(provider: ActiveProviderId): boolean { return Boolean(process.env[PROVIDER_RUNTIME_CONFIG[provider].apiKeyEnv]?.trim()) }

export const PROVIDER_ORDER: readonly ActiveProviderId[] = ['groq', 'zai', 'mistral', 'gemini', 'cerebras']

export function getConfiguredProviders(): ActiveProviderId[] {
  return Object.keys(PROVIDER_RUNTIME_CONFIG).filter((provider) => configured(provider as ActiveProviderId)).sort(
    (a, b) => PROVIDER_ORDER.indexOf(a as ActiveProviderId) - PROVIDER_ORDER.indexOf(b as ActiveProviderId),
  ) as ActiveProviderId[]
}

export function getGovernedCandidates(provider: ActiveProviderId, taskType: TaskType, verification?: VerificationTier): string[] {
  const required = TASK_CAPABILITIES[taskType]
  const strict = verification === 'dual-review' || taskType === 'financial' || taskType === 'security'
  return GOVERNED_MODEL_PROFILES
    .filter((profile) => profile.provider === provider)
    .filter((profile) => required.every((capability) => profile.capabilities.includes(capability)))
    .sort((a, b) => {
      const ar = a.quality * 0.55 + a.speed * 0.2 + (a.costTier === 1 ? 10 : a.costTier === 2 ? 5 : 0) + (strict && a.quality >= 90 ? 5 : 0)
      const br = b.quality * 0.55 + b.speed * 0.2 + (b.costTier === 1 ? 10 : b.costTier === 2 ? 5 : 0) + (strict && b.quality >= 90 ? 5 : 0)
      return br - ar
    })
    .map((profile) => profile.model)
}

export function getModelForProviderGoverned(provider: ActiveProviderId, taskType: TaskType, verification?: VerificationTier): string | undefined {
  return getGovernedCandidates(provider, taskType, verification)[0]
}

export function classifyProviderError(provider: ActiveProviderId, status?: number, message = ''): ProviderControlPlaneErrorShape {
  const lower = message.toLowerCase()
  if (status === 401) return { provider, kind: 'AUTHENTICATION', status, message, retryable: false }
  if (status === 403) return { provider, kind: 'AUTHORIZATION', status, message, retryable: false }
  if (status === 402 || /billing|payment|credit|insufficient.{0,20}(credit|fund|balance)|quota exceeded/.test(lower)) return { provider, kind: 'BILLING', status, message, retryable: false }
  if (status === 429 || /rate.?limit|too many requests/.test(lower)) return { provider, kind: 'RATE_LIMIT', status, message, retryable: true }
  if (status === 404 || /model.+(not found|unavailable)|unknown model/.test(lower)) return { provider, kind: 'MODEL_UNAVAILABLE', status, message, retryable: false }
  if (status === 400) return { provider, kind: 'INVALID_REQUEST', status, message, retryable: false }
  if (status !== undefined && status >= 500) return { provider, kind: 'UPSTREAM', status, message, retryable: true }
  if (/timeout|timed out|abort/.test(lower)) return { provider, kind: 'TIMEOUT', status, message, retryable: true }
  if (/fetch failed|network|econn|enotfound|dns/.test(lower)) return { provider, kind: 'NETWORK', status, message, retryable: true }
  return { provider, kind: 'UNKNOWN', status, message, retryable: false }
}

function extractModelIds(data: any): string[] {
  if (Array.isArray(data?.data)) return data.data.map((model: any) => model?.id).filter((id: unknown): id is string => typeof id === 'string')
  if (Array.isArray(data?.models)) return data.models.map((model: any) => typeof model?.name === 'string' ? model.name.replace(/^models\//, '') : model?.baseModelId).filter((id: unknown): id is string => typeof id === 'string')
  return []
}

interface LiveCatalog { provider: ActiveProviderId; modelIds: readonly string[]; fetchedAt: number }
const catalogCache = new Map<ActiveProviderId, LiveCatalog>()
const CACHE_TTL_MS = 60_000

export interface CatalogFetchResult {
  provider: ActiveProviderId
  modelIds: readonly string[]
  source: 'live-api' | 'execution-validated'
  fetchedAt: number
}

export async function resolveLiveCatalog(provider: ActiveProviderId, fetchImpl: typeof fetch = fetch, forceRefresh = false): Promise<CatalogFetchResult> {
  const config = PROVIDER_RUNTIME_CONFIG[provider]
  const key = process.env[config.apiKeyEnv]?.trim()
  if (!key) throw new ProviderControlPlaneError({ provider, kind: 'AUTHENTICATION', message: `${config.label} is not configured (${config.apiKeyEnv})`, retryable: false })
  if (!forceRefresh && config.modelsUrl) {
    const cached = catalogCache.get(provider)
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return { ...cached, source: 'live-api' }
  }
  if (!config.modelsUrl) return { provider, modelIds: getGovernedCandidates(provider, 'general'), source: 'execution-validated', fetchedAt: Date.now() }
  const started = Date.now()
  try {
    const response = await fetchImpl(config.modelsUrl, { method: 'GET', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(7000) })
    const bodyText = response.ok ? '' : (await response.text()).slice(0, 500)
    if (!response.ok) {
      const classified = classifyProviderError(provider, response.status, bodyText)
      throw new ProviderControlPlaneError({ ...classified, message: `${config.label}: live model catalog HTTP ${response.status}${bodyText ? ` — ${bodyText}` : ''}` })
    }
    const modelIds = extractModelIds(await response.json())
    if (!modelIds.length) throw new ProviderControlPlaneError({ provider, kind: 'CATALOG_UNAVAILABLE', message: `${config.label}: live model catalog returned no model identifiers`, retryable: true })
    const catalog = { provider, modelIds, fetchedAt: started }
    catalogCache.set(provider, catalog)
    return { ...catalog, source: 'live-api' }
  } catch (error) {
    if (error instanceof ProviderControlPlaneError) throw error
    const classified = classifyProviderError(provider, undefined, error instanceof Error ? error.message : String(error))
    throw new ProviderControlPlaneError({ ...classified, kind: classified.kind === 'UNKNOWN' ? 'CATALOG_UNAVAILABLE' : classified.kind, retryable: true })
  }
}

export async function resolveGovernedModel(
  provider: ActiveProviderId,
  taskType: TaskType,
  verification?: VerificationTier,
  requestedModel?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const governed = getGovernedCandidates(provider, taskType, verification)
  if (!governed.length) throw new ProviderControlPlaneError({ provider, kind: 'MODEL_NOT_GOVERNED', message: `${PROVIDER_RUNTIME_CONFIG[provider].label}: no governed model satisfies task capability requirements`, retryable: false })
  if (requestedModel && !governed.includes(requestedModel)) {
    throw new ProviderControlPlaneError({ provider, kind: 'MODEL_NOT_GOVERNED', message: `${PROVIDER_RUNTIME_CONFIG[provider].label}: requested model is outside the governed model matrix`, retryable: false })
  }
  const catalog = await resolveLiveCatalog(provider, fetchImpl)
  const selected = governed.find((model) => catalog.modelIds.includes(model))
  if (!selected) {
    throw new ProviderControlPlaneError({ provider, kind: 'MODEL_NOT_GOVERNED', message: `${PROVIDER_RUNTIME_CONFIG[provider].label}: no governed model is currently available in the live provider catalog`, retryable: false })
  }
  return requestedModel && catalog.modelIds.includes(requestedModel) ? requestedModel : selected
}

export function clearProviderCatalogCache(provider?: ActiveProviderId): void {
  if (provider) catalogCache.delete(provider)
  else catalogCache.clear()
}

export function getProviderCatalogSnapshot(): Record<ActiveProviderId, { cached: boolean; ageMs: number | null }> {
  return Object.fromEntries(PROVIDER_ORDER.map((provider) => {
    const cached = catalogCache.get(provider)
    return [provider, { cached: Boolean(cached), ageMs: cached ? Date.now() - cached.fetchedAt : null }]
  })) as Record<ActiveProviderId, { cached: boolean; ageMs: number | null }>
}
