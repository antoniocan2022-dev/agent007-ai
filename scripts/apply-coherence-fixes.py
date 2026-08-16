from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding='utf-8')


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected exactly 1 occurrence, found {count}: {old[:120]!r}')
    write(path, text.replace(old, new))


def replace_regex_once(path: str, pattern: str, new: str, flags=re.S) -> None:
    text = read(path)
    out, count = re.subn(pattern, new, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f'{path}: regex replacement count={count}: {pattern[:160]!r}')
    write(path, out)


# ---------------------------------------------------------------------------
# 1. Provider Intelligence 2.0 — one authoritative provider universe.
# ---------------------------------------------------------------------------
replace_once(
    'src/lib/subagent-governance.ts',
    "export type ProviderId = 'groq' | 'openai' | 'zai' | 'mistral'",
    "export type ProviderId = 'groq' | 'openai' | 'zai' | 'mistral' | 'openrouter' | 'gemini' | 'brave' | 'cerebras'",
)

replace_once(
    'src/lib/provider-intelligence-policy.ts',
    "export const PROVIDER_PRIORITY: readonly ProviderId[] = ['groq', 'openai', 'zai', 'mistral'] as const",
    """export const CORE_PROVIDER_PRIORITY: readonly ProviderId[] = ['groq', 'openai', 'zai', 'mistral'] as const
export const SECONDARY_PROVIDER_PRIORITY: readonly ProviderId[] = ['openrouter', 'gemini', 'brave', 'cerebras'] as const
export const PROVIDER_PRIORITY: readonly ProviderId[] = [...CORE_PROVIDER_PRIORITY, ...SECONDARY_PROVIDER_PRIORITY] as const

/** Provider Intelligence 2.0 treats all configured providers as eligible.
 * The first four are the default deterministic failover chain; the secondary
 * four are additional governed capabilities and may be selected or queried in
 * parallel when task policy, evidence, or the CEO/VID layer calls for them.
 */
export const PROVIDER_PARALLEL_LIMIT = 4

export function getProviderCandidates(preferred: readonly ProviderId[] = PROVIDER_PRIORITY): ProviderId[] {
  const configured = new Set(availableProviderIds())
  return preferred.filter((provider) => configured.has(provider))
}

export function availableProviderIds(): ProviderId[] {
  const envByProvider: Record<ProviderId, string> = {
    groq: 'GROQ_API_KEY', openai: 'OPENAI_API_KEY', zai: 'ZAI_API_KEY', mistral: 'MISTRAL_API_KEY',
    openrouter: 'OPENROUTER_API_KEY', gemini: 'GEMINI_API_KEY', brave: 'BRAVE_API_KEY', cerebras: 'CEREBRAS_API_KEY',
  }
  return PROVIDER_PRIORITY.filter((provider) => Boolean(process.env[envByProvider[provider]]))
}""",
)
replace_once(
    'src/lib/provider-intelligence-policy.ts',
    "if (order.length !== PROVIDER_PRIORITY.length) errors.push(`Provider priority must contain ${PROVIDER_PRIORITY.length} providers`)",
    "if (order.length !== PROVIDER_PRIORITY.length) errors.push(`Provider priority must contain ${PROVIDER_PRIORITY.length} providers`)",
)

# Replace the v2 runtime with a complete OpenAI-compatible governed gateway.
write('src/lib/provider-runtime-v2.ts', r'''import { getProviderTaskPolicy, rankAvailableProviders, PROVIDER_PARALLEL_LIMIT, type ProviderTaskPolicy } from './provider-intelligence-policy'
import { isCircuitOpen, recordFailure, recordSuccess } from './provider-intelligence'
import { getModelForProvider } from './model-intelligence'
import { recordModelPerformance } from './performance-intelligence'
import { recordModelOutcome, type OutcomeStatus } from './outcome-intelligence'
import type { ProviderId, TaskType, VerificationTier } from './subagent-governance'

export interface ProviderRuntimeConfig {
  id: ProviderId
  label: string
  baseUrl: string
  apiKeyEnv: string
  modelEnv: string
  defaultModel: string
  capabilityTags: readonly string[]
  canParallel: boolean
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
  outcomeEvidence?: ProviderRuntimeOutcomeEvidence
}

export interface ProviderRuntimeResult {
  provider: ProviderId
  model: string
  content: string
  attempts: ProviderId[]
  responseMs: number
}

export interface ProviderParallelResult {
  taskType: TaskType
  selectedProviders: ProviderId[]
  successful: ProviderRuntimeResult[]
  failed: Array<{ provider: ProviderId; error: string }>
  elapsedMs: number
}

export const PROVIDER_RUNTIME_CONFIG: Readonly<Record<ProviderId, ProviderRuntimeConfig>> = {
  groq: { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1/chat/completions', apiKeyEnv: 'GROQ_API_KEY', modelEnv: 'GROQ_MODEL', defaultModel: 'llama-3.3-70b-versatile', capabilityTags: ['fast', 'reasoning', 'general'], canParallel: true },
  openai: { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1/chat/completions', apiKeyEnv: 'OPENAI_API_KEY', modelEnv: 'OPENAI_MODEL', defaultModel: 'gpt-4o', capabilityTags: ['general', 'reasoning', 'coding', 'structured'], canParallel: true },
  zai: { id: 'zai', label: 'Z.ai', baseUrl: 'https://api.z.ai/api/paas/v4/chat/completions', apiKeyEnv: 'ZAI_API_KEY', modelEnv: 'ZAI_MODEL', defaultModel: 'glm-4.6', capabilityTags: ['reasoning', 'analysis', 'long-context'], canParallel: true },
  mistral: { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1/chat/completions', apiKeyEnv: 'MISTRAL_API_KEY', modelEnv: 'MISTRAL_MODEL', defaultModel: 'mistral-large-latest', capabilityTags: ['reasoning', 'analysis', 'coding'], canParallel: true },
  openrouter: { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1/chat/completions', apiKeyEnv: 'OPENROUTER_API_KEY', modelEnv: 'OPENROUTER_MODEL', defaultModel: 'openrouter/free', capabilityTags: ['model-routing', 'breadth', 'long-form'], canParallel: true },
  gemini: { id: 'gemini', label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', apiKeyEnv: 'GEMINI_API_KEY', modelEnv: 'GEMINI_MODEL', defaultModel: 'gemini-3.5-flash', capabilityTags: ['multimodal', 'reasoning', 'long-context'], canParallel: true },
  brave: { id: 'brave', label: 'Brave', baseUrl: 'https://api.search.brave.com/res/v1/chat/completions', apiKeyEnv: 'BRAVE_API_KEY', modelEnv: 'BRAVE_MODEL', defaultModel: 'brave', capabilityTags: ['web-grounded', 'citations', 'research'], canParallel: true },
  cerebras: { id: 'cerebras', label: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1/chat/completions', apiKeyEnv: 'CEREBRAS_API_KEY', modelEnv: 'CEREBRAS_MODEL', defaultModel: 'gpt-oss-120b', capabilityTags: ['very-fast', 'reasoning', 'coding'], canParallel: true },
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]
  return value && value.trim() ? value.trim() : undefined
}

export function getConfiguredProviders(): ProviderId[] {
  return rankAvailableProviders(Object.values(PROVIDER_RUNTIME_CONFIG).filter((config) => !!readEnv(config.apiKeyEnv)).map((config) => config.id))
}

export function getProviderRuntimeConfig(provider: ProviderId): ProviderRuntimeConfig {
  return PROVIDER_RUNTIME_CONFIG[provider]
}

export function inferTaskType(messages: readonly Record<string, unknown>[]): TaskType {
  const text = messages.map((m) => String(m?.content ?? '')).join(' ').toLowerCase()
  if (/security|vulnerability|attack|incident|exploit/.test(text)) return 'security'
  if (/finance|financial|investment|stock|crypto|tax|money|budget/.test(text)) return 'financial'
  if (/code|coding|typescript|javascript|bug|refactor|repository|github/.test(text)) return 'coding'
  if (/research|latest|news|market|competitor|trend|source|citation/.test(text)) return 'research'
  if (/creative|write|blog|article|script|design|name|brand/.test(text)) return 'creative'
  if (/analy[sz]|compare|evaluate|decision|strategy|plan|why/.test(text)) return 'analysis'
  if (/reason|logic|architecture|tradeoff/.test(text)) return 'reasoning'
  if (/operate|deploy|monitor|health|system|production/.test(text)) return 'operations'
  return 'general'
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

  const taskType = request.taskType ?? inferTaskType(request.messages)
  const model = request.model || getModelForProvider(provider, taskType, request.verification) || readEnv(config.modelEnv) || config.defaultModel
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
      stream: false,
    }
    if (provider === 'zai') body.thinking = { type: 'enabled' }
    if (provider === 'brave') body.enable_citations = true

    const response = await fetch(config.baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(provider === 'brave' ? { 'X-Subscription-Token': key } : {}),
        ...(provider === 'openrouter' ? { 'HTTP-Referer': 'https://agent007-ai.vercel.app', 'X-Title': 'Agent007 AI' } : {}),
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
    recordModelPerformance({ provider, model, taskType, success: true, responseMs })
    if (request.outcomeEvidence) recordModelOutcome({ provider, model, taskType, ...request.outcomeEvidence })
    return { provider, model, content, attempts: [provider], responseMs }
  } catch (error) {
    const responseMs = Date.now() - started
    const model = request.model || getModelForProvider(provider, taskType, request.verification) || readEnv(config.modelEnv) || config.defaultModel
    recordFailure(provider)
    recordModelPerformance({ provider, model, taskType, success: false, responseMs })
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export async function runGovernedProviderChat(request: ProviderRuntimeRequest): Promise<ProviderRuntimeResult> {
  const taskType = request.taskType ?? inferTaskType(request.messages)
  const policy: ProviderTaskPolicy = getProviderTaskPolicy(taskType, request.verification)
  const configured = getConfiguredProviders()
  const candidates = rankAvailableProviders(configured).filter((provider) => !isCircuitOpen(provider))
  if (candidates.length === 0) throw new Error(`No governed providers available. Required priority: ${policy.providerOrder.join(' → ')}`)

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
      if (Number.isFinite(status) && !isRetryableStatus(status)) break
    }
  }
  throw new Error(`All governed providers failed (${attempts.join(' → ')}): ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

export function selectProvidersForTask(taskType: TaskType, count = PROVIDER_PARALLEL_LIMIT): ProviderId[] {
  const configured = getConfiguredProviders()
  const tagged = new Map<ProviderId, number>()
  const rules: Array<[RegExp, ProviderId[]]> = [
    [/security|financial/, ['openai', 'zai', 'mistral', 'cerebras']],
    [/research|analysis/, ['brave', 'gemini', 'openai', 'zai']],
    [/coding|reasoning/, ['cerebras', 'groq', 'openai', 'mistral']],
    [/creative/, ['gemini', 'groq', 'openai', 'mistral']],
    [/operations/, ['groq', 'openai', 'cerebras', 'zai']],
  ]
  const text = taskType.toLowerCase()
  const preferred = rules.find(([pattern]) => pattern.test(text))?.[1] ?? ['groq', 'openai', 'zai', 'mistral']
  preferred.forEach((provider, index) => tagged.set(provider, 100 - index * 10))
  configured.forEach((provider, index) => tagged.set(provider, Math.max(tagged.get(provider) ?? 0, 50 - index)))
  return [...configured].sort((a, b) => (tagged.get(b) ?? 0) - (tagged.get(a) ?? 0)).slice(0, Math.max(1, Math.min(count, PROVIDER_PARALLEL_LIMIT)))
}

export async function runGovernedProviderParallel(request: ProviderRuntimeRequest, providers?: ProviderId[]): Promise<ProviderParallelResult> {
  const taskType = request.taskType ?? inferTaskType(request.messages)
  const selectedProviders = (providers?.length ? providers : selectProvidersForTask(taskType)).filter((provider) => getConfiguredProviders().includes(provider)).slice(0, PROVIDER_PARALLEL_LIMIT)
  if (selectedProviders.length < 2) throw new Error('Parallel provider execution requires at least two configured providers')

  const started = Date.now()
  const settled = await Promise.allSettled(selectedProviders.map((provider) => callProvider(provider, { ...request, taskType })))
  const successful: ProviderRuntimeResult[] = []
  const failed: Array<{ provider: ProviderId; error: string }> = []
  settled.forEach((result, index) => {
    const provider = selectedProviders[index]
    if (result.status === 'fulfilled') successful.push(result.value)
    else failed.push({ provider, error: result.reason instanceof Error ? result.reason.message : String(result.reason) })
  })
  return { taskType, selectedProviders, successful, failed, elapsedMs: Date.now() - started }
}
''')

# ---------------------------------------------------------------------------
# 2. Canonical Organizational State — one contract for every layer.
# ---------------------------------------------------------------------------
write('src/lib/canonical-organizational-state.ts', r'''import { TOOL_REGISTRY } from './tools'
import { getAllGovernanceProfiles } from './subagent-governance'
import { PROVIDER_CORE_PRIORITY, PROVIDER_PARALLEL_LIMIT } from './provider-intelligence-policy'
'''.replace('PROVIDER_CORE_PRIORITY', 'CORE_PROVIDER_PRIORITY') + r'''
import { PROVIDER_PRIORITY, SECONDARY_PROVIDER_PRIORITY } from './provider-intelligence-policy'
import { PROVIDER_RUNTIME_CONFIG, getConfiguredProviders } from './provider-runtime-v2'

export const CANONICAL_STATE_VERSION = '2.0.0'
export const CRON_POLICY = Object.freeze({ enabled: false, schedules: [] as readonly string[], reason: 'Production cron execution is disabled until explicit owner authorization.' })
export const RELEASE_POLICY = Object.freeze({ productionDeployment: 'manual-authorization-only' as const, automaticDeployments: false })

export interface CanonicalOrganizationalState {
  stateVersion: string
  generatedAt: string
  organization: { name: string; executive: string; director: string }
  agents: { totalGovernedProfiles: number; ids: string[] }
  tools: { registryCount: number }
  providers: {
    defaultPriority: readonly string[]
    corePriority: readonly string[]
    secondaryPriority: readonly string[]
    configured: string[]
    parallelLimit: number
    runtime: Record<string, { label: string; capabilities: readonly string[]; canParallel: boolean }>
  }
  cronPolicy: typeof CRON_POLICY
  releasePolicy: typeof RELEASE_POLICY
  coherence: { singleSourceOfTruth: true; capabilityAccessModel: 'governed-per-agent' }
}

export function getCanonicalOrganizationalState(): CanonicalOrganizationalState {
  const profiles = getAllGovernanceProfiles()
  const configured = getConfiguredProviders()
  const runtime = Object.fromEntries(
    Object.entries(PROVIDER_RUNTIME_CONFIG).map(([id, config]) => [id, { label: config.label, capabilities: config.capabilityTags, canParallel: config.canParallel }])
  )
  return {
    stateVersion: CANONICAL_STATE_VERSION,
    generatedAt: new Date().toISOString(),
    organization: { name: 'Agent007 AI', executive: 'CEO_AGENT007', director: 'VID Director' },
    agents: { totalGovernedProfiles: profiles.length, ids: profiles.map((profile) => profile.id).sort() },
    tools: { registryCount: Object.keys(TOOL_REGISTRY).length },
    providers: {
      defaultPriority: PROVIDER_PRIORITY,
      corePriority: CORE_PROVIDER_PRIORITY,
      secondaryPriority: SECONDARY_PROVIDER_PRIORITY,
      configured,
      parallelLimit: PROVIDER_PARALLEL_LIMIT,
      runtime,
    },
    cronPolicy: CRON_POLICY,
    releasePolicy: RELEASE_POLICY,
    coherence: { singleSourceOfTruth: true, capabilityAccessModel: 'governed-per-agent' },
  }
}

export function validateCanonicalOrganizationalState(state = getCanonicalOrganizationalState()): string[] {
  const errors: string[] = []
  if (new Set(state.providers.defaultPriority).size !== state.providers.defaultPriority.length) errors.push('Provider priority contains duplicates')
  if (state.providers.defaultPriority.join('|') !== [...CORE_PROVIDER_PRIORITY, ...SECONDARY_PROVIDER_PRIORITY].join('|')) errors.push('Provider priority drift detected')
  if (state.providers.parallelLimit < 2) errors.push('Parallel provider limit must be at least 2')
  if (state.agents.totalGovernedProfiles !== state.agents.ids.length) errors.push('Agent profile count mismatch')
  if (state.cronPolicy.enabled) errors.push('Canonical cron policy is unexpectedly enabled')
  if (state.releasePolicy.automaticDeployments) errors.push('Automatic production deployment is unexpectedly enabled')
  return errors
}
''')

write('src/app/api/system/canonical-state/route.ts', r'''import { NextResponse } from 'next/server'
import { getCanonicalOrganizationalState, validateCanonicalOrganizationalState } from '@/lib/canonical-organizational-state'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const state = getCanonicalOrganizationalState()
  const errors = validateCanonicalOrganizationalState(state)
  return NextResponse.json({ ok: errors.length === 0, state, errors })
}
''')

# ---------------------------------------------------------------------------
# 3. CEO prompt + governed runtime bridge.
# ---------------------------------------------------------------------------
replace_once('src/lib/agent.ts', "import { callFallbackLlm } from '@/lib/llm-fallback'", "import { callFallbackLlm } from '@/lib/llm-fallback'\nimport { runGovernedProviderChat } from './provider-runtime-v2'")
replace_once(
    'src/lib/agent.ts',
    'PARALLEL: <tool name="parallel_executor">{"tools":[...]}</tool>\n\nTEAM: SCOUT|AURORA|ECHO|FORGE|PULSE|QUANTUM|HUNT|QUILL|PRISM|VERTEX|LEGAL|BANKER|TRADER|CYBERSECURITY_A|CYBERSECURITY_R|DEVELOPER|QA_MONITOR|EXTERNAL_UPTIME_MONITOR + 2 custom = 20 total.',
    'PARALLEL: <tool name="parallel_executor">{"tools":[...]}</tool>\nPROVIDER INTELLIGENCE 2.0: You can choose the best-fit LLM provider for each task. Default governed order is Groq → OpenAI → Z.ai → Mistral, with OpenRouter → Gemini → Brave → Cerebras as secondary governed providers. You may use 2 or more providers in parallel when comparison, verification, resilience, multimodal analysis, web-grounding, or independent reasoning benefits the mission. Use <tool name="multi_provider_compare"> for explicit parallel provider comparison and synthesis. Never assume every task needs every provider; select deliberately from capability, risk, evidence, latency, and availability.\n\nTEAM: Governance profiles are authoritative. CEO_AGENT007 directs the organization; VID Director coordinates venture intelligence; every governed subagent has the same Provider Intelligence 2.0 capability contract and may select or parallelize providers within its task/risk policy.',
)
replace_once('src/lib/agent.ts', '): Promise<any> {\n  let lastErr: any = null', r'''): Promise<any> {
  // Provider Intelligence 2.0 is the primary governed path. The legacy chain
  // remains only as a compatibility fallback when an explicit provider override
  // is requested by a legacy caller or the governed gateway itself fails.
  if (!process.env.LLM_PROVIDER_ORDER) {
    try {
      const governed = await runGovernedProviderChat({ messages })
      return { choices: [{ message: { content: governed.content, provider: governed.provider, model: governed.model } }], _provider: governed.provider, _model: governed.model, _attempts: governed.attempts }
    } catch (governedError) {
      console.warn(`[Provider Intelligence 2.0] governed path failed; using compatibility router: ${governedError instanceof Error ? governedError.message.slice(0, 160) : String(governedError)}`)
    }
  }

  let lastErr: any = null''')

# ---------------------------------------------------------------------------
# 4. Parallel comparison tool becomes a first-class governed capability.
# ---------------------------------------------------------------------------
write('src/lib/multi-provider-comparison.ts', r'''import type { ToolResult } from './tools'
import { runGovernedProviderParallel, selectProvidersForTask } from './provider-runtime-v2'
import type { ProviderId, TaskType } from './subagent-governance'

export async function toolMultiProviderCompare(args: any): Promise<ToolResult> {
  const { prompt, providers, systemPrompt, taskType } = args ?? {}
  if (!prompt) return { ok: false, preview: 'multi_provider_compare requires "prompt"', result: 'Error: prompt is required.' }

  const messages: Array<{ role: 'system' | 'user'; content: string }> = []
  if (systemPrompt) messages.push({ role: 'system', content: String(systemPrompt) })
  messages.push({ role: 'user', content: String(prompt) })

  const selected = Array.isArray(providers) && providers.length > 1
    ? providers.map((value: string) => value.toLowerCase() as ProviderId)
    : selectProvidersForTask((taskType as TaskType) || 'general')

  if (selected.length < 2) {
    return { ok: false, preview: 'Parallel comparison requires at least two configured providers', result: 'Provider Intelligence 2.0 could not find two configured providers for this task.' }
  }

  const report = await runGovernedProviderParallel({ messages, taskType: taskType as TaskType | undefined }, selected)
  const lines: string[] = [
    'MULTI-PROVIDER INTELLIGENCE 2.0 REPORT',
    '='.repeat(60),
    `Task type: ${report.taskType}`,
    `Providers queried in parallel: ${report.selectedProviders.join(', ')}`,
    `Succeeded: ${report.successful.length} | Failed: ${report.failed.length}`,
    `Elapsed: ${report.elapsedMs}ms`,
    '',
  ]
  for (const result of report.successful) {
    lines.push(`--- ${result.provider.toUpperCase()} (${result.model}) ${result.responseMs}ms ---`)
    lines.push(result.content.slice(0, 4000))
    lines.push('')
  }
  for (const failure of report.failed) lines.push(`--- ${failure.provider.toUpperCase()} FAILED ---`, failure.error, '')
  lines.push('SYNTHESIS INSTRUCTION: compare consensus, disagreements, evidence quality, and task fit before producing the executive conclusion.')

  return { ok: report.successful.length > 0, preview: `Provider Intelligence 2.0: ${report.successful.length}/${report.selectedProviders.length} parallel providers succeeded`, result: lines.join('\n') }
}

export function selectBestProvider(taskDescription: string): string[] {
  const lower = taskDescription.toLowerCase()
  if (/security|financial|risk|tax/.test(lower)) return selectProvidersForTask('financial')
  if (/search|trend|news|latest|research|citation/.test(lower)) return selectProvidersForTask('research')
  if (/code|coding|bug|repository|github/.test(lower)) return selectProvidersForTask('coding')
  if (/creative|blog|article|script|visual|image/.test(lower)) return selectProvidersForTask('creative')
  if (/fast|quick|real.?time/.test(lower)) return selectProvidersForTask('operations')
  return selectProvidersForTask('analysis')
}
''')

# ---------------------------------------------------------------------------
# 5. Diagnostics + full audit + capabilities + VID all expose canonical state.
# ---------------------------------------------------------------------------
replace_once('src/app/api/health/diagnostics/route.ts', "import { NextResponse } from 'next/server'", "import { NextResponse } from 'next/server'\nimport { getCanonicalOrganizationalState, validateCanonicalOrganizationalState } from '@/lib/canonical-organizational-state'")
replace_once('src/app/api/health/diagnostics/route.ts', "  const uptime = Math.round(process.uptime())", "  const uptime = Math.round(process.uptime())\n  const canonicalState = getCanonicalOrganizationalState()\n  const canonicalErrors = validateCanonicalOrganizationalState(canonicalState)")
replace_once('src/app/api/health/diagnostics/route.ts', "    morning_brief_cron: true,", "    morning_brief_cron: canonicalState.cronPolicy.enabled,")
replace_regex_once('src/app/api/health/diagnostics/route.ts', r"cronsConfigured: 4,\n\s*cronSchedules: \[[\s\S]*?\n\s*\],", "cronsConfigured: canonicalState.cronPolicy.schedules.length,\n      cronSchedules: canonicalState.cronPolicy.schedules,")
replace_once('src/app/api/health/diagnostics/route.ts', "      missionPipelineStatus,", "      missionPipelineStatus,\n      canonicalState,\n      canonicalCoherenceErrors: canonicalErrors,")

replace_once('src/app/api/health/full-audit/route.ts', "import { NextRequest, NextResponse } from 'next/server'", "import { NextRequest, NextResponse } from 'next/server'\nimport { getCanonicalOrganizationalState, validateCanonicalOrganizationalState } from '@/lib/canonical-organizational-state'")
replace_regex_once('src/app/api/health/full-audit/route.ts', r"function mask\(key: string \| undefined\): string \{[\s\S]*?\n\}", "function mask(key: string | undefined): string {\n  return key ? `(configured, len=${key.length})` : '(not set)'\n}")
replace_regex_once('src/app/api/health/full-audit/route.ts', r"const llmProviders = \[[\s\S]*?\n  \]", "const canonical = getCanonicalOrganizationalState()\n  const canonicalErrors = validateCanonicalOrganizationalState(canonical)\n  const llmProviders = [\n    { id: 'groq', env: 'GROQ_API_KEY' },\n    { id: 'openai', env: 'OPENAI_API_KEY' },\n    { id: 'z-ai', env: 'ZAI_API_KEY' },\n    { id: 'mistral', env: 'MISTRAL_API_KEY' },\n    { id: 'openrouter', env: 'OPENROUTER_API_KEY' },\n    { id: 'gemini', env: 'GEMINI_API_KEY' },\n    { id: 'brave', env: 'BRAVE_API_KEY' },\n    { id: 'cerebras', env: 'CEREBRAS_API_KEY' },\n  ]")
replace_once('src/app/api/health/full-audit/route.ts', "`${activeLlmCount}/7 LLM providers configured. Chain: OpenAI → Mistral → Groq → OpenRouter → Brave → Gemini → z.ai`", "`${activeLlmCount}/${canonical.providers.defaultPriority.length} LLM providers configured. Chain: ${canonical.providers.defaultPriority.join(' → ')}`")
replace_once('src/app/api/health/full-audit/route.ts', "  const checks: Check[] = []", "  const checks: Check[] = []\n  checks.push({ id: 'canonical-state', name: 'Canonical organizational state', category: 'build', status: canonicalErrors.length === 0 ? 'pass' : 'fail', detail: canonicalErrors.length === 0 ? `State ${canonical.stateVersion} coherent` : canonicalErrors.join('; ') })")
replace_once('src/app/api/health/full-audit/route.ts', "      payments: checks.filter(c => c.category === 'payments').length ? {", "      payments: checks.filter(c => c.category === 'payments').length ? {")

replace_once('src/app/api/system/capabilities/route.ts', "import { SUBAGENTS, FULL_ACCESS_TOOLS } from '@/lib/subagents'", "import { SUBAGENTS, FULL_ACCESS_TOOLS } from '@/lib/subagents'\nimport { getCanonicalOrganizationalState } from '@/lib/canonical-organizational-state'")
replace_once('src/app/api/system/capabilities/route.ts', "    const caps = await getCapabilities()", "    const caps = await getCapabilities()\n    const canonicalState = getCanonicalOrganizationalState()")
replace_once('src/app/api/system/capabilities/route.ts', "        allHaveFullAccess: caps.agents.allHaveFullAccess,", "        allHaveFullAccess: false,\n        accessModel: canonicalState.coherence.capabilityAccessModel,")
replace_once('src/app/api/system/capabilities/route.ts', "      mission: caps.mission,", "      mission: caps.mission,\n      providerIntelligence: canonicalState.providers,")
replace_once('src/app/api/system/capabilities/route.ts', "      summary: {", "      canonicalState,\n      summary: {")

replace_once('src/app/api/system/vid-kpis/route.ts', "import { getPortfolio, getActiveBusinesses, computeEnterpriseValue } from '@/lib/business-portfolio'", "import { getPortfolio, getActiveBusinesses, computeEnterpriseValue } from '@/lib/business-portfolio'\nimport { getCanonicalOrganizationalState } from '@/lib/canonical-organizational-state'")
replace_once('src/app/api/system/vid-kpis/route.ts', "    const [allBusinesses, activeBusinesses, enterpriseValue] = await Promise.all([", "    const canonicalState = getCanonicalOrganizationalState()\n    const [allBusinesses, activeBusinesses, enterpriseValue] = await Promise.all([")
replace_once('src/app/api/system/vid-kpis/route.ts', "      ventures,\n      generatedAt: new Date().toISOString(),", "      ventures,\n      organizationState: canonicalState,\n      generatedAt: new Date().toISOString(),")

# ---------------------------------------------------------------------------
# 6. Make the deployment policy explicit: no automatic Vercel deployment.
# ---------------------------------------------------------------------------
replace_once('vercel.json', '  "git": {\n    "deploymentEnabled": false\n  },', '  "git": {\n    "deploymentEnabled": false\n  },\n  "crons": [],')

# ---------------------------------------------------------------------------
# 7. Remove known dead legacy files if they reappear.
# ---------------------------------------------------------------------------
for dead in [
    'src/lib/safety-reliability.ts',
    'src/lib/improvement-actions.ts',
    'src/lib/advanced-tools.ts',
    'src/lib/intelligence-tools.ts',
    'src/app/login/page.tsx.bak',
    'prisma/schema.prisma.bak',
]:
    p = ROOT / dead
    if p.exists():
        p.unlink()

print('Coherence repair transformations applied successfully.')
''')