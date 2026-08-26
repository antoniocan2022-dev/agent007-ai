import { getProviderTaskPolicy, rankAvailableProviders, type ProviderTaskPolicy } from './provider-intelligence-policy'
import { isCircuitOpen, recordFailure, recordSuccess } from './provider-intelligence'
import { PROVIDER_RUNTIME_CONFIG, ProviderControlPlaneError, classifyProviderError, getConfiguredProviders, getGovernedCandidates, PROVIDER_ORDER, resolveLiveCatalog, resolveGovernedModel, type ActiveProviderId } from './provider-control-plane'
import { getModelForProvider } from './model-intelligence'
import { recordModelPerformance } from './performance-intelligence'
import { recordModelOutcome, recommendByVerifiedOutcome, type OutcomeStatus } from './outcome-intelligence'
import type { TaskType, VerificationTier } from './subagent-governance'

export type { ActiveProviderId }
export { PROVIDER_RUNTIME_CONFIG, getConfiguredProviders }
export function getProviderRuntimeConfig(provider: ActiveProviderId) { return PROVIDER_RUNTIME_CONFIG[provider] }
export interface ProviderRuntimeOutcomeEvidence { status: OutcomeStatus; qualityScore?: number; businessValueScore?: number; verificationPassed: boolean }
export interface ProviderRuntimeRequest { messages: readonly Record<string, unknown>[]; taskType?: TaskType; verification?: VerificationTier; model?: string; temperature?: number; maxTokens?: number; timeoutMs?: number; maxProviderAttempts?: number; outcomeEvidence?: ProviderRuntimeOutcomeEvidence; excludeProviders?: readonly ActiveProviderId[] }
export interface ProviderRuntimeResult { provider: ActiveProviderId; model: string; content: string; attempts: ActiveProviderId[]; responseMs: number }
export type ProviderDiagnosticState = 'healthy' | 'degraded' | 'failed' | 'unknown'
export interface ProviderRuntimeProbeResult {
  provider: ActiveProviderId
  configured: boolean
  success: boolean
  model: string | null
  responseMs: number | null
  error?: string
  states: { credential: ProviderDiagnosticState; network: ProviderDiagnosticState; catalog: ProviderDiagnosticState; governedModel: ProviderDiagnosticState; taskCapability: ProviderDiagnosticState; execution: ProviderDiagnosticState; latency: ProviderDiagnosticState; rateLimit: ProviderDiagnosticState; billing: ProviderDiagnosticState; circuitBreaker: ProviderDiagnosticState }
  catalogSource?: 'live-api' | 'execution-validated'
  catalogModelCount?: number
  governedCandidates?: string[]
}

function extractContent(data: any): string {
  const content = data?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((part: any) => typeof part?.text === 'string' ? part.text : '').join('')
  return ''
}
function modelFor(provider: ActiveProviderId, taskType: TaskType, verification?: VerificationTier): string { return getModelForProvider(provider, taskType, verification) || PROVIDER_RUNTIME_CONFIG[provider].defaultModel }
function shouldAffectProviderHealth(kind: ReturnType<typeof classifyProviderError>['kind']): boolean { return ['UPSTREAM', 'TIMEOUT', 'NETWORK', 'CATALOG_UNAVAILABLE', 'UNKNOWN'].includes(kind) }
function buildProviderFailure(provider: ActiveProviderId, status: number | undefined, message: string): ProviderControlPlaneError { return new ProviderControlPlaneError({ ...classifyProviderError(provider, status, message), message: `${PROVIDER_RUNTIME_CONFIG[provider].label}: ${message}` }) }
function resolveChatEndpoint(provider: ActiveProviderId): string {
  const config = PROVIDER_RUNTIME_CONFIG[provider]
  if (!config.accountIdEnv) return config.baseUrl
  const accountId = process.env[config.accountIdEnv]?.trim()
  if (!accountId) throw new ProviderControlPlaneError({ provider, kind: 'AUTHENTICATION', message: `${config.label}: ${config.accountIdEnv} is not configured`, retryable: false })
  return config.baseUrl.replace('{ACCOUNT_ID}', encodeURIComponent(accountId))
}

async function callProvider(provider: ActiveProviderId, request: ProviderRuntimeRequest): Promise<ProviderRuntimeResult> {
  const config = PROVIDER_RUNTIME_CONFIG[provider]
  const key = process.env[config.apiKeyEnv]?.trim()
  if (!key) throw buildProviderFailure(provider, 401, `${config.label} is not configured (${config.apiKeyEnv})`)
  const taskType = request.taskType ?? 'general'
  const started = Date.now()
  let model = modelFor(provider, taskType, request.verification)
  try { model = await resolveGovernedModel(provider, taskType, request.verification, request.model) }
  catch (error) { if (error instanceof ProviderControlPlaneError) throw error; throw buildProviderFailure(provider, undefined, error instanceof Error ? error.message : String(error)) }
  const timeoutMs = Math.max(1000, request.timeoutMs ?? 60000)
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(resolveChatEndpoint(provider), { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages: request.messages, max_tokens: Math.max(64, request.maxTokens ?? 4000), temperature: request.temperature ?? 0.2 }), signal: controller.signal })
    const responseMs = Date.now() - started
    if (!response.ok) { const detail = (await response.text()).slice(0, 700); throw buildProviderFailure(provider, response.status, `HTTP ${response.status}${detail ? ` — ${detail}` : ''}`) }
    const data = await response.json(); const content = extractContent(data)
    if (!content) throw buildProviderFailure(provider, undefined, 'response contained no assistant content')
    recordSuccess(provider, responseMs); recordModelPerformance({ provider, model, taskType, success: true, responseMs })
    if (request.outcomeEvidence) recordModelOutcome({ provider, model, taskType, ...request.outcomeEvidence })
    return { provider, model, content, attempts: [provider], responseMs }
  } catch (error) {
    const responseMs = Date.now() - started
    if (error instanceof ProviderControlPlaneError) { if (shouldAffectProviderHealth(error.kind)) recordFailure(provider); recordModelPerformance({ provider, model, taskType, success: false, responseMs }); throw error }
    recordFailure(provider); recordModelPerformance({ provider, model, taskType, success: false, responseMs }); throw buildProviderFailure(provider, undefined, error instanceof Error ? error.message : String(error))
  } finally { clearTimeout(timeout) }
}

function rankCandidates(candidates: ActiveProviderId[], taskType: TaskType, verification?: VerificationTier): ActiveProviderId[] {
  const policyOrder = new Map(candidates.map((provider, index) => [provider, index])); const outcomeSnapshots = recommendByVerifiedOutcome(taskType, candidates.map((provider) => ({ provider, model: modelFor(provider, taskType, verification) }))); const trusted = outcomeSnapshots.filter((snapshot) => snapshot.confidence >= 40 && snapshot.observations > 0)
  if (!trusted.length) return candidates
  const outcomeRank = new Map(trusted.map((snapshot, index) => [snapshot.provider, index])); return [...candidates].sort((a, b) => { const ar = outcomeRank.get(a); const br = outcomeRank.get(b); if (ar !== undefined && br !== undefined) return ar - br; if (ar !== undefined) return -1; if (br !== undefined) return 1; return (policyOrder.get(a) ?? Number.MAX_SAFE_INTEGER) - (policyOrder.get(b) ?? Number.MAX_SAFE_INTEGER) })
}

function baseDiagnostic(provider: ActiveProviderId): ProviderRuntimeProbeResult {
  const config = PROVIDER_RUNTIME_CONFIG[provider]
  const credentialConfigured = Boolean(process.env[config.apiKeyEnv]?.trim()) && (!config.accountIdEnv || Boolean(process.env[config.accountIdEnv]?.trim()))
  return { provider, configured: credentialConfigured, success: false, model: null, responseMs: null, states: { credential: credentialConfigured ? 'healthy' : 'failed', network: 'unknown', catalog: 'unknown', governedModel: 'unknown', taskCapability: 'unknown', execution: 'unknown', latency: 'unknown', rateLimit: 'unknown', billing: 'unknown', circuitBreaker: isCircuitOpen(provider) ? 'degraded' : 'healthy' } }
}

export async function probeProvider(provider: ActiveProviderId, request?: Partial<ProviderRuntimeRequest>): Promise<ProviderRuntimeProbeResult> {
  const result = baseDiagnostic(provider); const config = PROVIDER_RUNTIME_CONFIG[provider]
  if (!result.configured) { result.error = `${config.label}: required credentials are not configured`; result.states.execution = 'failed'; return result }
  if (isCircuitOpen(provider)) { result.error = 'Provider circuit breaker is open'; result.states.circuitBreaker = 'degraded'; result.states.execution = 'degraded'; return result }
  const taskType = request?.taskType ?? 'reasoning'; const verification = request?.verification ?? 'standard'
  const candidates = getGovernedCandidates(provider, taskType, verification); result.governedCandidates = candidates; result.states.taskCapability = candidates.length ? 'healthy' : 'failed'
  if (!candidates.length) { result.error = `${config.label}: no governed model satisfies task capability requirements`; result.states.governedModel = 'failed'; result.states.execution = 'failed'; return result }
  result.states.governedModel = 'healthy'
  try {
    const catalog = await resolveLiveCatalog(provider, fetch, true); result.catalogSource = catalog.source; result.catalogModelCount = catalog.modelIds.length; result.states.catalog = 'healthy'
  } catch (error) { result.states.catalog = 'failed'; result.states.execution = 'failed'; result.error = error instanceof Error ? error.message.slice(0, 700) : String(error).slice(0, 700); return result }
  try {
    const started = Date.now(); const execution = await callProvider(provider, { messages: request?.messages ?? [{ role: 'system', content: 'You are a production reasoning health probe. Reply with exactly: OK' }, { role: 'user', content: 'Say OK' }], taskType, verification, model: request?.model, temperature: 0, maxTokens: Math.max(128, request?.maxTokens ?? 128), timeoutMs: request?.timeoutMs ?? 10000 })
    result.responseMs = Date.now() - started; result.model = execution.model; result.success = /^OK(?:\b|$)/i.test(execution.content.trim()); result.states.network = 'healthy'; result.states.execution = result.success ? 'healthy' : 'degraded'; result.states.latency = result.responseMs <= 1500 ? 'healthy' : result.responseMs <= 5000 ? 'degraded' : 'failed'; if (!result.success) result.error = `Unexpected probe response: ${execution.content.trim().slice(0, 120)}`
  } catch (error) {
    result.states.execution = 'failed'
    if (error instanceof ProviderControlPlaneError) { result.states.network = ['NETWORK', 'TIMEOUT', 'UPSTREAM'].includes(error.kind) ? 'failed' : 'healthy'; if (error.kind === 'RATE_LIMIT') result.states.rateLimit = 'failed'; if (error.kind === 'BILLING') result.states.billing = 'failed'; if (error.kind === 'AUTHENTICATION' || error.kind === 'AUTHORIZATION') result.states.credential = 'failed'; if (error.kind === 'MODEL_UNAVAILABLE' || error.kind === 'MODEL_NOT_GOVERNED') result.states.governedModel = 'failed'; result.error = error.message.slice(0, 700) }
    else { result.states.network = 'failed'; result.error = error instanceof Error ? error.message.slice(0, 700) : String(error).slice(0, 700) }
  }
  return result
}

/** Probe every canonical provider, including unconfigured ones, so the Control Tower never hides missing credentials. */
export async function probeAllProviders(taskType: TaskType = 'reasoning'): Promise<ProviderRuntimeProbeResult[]> { return Promise.all(PROVIDER_ORDER.map((provider) => probeProvider(provider, { taskType }))) }
/** Backward-compatible name; intentionally probes the full canonical set. */
export async function probeAllConfiguredProviders(taskType: TaskType = 'reasoning'): Promise<ProviderRuntimeProbeResult[]> { return probeAllProviders(taskType) }

export async function runGovernedProviderChat(request: ProviderRuntimeRequest): Promise<ProviderRuntimeResult> {
  const taskType = request.taskType ?? 'general'; const policy: ProviderTaskPolicy = getProviderTaskPolicy(taskType, request.verification); const excluded = new Set(request.excludeProviders ?? []); const configured = getConfiguredProviders().filter((provider) => !excluded.has(provider)); const available = rankAvailableProviders(configured).filter((provider) => !isCircuitOpen(provider)) as ActiveProviderId[]; const candidates = rankCandidates(available, taskType, request.verification); const maxAttempts = Math.min(Math.max(Math.trunc(request.maxProviderAttempts ?? candidates.length), 1), candidates.length)
  if (!candidates.length) throw new Error(`No governed providers configured and healthy after exclusions. Required priority: ${policy.providerOrder.join(' → ')}`)
  const attempts: ActiveProviderId[] = []; const failures: string[] = []
  for (const provider of candidates.slice(0, maxAttempts)) { attempts.push(provider); try { return { ...(await callProvider(provider, request)), attempts } } catch (error) { failures.push(error instanceof ProviderControlPlaneError ? `${error.provider}:${error.kind}${error.status ? `:${error.status}` : ''}` : `${provider}:UNKNOWN`) } }
  throw new Error(`All governed providers failed (${attempts.join(' → ')}). Failure classes: ${failures.join(' | ')}`)
}
