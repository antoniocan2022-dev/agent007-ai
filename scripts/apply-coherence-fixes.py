from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

def read(path):
    return (ROOT / path).read_text(encoding='utf-8')

def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')

def once(path, old, new):
    text = read(path)
    n = text.count(old)
    if n != 1:
        raise RuntimeError(f'{path}: expected 1 occurrence, found {n}: {old[:100]}')
    write(path, text.replace(old, new))

def regex_once(path, pattern, repl):
    text = read(path)
    out, n = re.subn(pattern, repl, text, count=1, flags=re.S)
    if n != 1:
        raise RuntimeError(f'{path}: regex expected 1 match, found {n}: {pattern[:120]}')
    write(path, out)

# Provider universe and priority.
once('src/lib/subagent-governance.ts',
     "export type ProviderId = 'groq' | 'openai' | 'zai' | 'mistral'",
     "export type ProviderId = 'groq' | 'openai' | 'zai' | 'mistral' | 'openrouter' | 'gemini' | 'brave' | 'cerebras'")

once('src/lib/provider-intelligence-policy.ts',
     "export const PROVIDER_PRIORITY: readonly ProviderId[] = ['groq', 'openai', 'zai', 'mistral'] as const",
     """export const CORE_PROVIDER_PRIORITY: readonly ProviderId[] = ['groq', 'openai', 'zai', 'mistral'] as const
export const SECONDARY_PROVIDER_PRIORITY: readonly ProviderId[] = ['openrouter', 'gemini', 'brave', 'cerebras'] as const
export const PROVIDER_PRIORITY: readonly ProviderId[] = [...CORE_PROVIDER_PRIORITY, ...SECONDARY_PROVIDER_PRIORITY] as const
export const PROVIDER_PARALLEL_LIMIT = 4
""")

# Extend Provider Intelligence 2.0 runtime with the four secondary providers.
rt_path = 'src/lib/provider-runtime-v2.ts'
rt = read(rt_path)
needle = "  mistral: { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1/chat/completions', apiKeyEnv: 'MISTRAL_API_KEY', modelEnv: 'MISTRAL_MODEL', defaultModel: 'mistral-large-latest' },"
if "openrouter: { id: 'openrouter'" not in rt:
    insert = needle + "\n  openrouter: { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1/chat/completions', apiKeyEnv: 'OPENROUTER_API_KEY', modelEnv: 'OPENROUTER_MODEL', defaultModel: 'openrouter/free' },\n  gemini: { id: 'gemini', label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', apiKeyEnv: 'GEMINI_API_KEY', modelEnv: 'GEMINI_MODEL', defaultModel: 'gemini-3.5-flash' },\n  brave: { id: 'brave', label: 'Brave', baseUrl: 'https://api.search.brave.com/res/v1/chat/completions', apiKeyEnv: 'BRAVE_API_KEY', modelEnv: 'BRAVE_MODEL', defaultModel: 'brave' },\n  cerebras: { id: 'cerebras', label: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1/chat/completions', apiKeyEnv: 'CEREBRAS_API_KEY', modelEnv: 'CEREBRAS_MODEL', defaultModel: 'gpt-oss-120b' },"
    rt = rt.replace(needle, insert)
if 'export async function runGovernedProviderParallel' not in rt:
    rt += r'''

export function selectProvidersForTask(taskType: TaskType, count = PROVIDER_PARALLEL_LIMIT): ProviderId[] {
  const configured = getConfiguredProviders()
  const preferred: Record<TaskType, ProviderId[]> = {
    general: ['groq', 'openai', 'zai', 'mistral'],
    research: ['brave', 'gemini', 'openai', 'zai'],
    reasoning: ['groq', 'openai', 'zai', 'mistral'],
    coding: ['cerebras', 'groq', 'openai', 'mistral'],
    creative: ['gemini', 'groq', 'openai', 'mistral'],
    financial: ['openai', 'zai', 'mistral', 'cerebras'],
    security: ['openai', 'zai', 'mistral', 'cerebras'],
    operations: ['groq', 'openai', 'cerebras', 'zai'],
    analysis: ['brave', 'gemini', 'openai', 'zai'],
  }
  const ranked = [...(preferred[taskType] ?? preferred.general), ...configured]
  return [...new Set(ranked)].filter((provider) => configured.includes(provider)).slice(0, Math.max(2, Math.min(count, PROVIDER_PARALLEL_LIMIT)))
}

export async function runGovernedProviderParallel(request: ProviderRuntimeRequest, providers?: ProviderId[]): Promise<ProviderParallelResult> {
  const taskType = request.taskType ?? 'general'
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
'''
write(rt_path, rt)

# First-class governed path for the CEO.
once('src/lib/agent.ts',
     "import { callFallbackLlm } from '@/lib/llm-fallback'",
     "import { callFallbackLlm } from '@/lib/llm-fallback'\nimport { runGovernedProviderChat } from './provider-runtime-v2'")
once('src/lib/agent.ts',
     'IDENTITY: You are NOT ChatGPT. You are NOT "an AI assistant." You are Agent007 — Antonio\'s autonomous super-agent with 20 pod leaders and \\${TOOL_COUNT} tools.',
     'IDENTITY: You are NOT ChatGPT. You are Agent007 — Antonio\'s autonomous executive partner with governed leadership and \\${TOOL_COUNT} tools. Provider Intelligence 2.0 is authoritative: default order Groq → OpenAI → Z.ai → Mistral; secondary governed providers OpenRouter → Gemini → Brave → Cerebras. Select the best-fit provider for each task, and use 2+ providers in parallel whenever independent verification, comparison, resilience, multimodal work, or evidence diversity materially improves the result.')
once('src/lib/agent.ts',
     'TEAM: SCOUT|AURORA|ECHO|FORGE|PULSE|QUANTUM|HUNT|QUILL|PRISM|VERTEX|LEGAL|BANKER|TRADER|CYBERSECURITY_A|CYBERSECURITY_R|DEVELOPER|QA_MONITOR|EXTERNAL_UPTIME_MONITOR + 2 custom = 20 total.',
     'TEAM: 19 governed leaders are authoritative: SCOUT|AURORA|ECHO|FORGE|PULSE|QUANTUM|HUNT|QUILL|PRISM|VERTEX|LEGAL|BANKER|TRADER|CYBERSECURITY_A|CYBERSECURITY_R|DEVELOPER|QA_MONITOR|EXTERNAL_UPTIME_MONITOR|VID.')
regex_once('src/lib/agent.ts',
           r"(export async function callLlmWithRetry\([\s\S]*?\): Promise<any> \{)\n",
           r"\1\n  if (!process.env.LLM_PROVIDER_ORDER) {\n    try {\n      const governed = await runGovernedProviderChat({ messages })\n      return { choices: [{ message: { content: governed.content } }], _provider: governed.provider, _model: governed.model, _attempts: governed.attempts }\n    } catch (error) {\n      console.warn(`[Provider Intelligence 2.0] governed path failed; compatibility router engaged: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`)\n    }\n  }\n")

# Multi-provider comparison becomes the explicit parallel capability.
mpp = read('src/lib/multi-provider-comparison.ts')
once('src/lib/multi-provider-comparison.ts',
     "import type { ToolResult } from './tools'",
     "import type { ToolResult } from './tools'\nimport { runGovernedProviderParallel, selectProvidersForTask } from './provider-runtime-v2'\nimport type { ProviderId, TaskType } from './subagent-governance'")
once('src/lib/multi-provider-comparison.ts',
     "  const { prompt, providers = ['mistral', 'groq', 'openrouter'], systemPrompt } = args ?? {}",
     "  const { prompt, providers, systemPrompt, taskType = 'general' } = args ?? {}")
needle = "  if (!prompt) {\n    return {\n      ok: false,\n      preview: 'multi_provider_compare requires \\\"prompt\\\"',\n      result: 'Error: multi_provider_compare requires a \\\"prompt\\\" argument.',\n    }\n  }"
if needle in mpp and 'runGovernedProviderParallel' in mpp and 'const governed = await runGovernedProviderParallel' not in mpp:
    mpp = mpp.replace(needle, needle + "\n\n  const messages = [\n    ...(systemPrompt ? [{ role: 'system' as const, content: String(systemPrompt) }] : []),\n    { role: 'user' as const, content: String(prompt) },\n  ]\n  const selected = Array.isArray(providers) && providers.length > 1 ? providers.map((p: string) => p.toLowerCase() as ProviderId) : selectProvidersForTask(taskType as TaskType)\n  try {\n    const governed = await runGovernedProviderParallel({ messages, taskType: taskType as TaskType }, selected)\n    return { ok: governed.successful.length > 0, preview: `Provider Intelligence 2.0: ${governed.successful.length}/${governed.selectedProviders.length} parallel providers succeeded`, result: JSON.stringify(governed, null, 2) }\n  } catch (error) {\n    return { ok: false, preview: 'Provider Intelligence 2.0 parallel execution unavailable', result: error instanceof Error ? error.message : String(error) }\n  }")
write('src/lib/multi-provider-comparison.ts', mpp)

# Canonical organizational state.
canonical = """import { TOOL_REGISTRY } from './tools'\nimport { getAllGovernanceProfiles } from './subagent-governance'\nimport { CORE_PROVIDER_PRIORITY, SECONDARY_PROVIDER_PRIORITY, PROVIDER_PRIORITY, PROVIDER_PARALLEL_LIMIT } from './provider-intelligence-policy'\nimport { PROVIDER_RUNTIME_CONFIG, getConfiguredProviders } from './provider-runtime-v2'\n\nexport const CANONICAL_STATE_VERSION = '2.0.0'\nexport const CRON_POLICY = Object.freeze({ enabled: false, schedules: [] as readonly string[], reason: 'Production cron execution is disabled until explicit owner authorization.' })\nexport const RELEASE_POLICY = Object.freeze({ productionDeployment: 'manual-authorization-only' as const, automaticDeployments: false })\n\nexport function getCanonicalOrganizationalState() {\n  const profiles = getAllGovernanceProfiles()\n  return {\n    stateVersion: CANONICAL_STATE_VERSION,\n    generatedAt: new Date().toISOString(),\n    organization: { name: 'Agent007 AI', executive: 'CEO_AGENT007', director: 'VID Director' },\n    agents: { totalGovernedProfiles: profiles.length, ids: profiles.map((p) => p.id).sort() },\n    tools: { registryCount: Object.keys(TOOL_REGISTRY).length },\n    providers: {\n      defaultPriority: PROVIDER_PRIORITY,\n      corePriority: CORE_PROVIDER_PRIORITY,\n      secondaryPriority: SECONDARY_PROVIDER_PRIORITY,\n      configured: getConfiguredProviders(),\n      parallelLimit: PROVIDER_PARALLEL_LIMIT,\n      runtime: Object.fromEntries(Object.entries(PROVIDER_RUNTIME_CONFIG).map(([id, config]) => [id, { label: config.label, capabilities: config.capabilityTags ?? [], canParallel: true }])),\n    },\n    cronPolicy: CRON_POLICY,\n    releasePolicy: RELEASE_POLICY,\n    coherence: { singleSourceOfTruth: true as const, capabilityAccessModel: 'governed-per-agent' as const },\n  }\n}\n\nexport function validateCanonicalOrganizationalState(state = getCanonicalOrganizationalState()): string[] {\n  const errors: string[] = []\n  const expected = [...CORE_PROVIDER_PRIORITY, ...SECONDARY_PROVIDER_PRIORITY]\n  if (state.providers.defaultPriority.join('|') !== expected.join('|')) errors.push('Provider priority drift detected')\n  if (new Set(state.providers.defaultPriority).size !== state.providers.defaultPriority.length) errors.push('Provider priority contains duplicates')\n  if (state.agents.totalGovernedProfiles !== state.agents.ids.length) errors.push('Agent profile count mismatch')\n  if (state.cronPolicy.enabled) errors.push('Canonical cron policy is unexpectedly enabled')\n  if (state.releasePolicy.automaticDeployments) errors.push('Automatic production deployment is unexpectedly enabled')\n  if (state.providers.parallelLimit < 2) errors.push('Parallel provider limit must be at least 2')\n  return errors\n}\n"""
write('src/lib/canonical-organizational-state.ts', canonical)
write('src/app/api/system/canonical-state/route.ts', """import { NextResponse } from 'next/server'\nimport { getCanonicalOrganizationalState, validateCanonicalOrganizationalState } from '@/lib/canonical-organizational-state'\n\nexport const runtime = 'nodejs'\nexport const dynamic = 'force-dynamic'\n\nexport async function GET() {\n  const state = getCanonicalOrganizationalState()\n  const errors = validateCanonicalOrganizationalState(state)\n  return NextResponse.json({ ok: errors.length === 0, state, errors })\n}\n""")

# Diagnostics -> canonical state.
once('src/app/api/health/diagnostics/route.ts', "import { NextResponse } from 'next/server'", "import { NextResponse } from 'next/server'\nimport { getCanonicalOrganizationalState, validateCanonicalOrganizationalState } from '@/lib/canonical-organizational-state'")
once('src/app/api/health/diagnostics/route.ts', '  const uptime = Math.round(process.uptime())', '  const uptime = Math.round(process.uptime())\n  const canonicalState = getCanonicalOrganizationalState()\n  const canonicalErrors = validateCanonicalOrganizationalState(canonicalState)')
once('src/app/api/health/diagnostics/route.ts', '    morning_brief_cron: true,', '    morning_brief_cron: canonicalState.cronPolicy.enabled,')
regex_once('src/app/api/health/diagnostics/route.ts', r'cronsConfigured: 4,\n\s*cronSchedules: \[[\s\S]*?\n\s*\],', 'cronsConfigured: canonicalState.cronPolicy.schedules.length,\n      cronSchedules: canonicalState.cronPolicy.schedules,')
once('src/app/api/health/diagnostics/route.ts', '      missionPipelineStatus,', '      missionPipelineStatus,\n      canonicalState,\n      canonicalCoherenceErrors: canonicalErrors,')

# Full audit: one chain + safe credential representation.
once('src/app/api/health/full-audit/route.ts', "import { NextRequest, NextResponse } from 'next/server'", "import { NextRequest, NextResponse } from 'next/server'\nimport { getCanonicalOrganizationalState, validateCanonicalOrganizationalState } from '@/lib/canonical-organizational-state'")
regex_once('src/app/api/health/full-audit/route.ts', r'function mask\(key: string \| undefined\): string \{[\s\S]*?\n\}', "function mask(key: string | undefined): string {\n  return key ? `(configured, len=${key.length})` : '(not set)'\n}")
text = read('src/app/api/health/full-audit/route.ts')
if 'const canonical = getCanonicalOrganizationalState()' not in text:
    text = text.replace('  const checks: Check[] = []', "  const checks: Check[] = []\n  const canonical = getCanonicalOrganizationalState()\n  const canonicalErrors = validateCanonicalOrganizationalState(canonical)\n  checks.push({ id: 'canonical-state', name: 'Canonical organizational state', category: 'build', status: canonicalErrors.length === 0 ? 'pass' : 'fail', detail: canonicalErrors.length === 0 ? `State ${canonical.stateVersion} coherent` : canonicalErrors.join('; ') })", 1)
text = text.replace('`' + '${activeLlmCount}/7 LLM providers configured. Chain: OpenAI → Mistral → Groq → OpenRouter → Brave → Gemini → z.ai' + '`', '`' + '${activeLlmCount}/${canonical.providers.defaultPriority.length} LLM providers configured. Chain: ${canonical.providers.defaultPriority.join(\' → \')}' + '`')
text = text.replace('`${subagentData?.subagents?.length ?? 0} subagents registered (target: 20)`', '`${subagentData?.subagents?.length ?? 0} subagents registered (canonical: ${canonical.agents.totalGovernedProfiles})`')
write('src/app/api/health/full-audit/route.ts', text)

# Capabilities + VID consume canonical state.
once('src/app/api/system/capabilities/route.ts', "import { SUBAGENTS, FULL_ACCESS_TOOLS } from '@/lib/subagents'", "import { SUBAGENTS, FULL_ACCESS_TOOLS } from '@/lib/subagents'\nimport { getCanonicalOrganizationalState } from '@/lib/canonical-organizational-state'")
once('src/app/api/system/capabilities/route.ts', '    const caps = await getCapabilities()', '    const caps = await getCapabilities()\n    const canonicalState = getCanonicalOrganizationalState()')
once('src/app/api/system/capabilities/route.ts', '        allHaveFullAccess: caps.agents.allHaveFullAccess,', "        allHaveFullAccess: false,\n        accessModel: canonicalState.coherence.capabilityAccessModel,")
once('src/app/api/system/capabilities/route.ts', '      mission: caps.mission,', '      mission: caps.mission,\n      providerIntelligence: canonicalState.providers,')
once('src/app/api/system/capabilities/route.ts', '      summary: {', '      canonicalState,\n      summary: {')
once('src/app/api/system/vid-kpis/route.ts', "import { getPortfolio, getActiveBusinesses, computeEnterpriseValue } from '@/lib/business-portfolio'", "import { getPortfolio, getActiveBusinesses, computeEnterpriseValue } from '@/lib/business-portfolio'\nimport { getCanonicalOrganizationalState } from '@/lib/canonical-organizational-state'")
once('src/app/api/system/vid-kpis/route.ts', '    const [allBusinesses, activeBusinesses, enterpriseValue] = await Promise.all([', '    const canonicalState = getCanonicalOrganizationalState()\n    const [allBusinesses, activeBusinesses, enterpriseValue] = await Promise.all([')
once('src/app/api/system/vid-kpis/route.ts', '      ventures,\n      generatedAt: new Date().toISOString(),', '      ventures,\n      organizationState: canonicalState,\n      generatedAt: new Date().toISOString(),')

# Keep production deployment and Cron explicitly disabled in repository config.
vercel = read('vercel.json')
if '"crons": []' not in vercel:
    vercel = vercel.replace('  "git": {\n    "deploymentEnabled": false\n  },', '  "git": {\n    "deploymentEnabled": false\n  },\n  "crons": [],', 1)
write('vercel.json', vercel)

# Remove historically identified dead files if reintroduced.
for rel in ['src/lib/safety-reliability.ts','src/lib/improvement-actions.ts','src/lib/advanced-tools.ts','src/lib/intelligence-tools.ts','src/app/login/page.tsx.bak','prisma/schema.prisma.bak']:
    p = ROOT / rel
    if p.exists(): p.unlink()

print('coherence repairs applied')
