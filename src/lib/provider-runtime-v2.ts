import { getProviderTaskPolicy, rankAvailableProviders, type ProviderTaskPolicy } from './provider-intelligence-policy'
import { isCircuitOpen, recordFailure, recordSuccess } from './provider-intelligence'
import { getModelForProvider } from './model-intelligence'
import { recordModelPerformance } from './performance-intelligence'
import { recordModelOutcome, recommendByVerifiedOutcome, type OutcomeStatus } from './outcome-intelligence'
import type { ProviderId, TaskType, VerificationTier } from './subagent-governance'

export type ActiveProviderId = Exclude<ProviderId, 'openai'>

export interface ProviderRuntimeConfig {
  id: ActiveProviderId
  label: string
  baseUrl: string
  apiKeyEnv: string
  modelEnv: string
  defaultModel: string
  modelsUrl?: string
  preferredModels?: readonly string[]
}

export interface ProviderRuntimeOutcomeEvidence {
  status: OutcomeStatus
  qualityScore?: number
  businessValueScore?: number
  verificationPassed: boolean
}

export interface ProviderRuntimeRequest {
  messages: readonly Record<string, unknown>[]
  taskType?: TaskType
  verification?: VerificationTier
  model?: string
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
  maxProviderAttempts?: number
  outcomeEvidence?: ProviderRuntimeOutcomeEvidence
}

export interface ProviderRuntimeResult { provider: ActiveProviderId; model: string; content: string; attempts: ActiveProviderId[]; responseMs: number }
export interface ProviderRuntimeProbeResult { provider: ActiveProviderId; configured: boolean; success: boolean; model: string | null; responseMs: number | null; error?: string }

/** OpenAI is intentionally absent: it is disabled by governance and cannot be selected or called. */
export const PROVIDER_RUNTIME_CONFIG: Readonly<Record<ActiveProviderId, ProviderRuntimeConfig>> = {
  groq: { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1/chat/completions', apiKeyEnv: 'GROQ_API_KEY', modelEnv: 'GROQ_MODEL', defaultModel: 'llama-3.3-70b-versatile', modelsUrl: 'https://api.groq.com/openai/v1/models', preferredModels: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'llama-3.1-8b-instant'] },
  zai: { id: 'zai', label: 'Z.AI', baseUrl: 'https://api.z.ai/api/paas/v4/chat/completions', apiKeyEnv: 'ZAI_API_KEY', modelEnv: 'ZAI_MODEL', defaultModel: 'glm-5.1', preferredModels: ['glm-5.1', 'glm-5', 'glm-4.5-air', 'glm-4.5-flash'] },
  mistral: { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1/chat/completions', apiKeyEnv: 'MISTRAL_API_KEY', modelEnv: 'MISTRAL_MODEL', defaultModel: 'mistral-large-latest', modelsUrl: 'https://api.mistral.ai/v1/models', preferredModels: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest'] },
  gemini: { id: 'gemini', label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', apiKeyEnv: 'GEMINI_API_KEY', modelEnv: 'GEMINI_MODEL', defaultModel: 'gemini-3.6-flash', modelsUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/models', preferredModels: ['gemini-3.6-flash'] },
  cerebras: { id: 'cerebras', label: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1/chat/completions', apiKeyEnv: 'CEREBRAS_API_KEY', modelEnv: 'CEREBRAS_MODEL', defaultModel: 'gpt-oss-120b', modelsUrl: 'https://api.cerebras.ai/v1/models', preferredModels: ['gpt-oss-120b', 'llama-3.3-70b', 'llama-3.1-70b'] },
}

interface ModelCacheEntry { model: string; expiresAt: number }
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000
const GLOBAL = globalThis as typeof globalThis & { __agent007ProviderModelCache?: Partial<Record<ActiveProviderId, ModelCacheEntry>> }
if (!GLOBAL.__agent007ProviderModelCache) GLOBAL.__agent007ProviderModelCache = {}
const providerModelCache = GLOBAL.__agent007ProviderModelCache

function readEnv(name: string): string | undefined { const value = process.env[name]; return value && value.trim() ? value.trim() : undefined }
export function getConfiguredProviders(): ActiveProviderId[] { return rankAvailableProviders(Object.values(PROVIDER_RUNTIME_CONFIG).filter((config) => !!readEnv(config.apiKeyEnv)).map((config) => config.id)) as ActiveProviderId[] }
export function getProviderRuntimeConfig(provider: ActiveProviderId): ProviderRuntimeConfig { return PROVIDER_RUNTIME_CONFIG[provider] }
function extractContent(data: any): string { const content = data?.choices?.[0]?.message?.content; if (typeof content === 'string') return content; if (Array.isArray(content)) return content.map((part: any) => typeof part?.text === 'string' ? part.text : '').join(''); return '' }
function isRetryableStatus(status: number): boolean { return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500 }
function isProviderConfigurationError(status: number): boolean { return status === 401 || status === 403 }
function governedModelFor(provider: ActiveProviderId, taskType: TaskType, verification?: VerificationTier): string { return getModelForProvider(provider, taskType, verification) || PROVIDER_RUNTIME_CONFIG[provider].defaultModel }
function modelFor(provider: ActiveProviderId, taskType: TaskType, verification?: VerificationTier): string { return governedModelFor(provider, taskType, verification) }
function extractModelIds(data: any): string[] {
  if (Array.isArray(data?.data)) return data.data.map((model: any) => model?.id).filter((id: unknown): id is string => typeof id === 'string')
  if (Array.isArray(data?.models)) return data.models.map((model: any) => typeof model?.name === 'string' ? model.name.replace(/^models\//, '') : model?.baseModelId).filter((id: unknown): id is string => typeof id === 'string')
  return []
}

async function resolveAccessibleModel(provider: ActiveProviderId, taskType: TaskType, verification?: VerificationTier): Promise<string> {
  const config = PROVIDER_RUNTIME_CONFIG[provider]
  const governedPreferred = governedModelFor(provider, taskType, verification)
  const cached = providerModelCache[provider]
  if (cached && cached.expiresAt > Date.now()) return cached.model
  if (!config.modelsUrl) return governedPreferred
  const key = readEnv(config.apiKeyEnv)
  if (!key) return governedPreferred
  try {
    const response = await fetch(config.modelsUrl, { method: 'GET', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000) })
    if (!response.ok) return governedPreferred
    const ids = extractModelIds(await response.json())
    if (!ids.length) return governedPreferred

    // Model environment variables are deliberately advisory only. Never allow
    // a stale/retired value to override the governed model matrix, even when
    // the provider's catalog still advertises that obsolete value.
    const governedCandidates = [governedPreferred, config.defaultModel, ...(config.preferredModels ?? [])]
    const selected = governedCandidates.find((candidate) => ids.includes(candidate))
    if (!selected) throw new Error(`${config.label}: no governed model is available in the live provider catalog`)
    providerModelCache[provider] = { model: selected, expiresAt: Date.now() + MODEL_CACHE_TTL_MS }
    return selected
  } catch (error) {
    if (error instanceof Error && /no governed model is available/.test(error.message)) throw error
    return governedPreferred
  }
}

async function callProvider(provider: ActiveProviderId, request: ProviderRuntimeRequest): Promise<ProviderRuntimeResult> {
  const config = PROVIDER_RUNTIME_CONFIG[provider]
  const key = readEnv(config.apiKeyEnv)
  if (!key) throw new Error(`${config.label} is not configured (${config.apiKeyEnv})`)
  const taskType = request.taskType ?? 'general'
  const model = request.model || await resolveAccessibleModel(provider, taskType, request.verification)
  const timeoutMs = Math.max(1000, request.timeoutMs ?? 60000)
  const started = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const body: Record<string, unknown> = { model, messages: request.messages, temperature: request.temperature ?? 0.2, max_tokens: request.maxTokens ?? 4000 }
    if (provider === 'zai') body.thinking = { type: 'enabled' }
    const response = await fetch(config.baseUrl, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(provider === 'zai' ? { 'Accept-Language': 'en-US,en' } : {}) }, body: JSON.stringify(body), signal: controller.signal })
    const responseMs = Date.now() - started
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500)
      const error = new Error(`${config.label}: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`)
      ;(error as any).status = response.status
      throw error
    }
    const data = await response.json()
    const content = extractContent(data)
    if (!content) throw new Error(`${config.label}: response contained no assistant content`)
    recordSuccess(provider, responseMs)
    recordModelPerformance({ provider, model, taskType, success: true, responseMs })
    if (request.outcomeEvidence) recordModelOutcome({ provider, model, taskType, ...request.outcomeEvidence })
    return { provider, model, content, attempts: [provider], responseMs }
  } catch (error) {
    const responseMs = Date.now() - started
    recordFailure(provider)
    recordModelPerformance({ provider, model, taskType, success: false, responseMs })
    throw error
  } finally { clearTimeout(timeout) }
}

function rankCandidates(candidates: ActiveProviderId[], taskType: TaskType, verification?: VerificationTier): ActiveProviderId[] {
  const policyOrder = new Map(candidates.map((provider, index) => [provider, index]))
  const outcomeSnapshots = recommendByVerifiedOutcome(taskType, candidates.map((provider) => ({ provider, model: modelFor(provider, taskType, verification) })))
  const trusted = outcomeSnapshots.filter((snapshot) => snapshot.confidence >= 40 && snapshot.observations > 0)
  if (!trusted.length) return candidates
  const outcomeRank = new Map(trusted.map((snapshot, index) => [snapshot.provider, index]))
  return [...candidates].sort((a, b) => { const ar = outcomeRank.get(a); const br = outcomeRank.get(b); if (ar !== undefined && br !== undefined) return ar - br; if (ar !== undefined) return -1; if (br !== undefined) return 1; return (policyOrder.get(a) ?? Number.MAX_SAFE_INTEGER) - (policyOrder.get(b) ?? Number.MAX_SAFE_INTEGER) })
}

export async function probeProvider(provider: ActiveProviderId, request?: Partial<ProviderRuntimeRequest>): Promise<ProviderRuntimeProbeResult> {
  const config = PROVIDER_RUNTIME_CONFIG[provider]
  if (!readEnv(config.apiKeyEnv)) return { provider, configured: false, success: false, model: null, responseMs: null, error: `${config.apiKeyEnv} is not configured` }
  try {
    const started = Date.now()
    const result = await callProvider(provider, { messages: request?.messages ?? [{ role: 'system', content: 'You are a production health probe. Reply with exactly: OK' }, { role: 'user', content: 'Say OK' }], taskType: request?.taskType ?? 'operations', verification: request?.verification ?? 'standard', temperature: 0, maxTokens: Math.max(128, request?.maxTokens ?? 128), timeoutMs: request?.timeoutMs ?? 10000 })
    const content = result.content.trim()
    const success = /(^|\b)OK(\b|$)/i.test(content)
    return { provider, configured: true, success, model: result.model, responseMs: Date.now() - started, error: success ? undefined : `Unexpected probe response: ${content.slice(0, 120)}` }
  } catch (error) {
    return { provider, configured: true, success: false, model: providerModelCache[provider]?.model ?? governedModelFor(provider, request?.taskType ?? 'operations', request?.verification ?? 'standard'), responseMs: null, error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) }
  }
}

export async function probeAllConfiguredProviders(): Promise<ProviderRuntimeProbeResult[]> { const providers = Object.keys(PROVIDER_RUNTIME_CONFIG) as ActiveProviderId[]; return Promise.all(providers.map((provider) => probeProvider(provider))) }

export async function runGovernedProviderChat(request: ProviderRuntimeRequest): Promise<ProviderRuntimeResult> {
  const taskType = request.taskType ?? 'general'
  const policy: ProviderTaskPolicy = getProviderTaskPolicy(taskType, request.verification)
  const configured = getConfiguredProviders()
  const available = rankAvailableProviders(configured).filter((provider) => !isCircuitOpen(provider)) as ActiveProviderId[]
  const candidates = rankCandidates(available, taskType, request.verification)
  const maxAttempts = Math.min(Math.max(Math.trunc(request.maxProviderAttempts ?? candidates.length), 1), candidates.length)
  if (candidates.length === 0) throw new Error(`No governed providers available. Required priority: ${policy.providerOrder.join(' → ')}`)
  const attempts: ActiveProviderId[] = []
  let lastError: unknown
  for (const provider of candidates.slice(0, maxAttempts)) {
    attempts.push(provider)
    try { const result = await callProvider(provider, request); return { ...result, attempts } }
    catch (error) { lastError = error; const status = Number((error as any)?.status); if (Number.isFinite(status) && isProviderConfigurationError(status)) continue; if (Number.isFinite(status) && !isRetryableStatus(status)) continue }
  }
  throw new Error(`All governed providers failed (${attempts.join(' → ')}): ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}
