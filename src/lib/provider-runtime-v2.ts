import { getProviderTaskPolicy, rankAvailableProviders, type ProviderTaskPolicy } from './provider-intelligence-policy'
import { getHealthScore, isCircuitOpen, recordFailure, recordSuccess } from './provider-intelligence'
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

export interface ProviderRuntimeResult {
  provider: ActiveProviderId
  model: string
  content: string
  attempts: ActiveProviderId[]
  responseMs: number
}

/** OpenAI is intentionally absent: it is disabled by governance and cannot be selected or called. */
export const PROVIDER_RUNTIME_CONFIG: Readonly<Record<ActiveProviderId, ProviderRuntimeConfig>> = {
  groq: { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1/chat/completions', apiKeyEnv: 'GROQ_API_KEY', modelEnv: 'GROQ_MODEL', defaultModel: 'llama-3.3-70b-versatile' },
  zai: { id: 'zai', label: 'Z.AI', baseUrl: 'https://api.z.ai/api/paas/v4/chat/completions', apiKeyEnv: 'ZAI_API_KEY', modelEnv: 'ZAI_MODEL', defaultModel: 'glm-5.1' },
  mistral: { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1/chat/completions', apiKeyEnv: 'MISTRAL_API_KEY', modelEnv: 'MISTRAL_MODEL', defaultModel: 'mistral-large-latest' },
  gemini: { id: 'gemini', label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', apiKeyEnv: 'GEMINI_API_KEY', modelEnv: 'GEMINI_MODEL', defaultModel: 'gemini-3.7-flash' },
  cerebras: { id: 'cerebras', label: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1/chat/completions', apiKeyEnv: 'CEREBRAS_API_KEY', modelEnv: 'CEREBRAS_MODEL', defaultModel: 'gpt-oss-120b' },
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]
  return value && value.trim() ? value.trim() : undefined
}

export function getConfiguredProviders(): ActiveProviderId[] {
  return rankAvailableProviders(Object.values(PROVIDER_RUNTIME_CONFIG).filter((config) => !!readEnv(config.apiKeyEnv)).map((config) => config.id)) as ActiveProviderId[]
}

export function getProviderRuntimeConfig(provider: ActiveProviderId): ProviderRuntimeConfig {
  return PROVIDER_RUNTIME_CONFIG[provider]
}

function extractContent(data: any): string {
  const content = data?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((part: any) => typeof part?.text === 'string' ? part.text : '').join('')
  return ''
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
}

function isProviderConfigurationError(status: number): boolean {
  return status === 401 || status === 403
}

function modelFor(provider: ActiveProviderId, taskType: TaskType, verification?: VerificationTier): string {
  return getModelForProvider(provider, taskType, verification) || readEnv(PROVIDER_RUNTIME_CONFIG[provider].modelEnv) || PROVIDER_RUNTIME_CONFIG[provider].defaultModel
}

async function callProvider(provider: ActiveProviderId, request: ProviderRuntimeRequest): Promise<ProviderRuntimeResult> {
  const config = PROVIDER_RUNTIME_CONFIG[provider]
  const key = readEnv(config.apiKeyEnv)
  if (!key) throw new Error(`${config.label} is not configured (${config.apiKeyEnv})`)

  const taskType = request.taskType ?? 'general'
  const model = request.model || modelFor(provider, taskType, request.verification)
  const timeoutMs = Math.max(1000, request.timeoutMs ?? 60000)
  const started = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const body: Record<string, unknown> = { model, messages: request.messages, temperature: request.temperature ?? 0.2, max_tokens: request.maxTokens ?? 4000 }
    if (provider === 'zai') body.thinking = { type: 'enabled' }

    const response = await fetch(config.baseUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(provider === 'zai' ? { 'Accept-Language': 'en-US,en' } : {}) },
      body: JSON.stringify(body), signal: controller.signal,
    })

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
  } finally {
    clearTimeout(timeout)
  }
}

function rankCandidates(candidates: ActiveProviderId[], taskType: TaskType, verification?: VerificationTier): ActiveProviderId[] {
  const policyOrder = new Map(candidates.map((provider, index) => [provider, index]))
  const outcomeSnapshots = recommendByVerifiedOutcome(taskType, candidates.map((provider) => ({ provider, model: modelFor(provider, taskType, verification) })))
  const trusted = outcomeSnapshots.filter((snapshot) => snapshot.confidence >= 40 && snapshot.observations > 0)
  if (!trusted.length) return candidates
  const outcomeRank = new Map(trusted.map((snapshot, index) => [snapshot.provider, index]))
  return [...candidates].sort((a, b) => {
    const ar = outcomeRank.get(a)
    const br = outcomeRank.get(b)
    if (ar !== undefined && br !== undefined) return ar - br
    if (ar !== undefined) return -1
    if (br !== undefined) return 1
    return (policyOrder.get(a) ?? Number.MAX_SAFE_INTEGER) - (policyOrder.get(b) ?? Number.MAX_SAFE_INTEGER)
  })
}

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
    try {
      const result = await callProvider(provider, request)
      return { ...result, attempts }
    } catch (error) {
      lastError = error
      const status = Number((error as any)?.status)
      if (Number.isFinite(status) && isProviderConfigurationError(status)) continue
      if (Number.isFinite(status) && !isRetryableStatus(status)) continue
    }
  }

  throw new Error(`All governed providers failed (${attempts.join(' → ')}): ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}
