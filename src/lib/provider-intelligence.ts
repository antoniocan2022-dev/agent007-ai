/** Canonical provider health, discovery, circuit breaking, and tool-discovery metadata. */
interface ProviderHealth { name: string; totalCalls: number; successCount: number; failCount: number; lastSuccessAt: number | null; lastFailAt: number | null; avgResponseMs: number; currentModel: string | null; circuitOpen: boolean; circuitOpenUntil: number; recentFailures: number[] }
export interface ProviderDiscoveryResult { name: string; discovered: boolean; model: string | null; error?: string; responseMs?: number }
interface ProviderDefinition { name: string; env: string; modelEnv: string; defaultModel: string; modelsUrl?: string }
const ACTIVE_PROVIDERS: readonly ProviderDefinition[] = [
  { name: 'Groq', env: 'GROQ_API_KEY', modelEnv: 'GROQ_MODEL', defaultModel: 'llama-3.3-70b-versatile', modelsUrl: 'https://api.groq.com/openai/v1/models' },
  { name: 'Z.AI', env: 'ZAI_API_KEY', modelEnv: 'ZAI_MODEL', defaultModel: 'glm-5.1' },
  { name: 'Mistral', env: 'MISTRAL_API_KEY', modelEnv: 'MISTRAL_MODEL', defaultModel: 'mistral-large-latest' },
  { name: 'Gemini', env: 'GEMINI_API_KEY', modelEnv: 'GEMINI_MODEL', defaultModel: 'gemini-3.7-flash' },
  { name: 'Cerebras', env: 'CEREBRAS_API_KEY', modelEnv: 'CEREBRAS_MODEL', defaultModel: 'gpt-oss-120b', modelsUrl: 'https://api.cerebras.ai/v1/models' },
]
const G = globalThis as any
if (!G.__providerHealth) G.__providerHealth = {} as Record<string, ProviderHealth>
if (!G.__providerDiscoveryDone) G.__providerDiscoveryDone = false
const healthStore: Record<string, ProviderHealth> = G.__providerHealth
function ensureHealth(name: string): ProviderHealth { if (!healthStore[name]) healthStore[name] = { name, totalCalls: 0, successCount: 0, failCount: 0, lastSuccessAt: null, lastFailAt: null, avgResponseMs: 0, currentModel: null, circuitOpen: false, circuitOpenUntil: 0, recentFailures: [] }; return healthStore[name] }
function configuredProvider(name: string): boolean { const provider = ACTIVE_PROVIDERS.find((item) => item.name === name); return !!provider && !!process.env[provider.env]?.trim() }
export async function discoverProviderModels(): Promise<ProviderDiscoveryResult[]> {
  if (G.__providerDiscoveryDone) return ACTIVE_PROVIDERS.filter((p) => configuredProvider(p.name)).map((p) => ({ name: p.name, discovered: !!ensureHealth(p.name).currentModel, model: ensureHealth(p.name).currentModel || process.env[p.modelEnv]?.trim() || p.defaultModel }))
  G.__providerDiscoveryDone = true
  const results: ProviderDiscoveryResult[] = []
  for (const provider of ACTIVE_PROVIDERS) {
    if (!configuredProvider(provider.name)) continue
    const key = process.env[provider.env]!.trim(); const preferredModel = process.env[provider.modelEnv]?.trim() || provider.defaultModel
    if (!provider.modelsUrl) { ensureHealth(provider.name).currentModel = preferredModel; results.push({ name: provider.name, discovered: true, model: preferredModel }); continue }
    const start = Date.now()
    try {
      const response = await fetch(provider.modelsUrl, { headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'Agent007-AI/1.0' }, signal: AbortSignal.timeout(5000) })
      if (!response.ok) { results.push({ name: provider.name, discovered: false, model: preferredModel, error: `HTTP ${response.status}`, responseMs: Date.now() - start }); continue }
      const data = await response.json(); const models = Array.isArray(data?.data) ? data.data : []; const preferred = models.find((model: any) => model?.id === preferredModel) ?? models[0]; const model = preferred?.id || preferredModel
      ensureHealth(provider.name).currentModel = model; results.push({ name: provider.name, discovered: !!preferred?.id, model, responseMs: Date.now() - start })
    } catch (error: any) { results.push({ name: provider.name, discovered: false, model: preferredModel, error: error?.message?.slice(0, 120), responseMs: Date.now() - start }) }
  }
  return results
}
export function recordSuccess(provider: string, responseMs: number): void { const health = ensureHealth(provider); health.totalCalls++; health.successCount++; health.lastSuccessAt = Date.now(); health.avgResponseMs = health.avgResponseMs === 0 ? responseMs : Math.round(health.avgResponseMs * 0.7 + responseMs * 0.3); health.circuitOpen = false; health.circuitOpenUntil = 0; health.recentFailures = [] }
export function recordFailure(provider: string): void { const health = ensureHealth(provider); health.totalCalls++; health.failCount++; health.lastFailAt = Date.now(); const now = Date.now(); health.recentFailures = health.recentFailures.filter((timestamp) => now - timestamp < 60000); health.recentFailures.push(now); if (health.recentFailures.length >= 3) { health.circuitOpen = true; health.circuitOpenUntil = now + 60000 } }
export function getHealthScore(provider: string): number { const health = ensureHealth(provider); if (!health.totalCalls) return 50; const successRate = health.successCount / health.totalCalls * 100; const recencyScore = health.lastSuccessAt ? Math.max(0, Math.min(100, 100 - (Date.now() - health.lastSuccessAt) / 3600000 * 100)) : 0; const speedScore = health.avgResponseMs > 0 ? Math.max(0, Math.min(100, 100 - (health.avgResponseMs - 500) / 45)) : 50; return Math.round(successRate * 0.7 + recencyScore * 0.2 + speedScore * 0.1) }
export function isCircuitOpen(provider: string): boolean { const health = ensureHealth(provider); if (health.circuitOpen && Date.now() < health.circuitOpenUntil) return true; if (health.circuitOpen) { health.circuitOpen = false; health.circuitOpenUntil = 0; health.recentFailures = [] } return false }
export function getDiscoveredModel(provider: string): string | null { return ensureHealth(provider).currentModel }
export function getBestProvider(availableProviders: string[]): string | null { return availableProviders.filter((provider) => ACTIVE_PROVIDERS.some((item) => item.name === provider)).filter((provider) => !isCircuitOpen(provider)).sort((a, b) => getHealthScore(b) - getHealthScore(a))[0] ?? null }
export function getProviderMetadataSummary(): string { const lines = ['ACTIVE CANONICAL LLM PROVIDERS (Groq → Z.AI → Mistral → Gemini → Cerebras):']; for (const provider of ACTIVE_PROVIDERS) { const health = ensureHealth(provider.name); const configured = configuredProvider(provider.name); const score = getHealthScore(provider.name); const status = !configured ? 'NOT CONFIGURED' : isCircuitOpen(provider.name) ? 'CIRCUIT OPEN' : health.totalCalls === 0 ? 'UNKNOWN' : score >= 80 ? 'HEALTHY' : score >= 50 ? 'DEGRADED' : 'UNHEALTHY'; const model = health.currentModel || process.env[provider.modelEnv]?.trim() || provider.defaultModel; const successRate = health.totalCalls ? `${Math.round(health.successCount / health.totalCalls * 100)}% success` : 'no runtime data'; const latency = health.avgResponseMs ? `${health.avgResponseMs}ms avg` : 'no latency data'; lines.push(`- ${provider.name}: ${status} | model: ${model} | ${successRate} | ${latency}`) } return lines.join('\n') }
export async function getToolDiscoveryPrompt(): Promise<string> { let toolCount = 0; try { const { TOOL_REGISTRY } = await import('./tools'); toolCount = Object.keys(TOOL_REGISTRY).length } catch {} return `TOOL DISCOVERY — You have ${toolCount} tools available. Use smart_tool_router for discovery, parallel_executor for independent work, and accuracy_checker before reporting evidence-backed findings.` }
export async function initProviderIntelligence(): Promise<void> { if (!G.__providerDiscoveryDone) await discoverProviderModels() }
