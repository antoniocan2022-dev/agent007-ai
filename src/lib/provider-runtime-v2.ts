import { getProviderTaskPolicy, rankAvailableProviders, type ProviderTaskPolicy } from './provider-intelligence-policy'
import { isCircuitOpen, recordFailure, recordSuccess } from './provider-intelligence'
import { PROVIDER_RUNTIME_CONFIG, ProviderControlPlaneError, classifyProviderError, getConfiguredProviders, resolveGovernedModel, type ActiveProviderId } from './provider-control-plane'
import { getModelForProvider } from './model-intelligence'
import { recordModelPerformance } from './performance-intelligence'
import { recordModelOutcome, recommendByVerifiedOutcome, type OutcomeStatus } from './outcome-intelligence'
import type { ProviderId, TaskType, VerificationTier } from './subagent-governance'

export type { ActiveProviderId }
export { PROVIDER_RUNTIME_CONFIG, getConfiguredProviders }

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

function extractContent(data: any): string {
  const content = data?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((part: any) => typeof part?.text === 'string' ? part.text : '').join('')
  return ''
}

function modelFor(provider: ActiveProviderId, taskType: TaskType, verification?: VerificationTier): string {
  return getModelForProvider(provider, taskType, verification) || PROVIDER_RUNTIME_CONFIG[provider].defaultModel
}

function shouldAffectProviderHealth(kind: ReturnType<typeof classifyProviderError>['kind']): boolean {
  return kind === 'UPSTREAM' || kind === 'TIMEOUT' || kind === 'NETWORK' || kind === 'CATALOG_UNAVAILABLE' || kind === 'UNKNOWN'
}

function buildProviderFailure(provider: ActiveProviderId, status: number | undefined, message: string): ProviderControlPlaneError {
  return new ProviderControlPlaneError({ ...classifyProviderError(provider, status, message), message: `${PROVIDER_RUNTIME_CONFIG[provider].label}: ${message}` })
}

async function callProvider(provider: ActiveProviderId, request: ProviderRuntimeRequest): Promise<ProviderRuntimeResult> {
  const config = PROVIDER_RUNTIME_CONFIG[provider]
  const key = process.env[config.apiKeyEnv]?.trim()
  if (!key) throw buildProviderFailure(provider, 401, `${config.label} is not configured (${config.apiKeyEnv})`)

  const taskType = request.taskType ?? 'general'
  const started = Date.now()
  let model = modelFor(provider, taskType, request.verification)
  try {
    model = await resolveGovernedModel(provider, taskType, request.verification, request.model)
  } catch (error) {
    if (error instanceof ProviderControlPlaneError) throw error
    throw buildProviderFailure(provider, undefined, error instanceof Error ? error.message : String(error))
  }

  const timeoutMs = Math.max(1000, request.timeoutMs ?? 60000)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const body: Record<string, unknown> = {
      model,
      messages: request.messages,
      max_tokens: Math.max(64, request.maxTokens ?? 4000),
    }
    if (provider !== 'gemini') body.temperature = request.temperature ?? 0.2
    if (provider === 'zai') body.thinking = { type: 'enabled' }

    const response = await fetch(config.baseUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(provider === 'zai' ? { 'Accept-Language': 'en-US,en' } : {}) },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const responseMs = Date.now() - started
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 700)
      throw buildProviderFailure(provider, response.status, `HTTP ${response.status}${detail ? ` — ${detail}` : ''}`)
    }
    const data = await response.json()
    const content = extractContent(data)
    if (!content) throw buildProviderFailure(provider, undefined, 'response contained no assistant content')
    recordSuccess(provider, responseMs)
    recordModelPerformance({ provider, model, taskType, success: true, responseMs })
    if (request.outcomeEvidence) recordModelOutcome({ provider, model, taskType, ...request.outcomeEvidence })
    return { provider, model, content, attempts: [provider], responseMs }
  } catch (error) {
    const responseMs = Date.now() - started
    if (error instanceof ProviderControlPlaneError) {
      if (shouldAffectProviderHealth(error.kind)) recordFailure(provider)
      recordModelPerformance({ provider, model, taskType, success: false, responseMs })
      throw error
    }
    recordFailure(provider)
    recordModelPerformance({ provider, model, taskType, success: false, responseMs })
    throw buildProviderFailure(provider, undefined, error instanceof Error ? error.message : String(error))
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

export async function probeProvider(provider: ActiveProviderId, request?: Partial<ProviderRuntimeRequest>): Promise<ProviderRuntimeProbeResult> {
  const config = PROVIDER_RUNTIME_CONFIG[provider]
  if (!process.env[config.apiKeyEnv]?.trim()) return { provider, configured: false, success: false, model: null, responseMs: null, error: `${config.apiKeyEnv} is not configured` }
  try {
    const started = Date.now()
    const result = await callProvider(provider, {
      messages: request?.messages ?? [{ role: 'system', content: 'You are a production health probe. Reply with exactly: OK' }, { role: 'user', content: 'Say OK' }],
      taskType: request?.taskType ?? 'operations',
      verification: request?.verification ?? 'standard',
      temperature: 0,
      maxTokens: Math.max(128, request?.maxTokens ?? 128),
      timeoutMs: request?.timeoutMs ?? 10000,
    })
    const content = result.content.trim()
    const success = /(^|\b)OK(\b|$)/i.test(content)
    return { provider, configured: true, success, model: result.model, responseMs: Date.now() - started, error: success ? undefined : `Unexpected probe response: ${content.slice(0, 120)}` }
  } catch (error) {
    return { provider, configured: true, success: false, model: null, responseMs: null, error: error instanceof Error ? error.message.slice(0, 700) : String(error).slice(0, 700) }
  }
}

export async function probeAllConfiguredProviders(): Promise<ProviderRuntimeProbeResult[]> {
  return Promise.all((Object.keys(PROVIDER_RUNTIME_CONFIG) as ActiveProviderId[]).map((provider) => probeProvider(provider)))
}

export async function runGovernedProviderChat(request: ProviderRuntimeRequest): Promise<ProviderRuntimeResult> {
  const taskType = request.taskType ?? 'general'
  const policy: ProviderTaskPolicy = getProviderTaskPolicy(taskType, request.verification)
  const configured = getConfiguredProviders()
  const available = rankAvailableProviders(configured).filter((provider) => !isCircuitOpen(provider)) as ActiveProviderId[]
  const candidates = rankCandidates(available, taskType, request.verification)
  const maxAttempts = Math.min(Math.max(Math.trunc(request.maxProviderAttempts ?? candidates.length), 1), candidates.length)
  if (candidates.length === 0) throw new Error(`No governed providers configured and healthy. Required priority: ${policy.providerOrder.join(' → ')}`)

  const attempts: ActiveProviderId[] = []
  const failures: string[] = []
  for (const provider of candidates.slice(0, maxAttempts)) {
    attempts.push(provider)
    try {
      const result = await callProvider(provider, request)
      return { ...result, attempts }
    } catch (error) {
      failures.push(error instanceof ProviderControlPlaneError ? `${error.provider}:${error.kind}${error.status ? `:${error.status}` : ''}` : `${provider}:UNKNOWN`)
    }
  }
  throw new Error(`All governed providers failed (${attempts.join(' → ')}). Failure classes: ${failures.join(' | ')}`)
}
