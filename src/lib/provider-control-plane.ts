import type { ProviderId, TaskType, VerificationTier } from './subagent-governance'

export type ActiveProviderId = Exclude<ProviderId, 'openai'>
export type ProviderErrorKind = 'AUTHENTICATION' | 'AUTHORIZATION' | 'BILLING' | 'RATE_LIMIT' | 'MODEL_UNAVAILABLE' | 'MODEL_NOT_GOVERNED' | 'CATALOG_UNAVAILABLE' | 'TIMEOUT' | 'NETWORK' | 'INVALID_REQUEST' | 'UPSTREAM' | 'UNKNOWN'

export class ProviderControlPlaneError extends Error {
  readonly provider: ActiveProviderId
  readonly kind: ProviderErrorKind
  readonly status?: number
  readonly retryable: boolean
  constructor(shape: { provider: ActiveProviderId; kind: ProviderErrorKind; status?: number; message: string; retryable: boolean }) {
    super(shape.message); this.name = 'ProviderControlPlaneError'; this.provider = shape.provider; this.kind = shape.kind; this.status = shape.status; this.retryable = shape.retryable
  }
}

export type ModelCapability = 'reasoning' | 'coding' | 'research' | 'analysis' | 'creative' | 'tool-use' | 'long-context' | 'speed' | 'vision'
export interface GovernedModelProfile { provider: ActiveProviderId; model: string; capabilities: readonly ModelCapability[]; quality: number; speed: number; costTier: 1 | 2 | 3; maxOutputTokens: number }
export interface ProviderRuntimeConfig { id: ActiveProviderId; label: string; baseUrl: string; apiKeyEnv: string; modelEnv: string; defaultModel: string; modelsUrl?: string; accountIdEnv?: string; preferredModels: readonly string[]; catalogMode: 'live-api' | 'execution-validated'; emergency?: boolean }

export const PROVIDER_RUNTIME_CONFIG: Readonly<Record<ActiveProviderId, ProviderRuntimeConfig>> = {
  groq: { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1/chat/completions', apiKeyEnv: 'GROQ_API_KEY', modelEnv: 'GROQ_MODEL', defaultModel: 'llama-3.3-70b-versatile', modelsUrl: 'https://api.groq.com/openai/v1/models', preferredModels: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'llama-3.1-8b-instant'], catalogMode: 'live-api' },
  cloudflare: { id: 'cloudflare', label: 'Cloudflare Workers AI', baseUrl: 'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1/chat/completions', apiKeyEnv: 'CLOUDFLARE_API_KEY', modelEnv: 'CLOUDFLARE_MODEL', defaultModel: '@cf/google/gemma-4-26b-a4b-it', modelsUrl: 'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/models/search', accountIdEnv: 'CLOUDFLARE_ACCOUNT_ID', preferredModels: ['@cf/google/gemma-4-26b-a4b-it'], catalogMode: 'live-api' },
  mistral: { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1/chat/completions', apiKeyEnv: 'MISTRAL_API_KEY', modelEnv: 'MISTRAL_MODEL', defaultModel: 'mistral-large-latest', modelsUrl: 'https://api.mistral.ai/v1/models', preferredModels: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest'], catalogMode: 'live-api' },
  cerebras: { id: 'cerebras', label: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1/chat/completions', apiKeyEnv: 'CEREBRAS_API_KEY', modelEnv: 'CEREBRAS_MODEL', defaultModel: 'gpt-oss-120b', modelsUrl: 'https://api.cerebras.ai/v1/models', preferredModels: ['gpt-oss-120b', 'llama-3.3-70b'], catalogMode: 'live-api' },
  openrouter: { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1/chat/completions', apiKeyEnv: 'OPENROUTER_API_KEY', modelEnv: 'OPENROUTER_MODEL', defaultModel: 'openrouter/free', preferredModels: ['openrouter/free'], catalogMode: 'execution-validated', emergency: true },
}

export const GOVERNED_MODEL_PROFILES: readonly GovernedModelProfile[] = [
  { provider: 'groq', model: 'llama-3.3-70b-versatile', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'tool-use', 'speed'], quality: 86, speed: 96, costTier: 1, maxOutputTokens: 8000 },
  { provider: 'groq', model: 'openai/gpt-oss-120b', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'tool-use', 'speed'], quality: 89, speed: 92, costTier: 1, maxOutputTokens: 8000 },
  { provider: 'cloudflare', model: '@cf/google/gemma-4-26b-a4b-it', capabilities: ['reasoning', 'analysis', 'tool-use', 'coding', 'research', 'long-context', 'vision'], quality: 94, speed: 90, costTier: 1, maxOutputTokens: 12000 },
  { provider: 'mistral', model: 'mistral-large-latest', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'creative', 'tool-use', 'long-context'], quality: 91, speed: 80, costTier: 2, maxOutputTokens: 12000 },
  { provider: 'mistral', model: 'mistral-medium-latest', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'creative', 'tool-use', 'speed'], quality: 88, speed: 84, costTier: 2, maxOutputTokens: 12000 },
  { provider: 'mistral', model: 'mistral-small-latest', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'creative', 'tool-use', 'speed'], quality: 84, speed: 92, costTier: 1, maxOutputTokens: 8000 },
  { provider: 'cerebras', model: 'gpt-oss-120b', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'tool-use', 'speed'], quality: 89, speed: 99, costTier: 1, maxOutputTokens: 16000 },
  { provider: 'cerebras', model: 'llama-3.3-70b', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'tool-use', 'speed'], quality: 86, speed: 99, costTier: 1, maxOutputTokens: 12000 },
  { provider: 'openrouter', model: 'openrouter/free', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'creative', 'tool-use', 'long-context'], quality: 75, speed: 70, costTier: 1, maxOutputTokens: 8000 },
]

export const TASK_CAPABILITIES: Readonly<Record<TaskType, readonly ModelCapability[]>> = {
  general: ['reasoning', 'tool-use'], research: ['research', 'long-context'], reasoning: ['reasoning', 'analysis'], coding: ['coding', 'tool-use', 'reasoning'], creative: ['creative', 'reasoning'], financial: ['analysis', 'reasoning', 'long-context'], security: ['reasoning', 'coding', 'analysis'], operations: ['analysis', 'tool-use', 'speed'], analysis: ['analysis', 'reasoning'],
}
export const PROVIDER_ORDER: readonly ActiveProviderId[] = ['groq', 'cloudflare', 'mistral', 'cerebras', 'openrouter']

export function isProviderConfigured(provider: ActiveProviderId): boolean {
  const config = PROVIDER_RUNTIME_CONFIG[provider]
  return Boolean(process.env[config.apiKeyEnv]?.trim()) && (!config.accountIdEnv || Boolean(process.env[config.accountIdEnv]?.trim()))
}
export function getConfiguredProviders(): ActiveProviderId[] { return PROVIDER_ORDER.filter(isProviderConfigured) }

export function getGovernedCandidates(provider: ActiveProviderId, taskType: TaskType, verification?: VerificationTier): string[] {
  const required = TASK_CAPABILITIES[taskType]
  const strict = verification === 'dual-review' || taskType === 'financial' || taskType === 'security'
  return GOVERNED_MODEL_PROFILES.filter((profile) => profile.provider === provider && required.every((capability) => profile.capabilities.includes(capability)))
    .sort((a, b) => {
      const score = (x: GovernedModelProfile) => x.quality * 0.55 + x.speed * 0.2 + (x.costTier === 1 ? 10 : x.costTier === 2 ? 5 : 0) + (strict && x.quality >= 90 ? 5 : 0)
      return score(b) - score(a)
    }).map((profile) => profile.model)
}
export function getModelForProviderGoverned(provider: ActiveProviderId, taskType: TaskType, verification?: VerificationTier): string | undefined { return getGovernedCandidates(provider, taskType, verification)[0] }

export function classifyProviderError(provider: ActiveProviderId, status?: number, message = '') {
  const lower = message.toLowerCase()
  if (status === 401) return { provider, kind: 'AUTHENTICATION' as const, status, message, retryable: false }
  if (status === 403) return { provider, kind: 'AUTHORIZATION' as const, status, message, retryable: false }
  if (status === 402 || /billing|payment|credit|insufficient.{0,20}(credit|fund|balance)|quota exceeded/.test(lower)) return { provider, kind: 'BILLING' as const, status, message, retryable: false }
  if (status === 429 || /rate.?limit|too many requests/.test(lower)) return { provider, kind: 'RATE_LIMIT' as const, status, message, retryable: true }
  if (status === 404 || /model.+(not found|unavailable)|unknown model/.test(lower)) return { provider, kind: 'MODEL_UNAVAILABLE' as const, status, message, retryable: false }
  if (status === 400) return { provider, kind: 'INVALID_REQUEST' as const, status, message, retryable: false }
  if (status !== undefined && status >= 500) return { provider, kind: 'UPSTREAM' as const, status, message, retryable: true }
  if (/timeout|timed out|abort/.test(lower)) return { provider, kind: 'TIMEOUT' as const, status, message, retryable: true }
  if (/fetch failed|network|econn|enotfound|dns/.test(lower)) return { provider, kind: 'NETWORK' as const, status, message, retryable: true }
  return { provider, kind: 'UNKNOWN' as const, status, message, retryable: false }
}

function resolveEndpoint(template: string, config: ProviderRuntimeConfig, provider: ActiveProviderId): string {
  if (!config.accountIdEnv) return template
  const accountId = process.env[config.accountIdEnv]?.trim()
  if (!accountId) throw new ProviderControlPlaneError({ provider, kind: 'AUTHENTICATION', message: `${config.label}: ${config.accountIdEnv} is not configured`, retryable: false })
  return template.replace('{ACCOUNT_ID}', encodeURIComponent(accountId))
}
function normalizeModelId(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim().replace(/^models\//, '') : null }
function extractModelIds(data: any, provider: ActiveProviderId): string[] {
  if (provider === 'cloudflare' && Array.isArray(data?.result)) return data.result.map((item: any) => normalizeModelId(item?.name ?? item?.model ?? item?.id)).filter((id: string | null): id is string => Boolean(id))
  if (Array.isArray(data?.data)) return data.data.map((item: any) => normalizeModelId(item?.id)).filter((id: string | null): id is string => Boolean(id))
  if (Array.isArray(data?.models)) return data.models.map((item: any) => normalizeModelId(item?.name ?? item?.baseModelId ?? item?.id)).filter((id: string | null): id is string => Boolean(id))
  return []
}

interface LiveCatalog { provider: ActiveProviderId; modelIds: readonly string[]; fetchedAt: number }
const catalogCache = new Map<ActiveProviderId, LiveCatalog>()
const CACHE_TTL_MS = 60_000
export interface CatalogFetchResult { provider: ActiveProviderId; modelIds: readonly string[]; source: 'live-api' | 'execution-validated'; fetchedAt: number }

export async function resolveLiveCatalog(provider: ActiveProviderId, fetchImpl: typeof fetch = fetch, forceRefresh = false): Promise<CatalogFetchResult> {
  const config = PROVIDER_RUNTIME_CONFIG[provider]
  if (!isProviderConfigured(provider)) throw new ProviderControlPlaneError({ provider, kind: 'AUTHENTICATION', message: `${config.label}: required credentials are not configured`, retryable: false })
  const endpoint = config.modelsUrl ? resolveEndpoint(config.modelsUrl, config, provider) : null
  if (!endpoint) return { provider, modelIds: getGovernedCandidates(provider, 'general'), source: 'execution-validated', fetchedAt: Date.now() }
  if (!forceRefresh) {
    const cached = catalogCache.get(provider)
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return { ...cached, source: 'live-api' }
  }
  try {
    const response = await fetchImpl(endpoint, { method: 'GET', headers: { Authorization: `Bearer ${process.env[config.apiKeyEnv]!.trim()}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(7000) })
    const bodyText = response.ok ? '' : (await response.text()).slice(0, 700)
    if (!response.ok) throw new ProviderControlPlaneError({ ...classifyProviderError(provider, response.status, bodyText), message: `${config.label}: live model catalog HTTP ${response.status}${bodyText ? ` — ${bodyText}` : ''}` })
    const modelIds = [...new Set(extractModelIds(await response.json(), provider))]
    if (!modelIds.length) throw new ProviderControlPlaneError({ provider, kind: 'CATALOG_UNAVAILABLE', message: `${config.label}: live model catalog returned no model identifiers`, retryable: true })
    const catalog = { provider, modelIds, fetchedAt: Date.now() }
    catalogCache.set(provider, catalog)
    return { ...catalog, source: 'live-api' }
  } catch (error) {
    if (error instanceof ProviderControlPlaneError) throw error
    const classified = classifyProviderError(provider, undefined, error instanceof Error ? error.message : String(error))
    throw new ProviderControlPlaneError({ ...classified, kind: classified.kind === 'UNKNOWN' ? 'CATALOG_UNAVAILABLE' : classified.kind, retryable: true })
  }
}

export async function resolveGovernedModel(provider: ActiveProviderId, taskType: TaskType, verification?: VerificationTier, requestedModel?: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const governed = getGovernedCandidates(provider, taskType, verification)
  if (!governed.length) throw new ProviderControlPlaneError({ provider, kind: 'MODEL_NOT_GOVERNED', message: `${PROVIDER_RUNTIME_CONFIG[provider].label}: no governed model satisfies task capability requirements`, retryable: false })
  if (requestedModel && !governed.includes(requestedModel)) throw new ProviderControlPlaneError({ provider, kind: 'MODEL_NOT_GOVERNED', message: `${PROVIDER_RUNTIME_CONFIG[provider].label}: requested model is outside the governed model matrix`, retryable: false })
  const catalog = await resolveLiveCatalog(provider, fetchImpl)
  if (provider === 'openrouter') return requestedModel ?? 'openrouter/free'
  const selected = requestedModel && catalog.modelIds.includes(requestedModel) ? requestedModel : governed.find((model) => catalog.modelIds.includes(model))
  if (!selected) throw new ProviderControlPlaneError({ provider, kind: 'MODEL_NOT_GOVERNED', message: `${PROVIDER_RUNTIME_CONFIG[provider].label}: no governed model is currently available in the live provider catalog`, retryable: false })
  return selected
}

export function clearProviderCatalogCache(provider?: ActiveProviderId): void { if (provider) catalogCache.delete(provider); else catalogCache.clear() }
export function getProviderCatalogSnapshot(): Record<ActiveProviderId, { cached: boolean; ageMs: number | null }> {
  return Object.fromEntries(PROVIDER_ORDER.map((provider) => { const cached = catalogCache.get(provider); return [provider, { cached: Boolean(cached), ageMs: cached ? Date.now() - cached.fetchedAt : null }] })) as Record<ActiveProviderId, { cached: boolean; ageMs: number | null }>
}
