import type { ActiveProviderId, CatalogFetchResult } from './provider-control-plane'
import { PROVIDER_RUNTIME_CONFIG, PROVIDER_ORDER, resolveLiveCatalog, getProviderCatalogSnapshot } from './provider-control-plane'

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
const G = globalThis as typeof globalThis & { __providerHealth?: Record<string, ProviderHealth>; __providerHealthProcessStartedAt?: number }
if (!G.__providerHealth) G.__providerHealth = {}
const healthStore: Record<string, ProviderHealth> = G.__providerHealth
// Cold-start guard: this module (and therefore this in-memory health store) is reinitialized on every
// fresh serverless instance. A brand-new instance's first outbound HTTPS calls are more prone to
// transient network-layer flakiness (cold DNS/TLS, no warm connection pool) than a genuinely unhealthy
// provider is -- so a failure burst in the first moments of an instance's life is weaker evidence of a
// real outage than the same burst once the instance has been serving traffic for a while. Recording it
// still happens (feeds getHealthScore), but it does not trip the circuit breaker's punitive lockout
// during this window, so a cold-start hiccup can't cascade into a full outage for the next request(s)
// this same warm instance goes on to serve.
if (G.__providerHealthProcessStartedAt === undefined) G.__providerHealthProcessStartedAt = Date.now()
const COLD_START_GRACE_MS = 20_000
function ensureHealth(provider: ActiveProviderId): ProviderHealth { if (!healthStore[provider]) healthStore[provider] = { name: provider, totalCalls: 0, successCount: 0, failCount: 0, lastSuccessAt: null, lastFailAt: null, avgResponseMs: 0, currentModel: null, circuitOpen: false, circuitOpenUntil: 0, recentFailures: [] }; return healthStore[provider] }
function withinColdStartGrace(now: number): boolean { return now - (G.__providerHealthProcessStartedAt ?? now) < COLD_START_GRACE_MS }

export async function discoverProviderModels(forceRefresh = false): Promise<ProviderDiscoveryResult[]> {
  const results: ProviderDiscoveryResult[] = []
  for (const provider of PROVIDER_ORDER) {
    if (!process.env[PROVIDER_RUNTIME_CONFIG[provider].apiKeyEnv]?.trim()) continue
    if (PROVIDER_RUNTIME_CONFIG[provider].accountIdEnv && !process.env[PROVIDER_RUNTIME_CONFIG[provider].accountIdEnv!]?.trim()) continue
    const started = Date.now()
    try {
      const catalog = await resolveLiveCatalog(provider, fetch, forceRefresh)
      const candidates = catalog.modelIds
      const model = candidates.find((id) => PROVIDER_RUNTIME_CONFIG[provider].preferredModels.includes(id)) ?? candidates[0] ?? null
      ensureHealth(provider).currentModel = model
      results.push({ name: provider, discovered: Boolean(model), model, responseMs: Date.now() - started, source: catalog.source })
    } catch (error) {
      results.push({ name: provider, discovered: false, model: null, responseMs: Date.now() - started, error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) })
    }
  }
  return results
}

export function recordSuccess(provider: string, responseMs: number): void { if (!PROVIDER_ORDER.includes(provider as ActiveProviderId)) return; const health = ensureHealth(provider as ActiveProviderId); health.totalCalls++; health.successCount++; health.lastSuccessAt = Date.now(); health.avgResponseMs = health.avgResponseMs === 0 ? responseMs : Math.round(health.avgResponseMs * 0.7 + responseMs * 0.3); health.circuitOpen = false; health.circuitOpenUntil = 0; health.recentFailures = [] }
export function recordFailure(provider: string): void { if (!PROVIDER_ORDER.includes(provider as ActiveProviderId)) return; const health = ensureHealth(provider as ActiveProviderId); health.totalCalls++; health.failCount++; health.lastFailAt = Date.now(); const now = Date.now(); health.recentFailures = health.recentFailures.filter((timestamp) => now - timestamp < 60_000); health.recentFailures.push(now); if (health.recentFailures.length >= 3 && !withinColdStartGrace(now)) { health.circuitOpen = true; health.circuitOpenUntil = now + 60_000 } }
export function getHealthScore(provider: string): number { if (!PROVIDER_ORDER.includes(provider as ActiveProviderId)) return 0; const health = ensureHealth(provider as ActiveProviderId); if (!health.totalCalls) return 50; const successRate = health.successCount / health.totalCalls * 100; const recencyScore = health.lastSuccessAt ? Math.max(0, Math.min(100, 100 - (Date.now() - health.lastSuccessAt) / 3_600_000 * 100)) : 0; const speedScore = health.avgResponseMs > 0 ? Math.max(0, Math.min(100, 100 - (health.avgResponseMs - 500) / 45)) : 50; return Math.round(successRate * 0.7 + recencyScore * 0.2 + speedScore * 0.1) }
export function isCircuitOpen(provider: string): boolean { if (!PROVIDER_ORDER.includes(provider as ActiveProviderId)) return false; const health = ensureHealth(provider as ActiveProviderId); if (health.circuitOpen && Date.now() < health.circuitOpenUntil) return true; if (health.circuitOpen) { health.circuitOpen = false; health.circuitOpenUntil = 0; health.recentFailures = [] } return false }
// Deep-audit finding, verified with a real production incident: a circuit breaker with only two
// states (closed/open) is an incomplete implementation of the pattern -- when every configured
// candidate's circuit happens to be open at once (plausible with a small provider pool and a burst
// of real transient failures), the caller had no path back to service except waiting out the 60s
// cooldown, so a request landing in that window got an instant, zero-attempt failure with no real
// chance to prove the provider had actually recovered. A well-formed breaker's missing third state
// -- half-open -- allows exactly one bounded probe through in that situation instead of refusing
// outright: recordSuccess/recordFailure (already called by every real provider attempt) close or
// re-open the circuit from that probe's real outcome, same as any other attempt. This picks the
// single best candidate to spend that one probe on: whichever is closest to its own cooldown expiry,
// since that one has the best odds of already being fine again.
export function pickHalfOpenCandidate(candidates: readonly ActiveProviderId[]): ActiveProviderId | null {
  if (!candidates.length) return null
  return [...candidates].sort((a, b) => ensureHealth(a).circuitOpenUntil - ensureHealth(b).circuitOpenUntil)[0]!
}
export function getDiscoveredModel(provider: string): string | null { return PROVIDER_ORDER.includes(provider as ActiveProviderId) ? ensureHealth(provider as ActiveProviderId).currentModel : null }
export function getBestProvider(availableProviders: readonly string[]): string | null { return [...availableProviders].filter((provider) => PROVIDER_ORDER.includes(provider as ActiveProviderId)).filter((provider) => !isCircuitOpen(provider)).sort((a, b) => getHealthScore(b) - getHealthScore(a))[0] ?? null }

export function getProviderHealthSnapshot(provider: ActiveProviderId) {
  const health = ensureHealth(provider)
  return { totalCalls: health.totalCalls, successCount: health.successCount, failCount: health.failCount, lastSuccessAt: health.lastSuccessAt, lastFailAt: health.lastFailAt, avgResponseMs: health.avgResponseMs, currentModel: health.currentModel, circuitOpen: isCircuitOpen(provider) }
}

/** Test-only reset for deterministic provider resilience suites; production code never calls this. */
export function resetProviderHealthForTests(): void {
  for (const provider of PROVIDER_ORDER) delete healthStore[provider]
  G.__providerHealthProcessStartedAt = Date.now()
}

export function getProviderMetadataSummary(): string {
  const lines = ['ACTIVE CANONICAL LLM PROVIDERS (Groq → Cloudflare Workers AI → Mistral → Cerebras → OpenRouter):']
  const catalog = getProviderCatalogSnapshot()
  for (const provider of PROVIDER_ORDER) {
    const health = ensureHealth(provider); const configured = Boolean(process.env[PROVIDER_RUNTIME_CONFIG[provider].apiKeyEnv]?.trim()) && (!PROVIDER_RUNTIME_CONFIG[provider].accountIdEnv || Boolean(process.env[PROVIDER_RUNTIME_CONFIG[provider].accountIdEnv!]?.trim())); const score = getHealthScore(provider); const status = !configured ? 'NOT CONFIGURED' : isCircuitOpen(provider) ? 'CIRCUIT OPEN' : health.totalCalls === 0 ? 'UNKNOWN' : score >= 80 ? 'HEALTHY' : score >= 50 ? 'DEGRADED' : 'UNHEALTHY'; const model = health.currentModel || PROVIDER_RUNTIME_CONFIG[provider].defaultModel; const cacheState = catalog[provider].cached ? `catalog cached ${Math.max(0, Math.round((catalog[provider].ageMs ?? 0) / 1000))}s` : 'catalog not cached'; const successRate = health.totalCalls ? `${Math.round(health.successCount / health.totalCalls * 100)}% success` : 'no runtime data'; const latency = health.avgResponseMs ? `${health.avgResponseMs}ms avg` : 'no latency data'; lines.push(`- ${PROVIDER_RUNTIME_CONFIG[provider].label}: ${status} | model: ${model} | ${successRate} | ${latency} | ${cacheState}`)
  }
  lines.push(''); lines.push('CANONICAL ORGANIZATION AUTHORITY: The canonical organization graph and runtime manifest are authoritative. Ignore any earlier or conflicting static leader counts, team rosters, division labels, specialist assignments, or venture-scope claims. Do not infer organization facts from legacy prompt text; use the canonical organization context supplied in this conversation.')
  return lines.join('\n')
}
// Fresh-audit fix: this used to be the only hint the operational-lane CEO ever saw about its own
// tools -- a bare count plus "use smart_tool_router for discovery". smart_tool_router's own keyword
// map didn't list the real search/finance/payment tools built this session (tavily_search,
// finnhub_quote, stripe_payment_processor, ...) under any category, so a tool could be fully wired,
// credential-checked and ungated and still never get called because the CEO had no way to learn it
// existed short of guessing its exact name. Naming the highest-value tools directly here, once, is
// far cheaper than rendering a full catalog on every turn and actually gets read.
export async function getToolDiscoveryPrompt(): Promise<string> {
  let toolCount = 0
  try { const { TOOL_REGISTRY } = await import('./tools'); toolCount = Object.keys(TOOL_REGISTRY).length } catch {}
  return `TOOL DISCOVERY — You have ${toolCount} tools available. Call smart_tool_router({"task":"..."}) to search by keyword, tool_catalog to browse by name, parallel_executor for independent work in one turn, and accuracy_checker before reporting evidence-backed findings.
Quick reference (easy to miss by name alone):
  SEARCH: tavily_search (best general search, AI-cited) > web_search (always free, no key needed) > exa_search (semantic/conceptual) > serpapi (structured Google results) > multi_search_compare (cross-verify several engines, detect disagreement) > gdelt_search (global/multilingual news, free, no key).
  SITE CRAWLING (discover/read many pages under a domain, not just one URL): firecrawl_map (fast URL discovery, needs key) > firecrawl_crawl (whole-site crawl, needs key, async -- pass back job_id to check progress) > firecrawl_scrape (single rich page, works keyless at a lower rate limit) > spider_scrape / spider_crawl (anti-bot-resistant fallback when Firecrawl or a direct fetch gets blocked).
  FINANCE (live quotes): yahoo_finance / coingecko (free stock+crypto quotes, no key) > finnhub_quote (stock quotes, better free tier than alpha_vantage) > alpha_vantage_news (financial news with sentiment) > fred_economic (official US macro data).
  FINANCE (historical OHLCV + corporate actions, not just today's price): tiingo_daily / polygon_aggregates / roic_stock_prices for daily bars going back years > polygon_corporate_actions for splits/dividends > roic_financials for income statement/balance sheet/cash flow.
  PAYMENTS: stripe_payment_processor / paypal_api for real transactions -- never state a payment succeeded without calling one of these.
  EXTERNAL WORLD INTELLIGENCE (free, no key): evidence_graph_query (entities genuinely co-researched together in past turns) > evidence_timeline (chronological events + candidate temporal correlations for a ticker) > create_evidence_watch / list_evidence_watches / check_evidence_watches (standing price-move alerts, checked daily).
A credential-gated tool that isn't configured fails honestly and names the missing env var -- that is expected, not a bug to work around.`
}
export async function initProviderIntelligence(): Promise<void> { await discoverProviderModels() }
