import type { ProviderId, TaskType, VerificationTier } from './subagent-governance'

export type ActiveProviderId = Exclude<ProviderId, 'openai'>
export type ProviderErrorKind = 'AUTHENTICATION' | 'AUTHORIZATION' | 'BILLING' | 'RATE_LIMIT' | 'MODEL_UNAVAILABLE' | 'MODEL_NOT_GOVERNED' | 'CATALOG_UNAVAILABLE' | 'TIMEOUT' | 'NETWORK' | 'INVALID_REQUEST' | 'REQUEST_TOO_LARGE' | 'UPSTREAM' | 'UNKNOWN'

// Provider Gateway Phase A (2026-09-19): what a failure means is not the same question as whether it
// means the PROVIDER is unhealthy. A request that's too large for this provider's per-call token
// ceiling (REQUEST_TOO_LARGE) says nothing about the provider's own availability -- the same provider
// would happily serve a smaller request seconds later -- so it must never cool down or block the
// provider, only trigger a same-provider retry after compaction. RATE_LIMIT is a definitive, immediate
// signal (an explicit 429 unambiguously means "you are rate-limited right now"): cool the provider down
// for a bounded window rather than treating it as merely one failed attempt. BILLING/AUTHENTICATION/
// AUTHORIZATION are configuration problems retrying can never fix -- block the provider until the owner
// fixes the underlying account/credential issue, and don't burn attempts on it in the meantime.
// MODEL_UNAVAILABLE/MODEL_NOT_GOVERNED are about a specific model, not the provider itself -- the
// provider may have other governed models that work fine.
//
// Genuine infrastructure/connectivity failures (UPSTREAM 5xx, TIMEOUT, NETWORK, CATALOG_UNAVAILABLE)
// and truly unclassifiable errors (UNKNOWN) DO affect provider health -- but deliberately as
// affectsProviderHealth only, standing 'none': these are probabilistic, not definitive, signals (a
// single 503 is often a transient blip, not evidence the provider is actually down), which is exactly
// why the existing in-memory circuit breaker (provider-intelligence.ts's recordFailure) requires THREE
// such failures within 60 seconds -- with its own documented cold-start exemption -- before tripping,
// rather than reacting to the first one. Provider Gateway Phase B's durable standing layer
// (provider-standing.ts) is reserved for kinds where ONE occurrence is already unambiguous enough to
// act on immediately and durably (billing/auth/rate-limit); writing a durable 'cooldown' entry on the
// first UPSTREAM/TIMEOUT/NETWORK blip would make the durable layer MORE trigger-happy than the
// in-memory breaker it sits alongside, punishing exactly the transient flakiness that breaker was
// deliberately built to tolerate.
export interface ProviderFailurePolicy {
  /** Whether this failure kind is real evidence the PROVIDER (not the request) is unhealthy right now. */
  affectsProviderHealth: boolean
  /** What should happen to the provider's DURABLE standing (provider-standing.ts) as a result of this
   *  failure. 'none' here does not mean the failure is ignored -- affectsProviderHealth above still
   *  drives the in-memory, threshold-based circuit breaker; it only means this single occurrence isn't
   *  definitive enough on its own to durably persist across a cold start. */
  standing: 'none' | 'cooldown' | 'blocked'
  /** Whether the underlying condition can plausibly resolve on its own (a later attempt might succeed). */
  retryable: boolean
  /** Retry the SAME provider once, after compacting the request, instead of moving to the next candidate. */
  retrySameProviderAfterCompaction: boolean
}
export const PROVIDER_FAILURE_POLICY: Readonly<Record<ProviderErrorKind, ProviderFailurePolicy>> = {
  AUTHENTICATION: { affectsProviderHealth: false, standing: 'blocked', retryable: false, retrySameProviderAfterCompaction: false },
  AUTHORIZATION: { affectsProviderHealth: false, standing: 'blocked', retryable: false, retrySameProviderAfterCompaction: false },
  BILLING: { affectsProviderHealth: false, standing: 'blocked', retryable: false, retrySameProviderAfterCompaction: false },
  RATE_LIMIT: { affectsProviderHealth: false, standing: 'cooldown', retryable: true, retrySameProviderAfterCompaction: false },
  MODEL_UNAVAILABLE: { affectsProviderHealth: false, standing: 'none', retryable: true, retrySameProviderAfterCompaction: false },
  MODEL_NOT_GOVERNED: { affectsProviderHealth: false, standing: 'none', retryable: true, retrySameProviderAfterCompaction: false },
  REQUEST_TOO_LARGE: { affectsProviderHealth: false, standing: 'none', retryable: true, retrySameProviderAfterCompaction: true },
  INVALID_REQUEST: { affectsProviderHealth: false, standing: 'none', retryable: false, retrySameProviderAfterCompaction: false },
  CATALOG_UNAVAILABLE: { affectsProviderHealth: true, standing: 'none', retryable: true, retrySameProviderAfterCompaction: false },
  TIMEOUT: { affectsProviderHealth: true, standing: 'none', retryable: true, retrySameProviderAfterCompaction: false },
  NETWORK: { affectsProviderHealth: true, standing: 'none', retryable: true, retrySameProviderAfterCompaction: false },
  UPSTREAM: { affectsProviderHealth: true, standing: 'none', retryable: true, retrySameProviderAfterCompaction: false },
  UNKNOWN: { affectsProviderHealth: true, standing: 'none', retryable: true, retrySameProviderAfterCompaction: false },
}
export function getProviderFailurePolicy(kind: ProviderErrorKind): ProviderFailurePolicy { return PROVIDER_FAILURE_POLICY[kind] }

export class ProviderControlPlaneError extends Error {
  readonly provider: ActiveProviderId
  readonly kind: ProviderErrorKind
  readonly status?: number
  readonly retryable: boolean
  constructor(shape: { provider: ActiveProviderId; kind: ProviderErrorKind; status?: number; message: string; retryable: boolean }) {
    super(shape.message); this.name = 'ProviderControlPlaneError'; this.provider = shape.provider; this.kind = shape.kind; this.status = shape.status; this.retryable = shape.retryable
  }
}

export type ModelCapability = 'reasoning' | 'coding' | 'research' | 'analysis' | 'creative' | 'tool-use' | 'long-context' | 'speed' | 'vision' | 'conversational'
export interface GovernedModelProfile { provider: ActiveProviderId; model: string; capabilities: readonly ModelCapability[]; quality: number; speed: number; costTier: 1 | 2 | 3; maxOutputTokens: number }
export interface ProviderRuntimeConfig { id: ActiveProviderId; label: string; baseUrl: string; apiKeyEnv: string; modelEnv: string; defaultModel: string; modelsUrl?: string; accountIdEnv?: string; preferredModels: readonly string[]; catalogMode: 'live-api' | 'execution-validated'; emergency?: boolean }

export const PROVIDER_RUNTIME_CONFIG: Readonly<Record<ActiveProviderId, ProviderRuntimeConfig>> = {
  groq: { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1/chat/completions', apiKeyEnv: 'GROQ_API_KEY', modelEnv: 'GROQ_MODEL', defaultModel: 'llama-3.3-70b-versatile', modelsUrl: 'https://api.groq.com/openai/v1/models', preferredModels: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'llama-3.1-8b-instant'], catalogMode: 'live-api' },
  cloudflare: { id: 'cloudflare', label: 'Cloudflare Workers AI', baseUrl: 'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1/chat/completions', apiKeyEnv: 'CLOUDFLARE_API_KEY', modelEnv: 'CLOUDFLARE_MODEL', defaultModel: '@cf/google/gemma-4-26b-a4b-it', modelsUrl: 'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/models/search', accountIdEnv: 'CLOUDFLARE_ACCOUNT_ID', preferredModels: ['@cf/google/gemma-4-26b-a4b-it'], catalogMode: 'live-api' },
  mistral: { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1/chat/completions', apiKeyEnv: 'MISTRAL_API_KEY', modelEnv: 'MISTRAL_MODEL', defaultModel: 'mistral-large-latest', modelsUrl: 'https://api.mistral.ai/v1/models', preferredModels: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest'], catalogMode: 'live-api' },
  cerebras: { id: 'cerebras', label: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1/chat/completions', apiKeyEnv: 'CEREBRAS_API_KEY', modelEnv: 'CEREBRAS_MODEL', defaultModel: 'gpt-oss-120b', modelsUrl: 'https://api.cerebras.ai/v1/models', preferredModels: ['gpt-oss-120b', 'llama-3.3-70b'], catalogMode: 'live-api' },
  openrouter: { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1/chat/completions', apiKeyEnv: 'OPENROUTER_API_KEY', modelEnv: 'OPENROUTER_MODEL', defaultModel: 'anthropic/claude-sonnet-5', preferredModels: ['anthropic/claude-sonnet-5', 'openrouter/free'], catalogMode: 'execution-validated' },
}

export const GOVERNED_MODEL_PROFILES: readonly GovernedModelProfile[] = [
  { provider: 'groq', model: 'llama-3.3-70b-versatile', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'tool-use', 'speed'], quality: 86, speed: 96, costTier: 1, maxOutputTokens: 8000 },
  { provider: 'groq', model: 'openai/gpt-oss-120b', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'tool-use', 'speed', 'conversational'], quality: 89, speed: 92, costTier: 1, maxOutputTokens: 8000 },
  { provider: 'cloudflare', model: '@cf/google/gemma-4-26b-a4b-it', capabilities: ['reasoning', 'analysis', 'tool-use', 'coding', 'research', 'long-context', 'vision', 'conversational'], quality: 94, speed: 90, costTier: 1, maxOutputTokens: 12000 },
  { provider: 'mistral', model: 'mistral-large-latest', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'creative', 'tool-use', 'long-context', 'conversational'], quality: 91, speed: 80, costTier: 2, maxOutputTokens: 12000 },
  { provider: 'mistral', model: 'mistral-medium-latest', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'creative', 'tool-use', 'speed'], quality: 88, speed: 84, costTier: 2, maxOutputTokens: 12000 },
  { provider: 'mistral', model: 'mistral-small-latest', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'creative', 'tool-use', 'speed'], quality: 84, speed: 92, costTier: 1, maxOutputTokens: 8000 },
  { provider: 'cerebras', model: 'gpt-oss-120b', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'tool-use', 'speed', 'conversational'], quality: 89, speed: 99, costTier: 1, maxOutputTokens: 16000 },
  { provider: 'cerebras', model: 'llama-3.3-70b', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'tool-use', 'speed'], quality: 86, speed: 99, costTier: 1, maxOutputTokens: 12000 },
  // OpenRouter passes requests straight through to the upstream provider in the same OpenAI-compatible
  // chat/completions shape every other governed provider already uses here, so routing OpenRouter's
  // governed default at Claude Sonnet 5 needed no request/response adapter -- only this profile plus the
  // runtime-config default above. quality/costTier are set clearly above every other governed profile so
  // this wins governed-candidate sorting for any task whose capability requirements it satisfies.
  { provider: 'openrouter', model: 'anthropic/claude-sonnet-5', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'creative', 'tool-use', 'long-context', 'conversational'], quality: 98, speed: 75, costTier: 3, maxOutputTokens: 16000 },
  { provider: 'openrouter', model: 'openrouter/free', capabilities: ['reasoning', 'coding', 'research', 'analysis', 'creative', 'tool-use', 'long-context'], quality: 75, speed: 70, costTier: 1, maxOutputTokens: 8000 },
]

export const TASK_CAPABILITIES: Readonly<Record<TaskType, readonly ModelCapability[]>> = {
  general: ['reasoning', 'tool-use'], research: ['research', 'long-context'], reasoning: ['reasoning', 'analysis'], coding: ['coding', 'tool-use', 'reasoning'], creative: ['creative', 'reasoning'], financial: ['analysis', 'reasoning', 'long-context'], security: ['reasoning', 'coding', 'analysis'], operations: ['analysis', 'tool-use', 'speed'], analysis: ['analysis', 'reasoning'],
}
export const PROVIDER_ORDER: readonly ActiveProviderId[] = ['groq', 'cloudflare', 'mistral', 'cerebras', 'openrouter']

// Provider Gateway Phase A (2026-09-19): a conservative, shared preflight budget, not a verified
// per-vendor limit -- this codebase doesn't have confirmed exact per-provider/per-tier token ceilings,
// and inventing precise-looking numbers per provider would be presenting a guess as fact. This exists
// only to make an oversized request compact BEFORE spending a round-trip on a call likely to come back
// REQUEST_TOO_LARGE; the reactive compact-and-retry-same-provider-once path in provider-runtime-v2.ts
// (triggered by the real classified error) is the authoritative correctness mechanism regardless of
// whether this preflight guess was right.
//
// Long-document incident (2026-09-19), Phase 1: raised from 6,000. The previous value was far below what
// this codebase's actual governed models support -- PROVIDER_RUNTIME_CONFIG's real default models (Groq
// llama-3.3-70b-versatile, Mistral mistral-large-latest, Cerebras gpt-oss-120b/llama-3.3-70b) are all
// well-documented ~128K-token-context model families, not the handful-of-thousand-token ceiling this
// budget previously assumed. 100,000 leaves real headroom under that ~128K ceiling for the largest
// governed maxOutputTokens (16,000, on the openrouter/anthropic profile) plus this preflight estimate's
// own chars/4 imprecision. This is still a conservative, shared guess, not a per-vendor verified limit --
// Cloudflare Workers AI's specific governed model in particular has no confirmed context window here --
// so the reactive compact-and-retry-on-REQUEST_TOO_LARGE path above remains the real safety net for any
// provider where this guess is still too high, exactly as it already is when this guess is too low.
export const DEFAULT_MAX_INPUT_TOKENS = 100_000
// Rough, standard chars-per-token heuristic (~4 chars/token for English prose) -- good enough to decide
// "is this request plausibly oversized," not a real tokenizer.
export function estimateTokens(text: string): number { return Math.ceil(text.length / 4) }
export function estimateRequestTokens(messages: readonly Record<string, unknown>[]): number {
  let total = 0
  for (const message of messages) { const content = message.content; if (typeof content === 'string') total += estimateTokens(content); else if (Array.isArray(content)) for (const part of content) if (typeof (part as any)?.text === 'string') total += estimateTokens((part as any).text) }
  return total
}

// Provider Gateway Phase A (2026-09-19): the recovery half of REQUEST_TOO_LARGE. Truncates the largest
// message content(s) -- almost always a long tool result, evidence dump, or conversation history entry,
// not the system prompt or the user's actual current turn -- down toward a target token budget, keeping
// every message's role and position (never drops a message outright: some providers require strict
// role alternation, and silently dropping a message could change what the model believes happened).
// Head+tail preserved with a clear truncation marker in between, so the model can see both the start and
// end of what was cut rather than losing context asymmetrically.
//
// Deep-audit fix (2026-09-20): the comment above already claimed the current turn was protected, but
// the original sort order (system last, everything else by size) didn't actually guarantee that -- a
// genuinely long pasted document IS the current turn's own message, and it is very often also the
// single largest message in the array, so it was the first thing compacted, exactly the case this
// whole incident was about. currentTurnIndex (the same "last message with role 'user'" convention
// already used by ceo-cognitive-lifecycle.ts/adaptive-execution.ts/ceo-pre-router.ts to find "the
// turn") now sorts into its own middle tier: ordinary history/evidence messages are still compacted
// first (largest first, as before), the current turn is only touched once those are exhausted, and the
// system message remains the last resort. The current turn can still be compacted -- this is a
// priority order, not an exemption -- so a request that's oversized even after every OTHER message is
// fully trimmed still shrinks enough to actually fit, rather than being left to fail at the provider.
export function compactMessagesForRequestSize(messages: readonly Record<string, unknown>[], targetTokens = DEFAULT_MAX_INPUT_TOKENS): Record<string, unknown>[] {
  const result = messages.map((message) => ({ ...message }))
  const currentTurnIndex = (() => { for (let index = result.length - 1; index >= 0; index -= 1) if (result[index]?.role === 'user') return index; return -1 })()
  const sizes = result.map((message, index) => ({ index, tokens: typeof message.content === 'string' ? estimateTokens(message.content) : 0, isSystem: message.role === 'system', isCurrentTurn: index === currentTurnIndex }))
  let total = sizes.reduce((sum, entry) => sum + entry.tokens, 0)
  if (total <= targetTokens) return result
  // Compact ordinary non-system, non-current-turn messages first (evidence/history is the usual bulk);
  // the current turn's own message is only reached once those are exhausted, and the system message
  // remains the true last resort.
  const tier = (entry: { isSystem: boolean; isCurrentTurn: boolean }) => entry.isSystem ? 2 : entry.isCurrentTurn ? 1 : 0
  const order = [...sizes].sort((a, b) => (tier(a) - tier(b)) || (b.tokens - a.tokens))
  for (const entry of order) {
    // entry.tokens === 0 means non-string content (an array-part message, e.g. multimodal) that this
    // function doesn't know how to safely truncate -- never touch it. Anything else stays a candidate:
    // a floor here (this used to skip anything under ~200 tokens) silently gave up on requests made of
    // MANY small messages that individually never crossed that floor but cumulatively still exceeded
    // budget -- the targetCharsForThisMessage check below already skips a message compaction wouldn't
    // actually shrink, so no separate size floor is needed to stay safe.
    if (total <= targetTokens || entry.tokens === 0) continue
    const content = String(result[entry.index]!.content ?? '')
    const overage = total - targetTokens
    const targetCharsForThisMessage = Math.max(400, content.length - overage * 4)
    if (targetCharsForThisMessage >= content.length) continue
    const headLength = Math.ceil(targetCharsForThisMessage * 0.6)
    const tailLength = Math.floor(targetCharsForThisMessage * 0.4)
    const truncated = `${content.slice(0, headLength)}\n\n...[truncated ${content.length - headLength - tailLength} chars to fit the provider's request-size limit]...\n\n${content.slice(content.length - tailLength)}`
    result[entry.index]!.content = truncated
    total = total - entry.tokens + estimateTokens(truncated)
  }
  return result
}

export function isProviderConfigured(provider: ActiveProviderId): boolean {
  const config = PROVIDER_RUNTIME_CONFIG[provider]
  return Boolean(process.env[config.apiKeyEnv]?.trim()) && (!config.accountIdEnv || Boolean(process.env[config.accountIdEnv]?.trim()))
}
export function getConfiguredProviders(): ActiveProviderId[] { return PROVIDER_ORDER.filter(isProviderConfigured) }

// Deep-audit finding (2026-09-19): the minimum profile.quality a "strict" request (dual-review
// verification, or a financial/security task) is willing to accept. getGovernedCandidates only
// used this as a soft ranking nudge -- it never stopped a caller-requested model that falls below
// it from being honored, so an explicit model override could silently satisfy a dual-review
// request with e.g. openrouter/free (quality 75). Shared here so resolveGovernedModel can enforce
// the same bar as a hard gate on explicit requests, not just a preference among auto-selected ones.
const STRICT_QUALITY_FLOOR = 90
function isStrictVerification(taskType: TaskType, verification?: VerificationTier): boolean {
  return verification === 'dual-review' || taskType === 'financial' || taskType === 'security'
}
export function getGovernedCandidates(provider: ActiveProviderId, taskType: TaskType, verification?: VerificationTier): string[] {
  const required = TASK_CAPABILITIES[taskType]
  const strict = isStrictVerification(taskType, verification)
  const preferConversational = taskType === 'reasoning'
  return GOVERNED_MODEL_PROFILES.filter((profile) => profile.provider === provider && required.every((capability) => profile.capabilities.includes(capability)))
    .sort((a, b) => {
      const score = (x: GovernedModelProfile) => x.quality * 0.55 + x.speed * 0.2 + (x.costTier === 1 ? 10 : x.costTier === 2 ? 5 : 0) + (strict && x.quality >= STRICT_QUALITY_FLOOR ? 5 : 0) + (preferConversational && x.capabilities.includes('conversational') ? 6 : 0)
      return score(b) - score(a)
    }).map((profile) => profile.model)
}
export function getModelForProviderGoverned(provider: ActiveProviderId, taskType: TaskType, verification?: VerificationTier): string | undefined { return getGovernedCandidates(provider, taskType, verification)[0] }

export function classifyProviderError(provider: ActiveProviderId, status?: number, message = '') {
  const lower = message.toLowerCase()
  if (status === 401) return { provider, kind: 'AUTHENTICATION' as const, status, message, retryable: false }
  if (status === 403) return { provider, kind: 'AUTHORIZATION' as const, status, message, retryable: false }
  // Provider Gateway Phase A (2026-09-19): HTTP 413 must be checked, and classified, BEFORE the billing
  // text-match below -- a real production incident showed Groq's 413 body (request too large for the
  // model's per-call token ceiling; Groq itself bundles size-driven throttling under rate-limit-flavored
  // wording) matching this function's billing regex on message text alone, misclassifying a pure
  // request-size problem as BILLING. That wrongly told the caller the PROVIDER's account was the issue
  // (see PROVIDER_FAILURE_POLICY above) when the provider itself was perfectly healthy -- only this one
  // oversized request was not. Checking status===413 first, unconditionally, means a 413 can never reach
  // the message-text regex at all, regardless of what Groq's (or any provider's) error body happens to say.
  if (status === 413) return { provider, kind: 'REQUEST_TOO_LARGE' as const, status, message, retryable: true }
  // "quota exceeded" is deliberately NOT in the billing regex below: real rate-limiters (requests-per-
  // minute/day quotas) use that exact phrase at least as often as billing systems do, and don't always
  // set HTTP 429. BILLING's consequence is a 24h durable block (PROVIDER_FAILURE_POLICY, never retried);
  // RATE_LIMIT's is a 60s cooldown. Misreading a transient quota as a billing failure is far more
  // damaging than the reverse, so the ambiguous phrase is classified as RATE_LIMIT, the cheaper mistake.
  if (status === 402 || /billing|payment|credit|insufficient.{0,20}(credit|fund|balance)/.test(lower)) return { provider, kind: 'BILLING' as const, status, message, retryable: false }
  if (/request.{0,20}(too large|entity too large)|payload too large|context.{0,20}length|too many tokens|maximum context length/.test(lower)) return { provider, kind: 'REQUEST_TOO_LARGE' as const, status, message, retryable: true }
  if (status === 429 || /rate.?limit|too many requests|quota exceeded/.test(lower)) return { provider, kind: 'RATE_LIMIT' as const, status, message, retryable: true }
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
  // Deep-audit finding: an explicit requestedModel used to skip quality-tier enforcement entirely
  // (most sharply for OpenRouter, the one provider where a requested model bypasses live-catalog
  // validation below and gets returned unconditionally) -- a dual-review/financial/security
  // request naming e.g. openrouter/free (quality 75) was honored with no signal that it fell short
  // of the quality>=90 bar auto-selection already enforces as a soft preference. This provider is
  // simply unable to serve the request at the quality this call requires; the caller must omit the
  // override (letting auto-selection pick a compliant model, here or on another provider) or accept
  // this is not actually a strict request.
  if (requestedModel && isStrictVerification(taskType, verification)) {
    const profile = GOVERNED_MODEL_PROFILES.find((candidate) => candidate.provider === provider && candidate.model === requestedModel)
    if (!profile || profile.quality < STRICT_QUALITY_FLOOR) throw new ProviderControlPlaneError({ provider, kind: 'MODEL_NOT_GOVERNED', message: `${PROVIDER_RUNTIME_CONFIG[provider].label}: requested model ${requestedModel} does not meet the quality bar this ${verification ?? taskType} request requires`, retryable: false })
  }
  const catalog = await resolveLiveCatalog(provider, fetchImpl)
  if (provider === 'openrouter') return requestedModel ?? governed[0]
  const selected = requestedModel && catalog.modelIds.includes(requestedModel) ? requestedModel : governed.find((model) => catalog.modelIds.includes(model))
  if (!selected) throw new ProviderControlPlaneError({ provider, kind: 'MODEL_NOT_GOVERNED', message: `${PROVIDER_RUNTIME_CONFIG[provider].label}: no governed model is currently available in the live provider catalog`, retryable: false })
  return selected
}

export function clearProviderCatalogCache(provider?: ActiveProviderId): void { if (provider) catalogCache.delete(provider); else catalogCache.clear() }
export function getProviderCatalogSnapshot(): Record<ActiveProviderId, { cached: boolean; ageMs: number | null }> {
  return Object.fromEntries(PROVIDER_ORDER.map((provider) => { const cached = catalogCache.get(provider); return [provider, { cached: Boolean(cached), ageMs: cached ? Date.now() - cached.fetchedAt : null }] })) as Record<ActiveProviderId, { cached: boolean; ageMs: number | null }>
}
