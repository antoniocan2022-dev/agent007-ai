import { getProviderTaskPolicy, rankAvailableProviders, type ProviderTaskPolicy } from './provider-intelligence-policy'
import { isCircuitOpen, recordFailure, recordSuccess } from './provider-intelligence'
import type { ProviderId, TaskType, VerificationTier } from './subagent-governance'

export interface ProviderRuntimeConfig {
  id: ProviderId
  label: string
  baseUrl: string
  apiKeyEnv: string
  modelEnv: string
  defaultModel: string
}

export interface ProviderRuntimeRequest {
  messages: readonly Record<string, unknown>[]
  taskType?: TaskType
  verification?: VerificationTier
  model?: string
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
}

export interface ProviderRuntimeResult {
  provider: ProviderId
  model: string
  content: string
  attempts: ProviderId[]
  responseMs: number
}

export const PROVIDER_RUNTIME_CONFIG: Readonly<Record<ProviderId, ProviderRuntimeConfig>> = {
  groq: {
    id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    apiKeyEnv: 'GROQ_API_KEY', modelEnv: 'GROQ_MODEL', defaultModel: 'llama-3.3-70b-versatile',
  },
  openai: {
    id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1/chat/completions',
    apiKeyEnv: 'OPENAI_API_KEY', modelEnv: 'OPENAI_MODEL', defaultModel: 'gpt-5',
  },
  zai: {
    id: 'zai', label: 'Z.ai', baseUrl: 'https://api.z.ai/api/paas/v4/chat/completions',
    apiKeyEnv: 'ZAI_API_KEY', modelEnv: 'ZAI_MODEL', defaultModel: 'glm-5.1',
  },
  mistral: {
    id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1/chat/completions',
    apiKeyEnv: 'MISTRAL_API_KEY', modelEnv: 'MISTRAL_MODEL', defaultModel: 'mistral-large-latest',
  },
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]
  return value && value.trim() ? value.trim() : undefined
}

export function getConfiguredProviders(): ProviderId[] {
  return rankAvailableProviders(Object.values(PROVIDER_RUNTIME_CONFIG)
    .filter((config) => !!readEnv(config.apiKeyEnv))
    .map((config) => config.id))
}

export function getProviderRuntimeConfig(provider: ProviderId): ProviderRuntimeConfig {
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

async function callProvider(provider: ProviderId, request: ProviderRuntimeRequest): Promise<ProviderRuntimeResult> {
  const config = PROVIDER_RUNTIME_CONFIG[provider]
  const key = readEnv(config.apiKeyEnv)
  if (!key) throw new Error(`${config.label} is not configured (${config.apiKeyEnv})`)

  const model = request.model || readEnv(config.modelEnv) || config.defaultModel
  const timeoutMs = Math.max(1000, request.timeoutMs ?? 60000)
  const started = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const body: Record<string, unknown> = {
      model,
      messages: request.messages,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 4000,
    }
    if (provider === 'zai') body.thinking = { type: 'enabled' }

    const response = await fetch(config.baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(provider === 'zai' ? { 'Accept-Language': 'en-US,en' } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
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
    return { provider, model, content, attempts: [provider], responseMs }
  } catch (error) {
    recordFailure(provider)
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Governed runtime entry point. Provider priority is always deterministic:
 * Groq → OpenAI → Z.ai → Mistral. Health is telemetry; circuit state is the
 * only runtime condition that removes a configured provider from the chain.
 */
export async function runGovernedProviderChat(request: ProviderRuntimeRequest): Promise<ProviderRuntimeResult> {
  const taskType = request.taskType ?? 'general'
  const policy: ProviderTaskPolicy = getProviderTaskPolicy(taskType, request.verification)
  const configured = getConfiguredProviders()
  const candidates = rankAvailableProviders(configured)
    .filter((provider) => !isCircuitOpen(provider))

  if (candidates.length === 0) {
    throw new Error(`No governed providers available. Required priority: ${policy.providerOrder.join(' → ')}`)
  }

  const attempts: ProviderId[] = []
  let lastError: unknown

  for (const provider of candidates) {
    attempts.push(provider)
    try {
      const result = await callProvider(provider, request)
      return { ...result, attempts }
    } catch (error) {
      lastError = error
      const status = Number((error as any)?.status)
      if (Number.isFinite(status) && !isRetryableStatus(status)) throw error
    }
  }

  throw new Error(`All governed providers failed (${attempts.join(' → ')}): ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}
