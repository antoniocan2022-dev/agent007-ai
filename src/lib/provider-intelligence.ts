import type { ActiveProviderId } from './provider-control-plane'
import { PROVIDER_RUNTIME_CONFIG, PROVIDER_ORDER, resolveLiveCatalog, getProviderCatalogSnapshot, type CatalogFetchResult } from './provider-control-plane'

interface ProviderHealth {
  name: ActiveProviderId
  totalCalls: number
  successCount: number
  failCount: number
  lastSuccessAt: number | null
  lastFailAt: number | null
  avgResponseMs: number
  currentModel: string | null
  circuitOpen: boolean
  circuitOpenUntil: number
  recentFailures: number[]
}

export interface ProviderDiscoveryResult { name: ActiveProviderId; discovered: boolean; model: string | null; error?: string; responseMs?: number; source?: CatalogFetchResult['source'] }

const G = globalThis as typeof globalThis & { __providerHealth?: Record<string, ProviderHealth> }
if (!G.__providerHealth) G.__providerHealth = {}
const healthStore: Record<string, ProviderHealth> = G.__providerHealth

function ensureHealth(provider: ActiveProviderId): ProviderHealth {
  if (!healthStore[provider]) healthStore[provider] = { name: provider, totalCalls: 0, successCount: 0, failCount: 0, lastSuccessAt: null, lastFailAt: null, avgResponseMs: 0, currentModel: null, circuitOpen: false, circuitOpenUntil: 0, recentFailures: [] }
  return healthStore[provider]
}

export async function discoverProviderModels(forceRefresh = false): Promise<ProviderDiscoveryResult[]> {
  const results: ProviderDiscoveryResult[] = []
  for (const provider of PROVIDER_ORDER) {
    if (!process.env[PROVIDER_RUNTIME_CONFIG[provider].apiKeyEnv]?.trim()) continue
    const started = Date.now()
    try {
      const catalog = await resolveLiveCatalog(provider, fetch, forceRefresh)
      const model = catalog.modelIds[0] ?? null
      ensureHealth(provider).currentModel = model
      results.push({ name: provider, discovered: Boolean(model), model, responseMs: Date.now() - started, source: catalog.source })
    } catch (error) {
      results.push({ name: provider, discovered: false, model: null, responseMs: Date.now() - started, error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) })
    }
  }
  return results
}

export function recordSuccess(provider: string, responseMs: number): void {
  if (!PROVIDER_ORDER.includes(provider as ActiveProviderId)) return
  const health = ensureHealth(provider as ActiveProviderId)
  health.totalCalls++
  health.successCount++
  health.lastSuccessAt = Date.now()
  health.avgResponseMs = health.avgResponseMs === 0 ? responseMs : Math.round(health.avgResponseMs * 0.7 + responseMs * 0.3)
  health.circuitOpen = false
  health.circuitOpenUntil = 0
  health.recentFailures = []
}

export function recordFailure(provider: string): void {
  if (!PROVIDER_ORDER.includes(provider as ActiveProviderId)) return
  const health = ensureHealth(provider as ActiveProviderId)
  health.totalCalls++
  health.failCount++
  health.lastFailAt = Date.now()
  const now = Date.now()
  health.recentFailures = health.recentFailures.filter((timestamp) => now - timestamp < 60_000)
  health.recentFailures.push(now)
  if (health.recentFailures.length >= 3) {
    health.circuitOpen = true
    health.circuitOpenUntil = now + 60_000
  }
}

export function getHealthScore(provider: string): number {
  if (!PROVIDER_ORDER.includes(provider as ActiveProviderId)) return 0
  const health = ensureHealth(provider as ActiveProviderId)
  if (!health.totalCalls) return 50
  const successRate = health.successCount / health.totalCalls * 100
  const recencyScore = health.lastSuccessAt ? Math.max(0, Math.min(100, 100 - (Date.now() - health.lastSuccessAt) / 3_600_000 * 100)) : 0
  const speedScore = health.avgResponseMs > 0 ? Math.max(0, Math.min(100, 100 - (health.avgResponseMs - 500) / 45)) : 50
  return Math.round(successRate * 0.7 + recencyScore * 0.2 + speedScore * 0.1)
}

export function isCircuitOpen(provider: string): boolean {
  if (!PROVIDER_ORDER.includes(provider as ActiveProviderId)) return false
  const health = ensureHealth(provider as ActiveProviderId)
  if (health.circuitOpen && Date.now() < health.circuitOpenUntil) return true
  if (health.circuitOpen) { health.circuitOpen = false; health.circuitOpenUntil = 0; health.recentFailures = [] }
  return false
}

export function getDiscoveredModel(provider: string): string | null {
  return PROVIDER_ORDER.includes(provider as ActiveProviderId) ? ensureHealth(provider as ActiveProviderId).currentModel : null
}

export function getBestProvider(availableProviders: readonly string[]): string | null {
  return [...availableProviders]
    .filter((provider) => PROVIDER_ORDER.includes(provider as ActiveProviderId))
    .filter((provider) => !isCircuitOpen(provider))
    .sort((a, b) => getHealthScore(b) - getHealthScore(a))[0] ?? null
}

export function getProviderMetadataSummary(): string {
  const lines = ['ACTIVE CANONICAL LLM PROVIDERS (Groq → Z.AI → Mistral → Gemini → Cerebras):']
  const catalog = getProviderCatalogSnapshot()
  for (const provider of PROVIDER_ORDER) {
    const health = ensureHealth(provider)
    const configured = Boolean(process.env[PROVIDER_RUNTIME_CONFIG[provider].apiKeyEnv]?.trim())
    const score = getHealthScore(provider)
    const status = !configured ? 'NOT CONFIGURED' : isCircuitOpen(provider) ? 'CIRCUIT OPEN' : health.totalCalls === 0 ? 'UNKNOWN' : score >= 80 ? 'HEALTHY' : score >= 50 ? 'DEGRADED' : 'UNHEALTHY'
    const model = health.currentModel || PROVIDER_RUNTIME_CONFIG[provider].defaultModel
    const cacheState = catalog[provider].cached ? `catalog cached ${Math.max(0, Math.round((catalog[provider].ageMs ?? 0) / 1000))}s` : 'catalog not cached'
    const successRate = health.totalCalls ? `${Math.round(health.successCount / health.totalCalls * 100)}% success` : 'no runtime data'
    const latency = health.avgResponseMs ? `${health.avgResponseMs}ms avg` : 'no latency data'
    lines.push(`- ${PROVIDER_RUNTIME_CONFIG[provider].label}: ${status} | model: ${model} | ${successRate} | ${latency} | ${cacheState}`)
  }
  return lines.join('\n')
}

export async function getToolDiscoveryPrompt(): Promise<string> {
  let toolCount = 0
  try { const { TOOL_REGISTRY } = await import('./tools'); toolCount = Object.keys(TOOL_REGISTRY).length } catch {}
  return `TOOL DISCOVERY — You have ${toolCount} tools available. Use smart_tool_router for discovery, parallel_executor for independent work, and accuracy_checker before reporting evidence-backed findings.`
}

export async function initProviderIntelligence(): Promise<void> {
  // Intentionally stateless: runtime callers perform live resolution with a bounded TTL cache.
  await discoverProviderModels()
}
