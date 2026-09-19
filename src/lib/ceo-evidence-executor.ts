import { dispatchTool, type ToolContext, type ToolResult } from './tools'
import { buildEvidenceBundle, createEvidenceSource, type EvidenceSource, sourceTierForUrl, type EvidenceSourceType } from './ceo-evidence-bundle'
import type { ExternalEvidencePlan, EvidenceQuery } from './ceo-evidence-planner'
import { getCeoCancellationSignal } from './ceo-cancellation-context'
import { throwIfCeoRequestAborted } from './ceo-cancellation'
import { recordToolOutcome } from './ceo-tool-outcome-intelligence'
import { assertRuntimeIntegration } from './architecture-integrity-contract'
import { assertDecisionGradeEvidence } from './ceo-decision-grade-evidence'
// Deep-audit fix (P0, 2026-09-13): getSecTickerMap moved to ceo-issuer-resolution.ts as the single
// canonical fetcher -- this file previously kept its own private copy, and issuer resolution needed the
// same data for a second purpose (company-name matching), which would have meant a third divergent copy.
import { getSecTickerMap, resolveSecUserAgent } from './ceo-issuer-resolution'
// Deep-audit fix (P0, 2026-09-13): claim-ledger read/write, scoped to SEC company-facts sources only --
// see ceo-claim-ledger.ts's module doc for why (unambiguous per-ticker attribution).
import { crossTurnContradictions, DEFAULT_CROSS_TURN_CLAIM_MAX_AGE_MS, lookupRecentVerifiedClaims, recordVerifiedClaims } from './ceo-claim-ledger'
import { recordEvidenceGraphFromBundle } from './ceo-evidence-graph'

export interface ExternalEvidenceExecution { bundle: ReturnType<typeof buildEvidenceBundle>; attemptedQueries: number; successfulQueries: number; pageReads: number; secSources: number; marketDataSources: number; failures: string[] }
function toolContext(): ToolContext { return { attachments: [], language: 'en' } }
async function dispatch(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> { throwIfCeoRequestAborted(signal); return dispatchTool(name, { ...args, __agent007_abort_signal: signal }, toolContext()) }
// Deep-audit fix: this used to keep its own separate DEFAULT_SEC_UA/User-Agent resolution, duplicating
// ceo-issuer-resolution.ts's -- a live production incident (every SEC call 403ing) traced back to that
// default being non-compliant with SEC's fair-access policy, and a fix applied to only one of the two
// copies would have left the other silently broken. resolveSecUserAgent() is now the single source of
// truth both files share, so there is exactly one place left to fix or misconfigure.
async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> { throwIfCeoRequestAborted(signal); const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': resolveSecUserAgent() }, redirect: 'follow', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000) }); if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`); return response.json() as Promise<T> }
interface SecFactUnit { fy?: number; fp?: string; form?: string; filed?: string; val?: number; frame?: string }
interface SecFacts { entityName?: string; facts?: Record<string, Record<string, { units?: Record<string, SecFactUnit[]> }>> }
const FACT_CANDIDATES: Array<{ key: string; label: string }> = [
  { key: 'RevenueFromContractWithCustomerExcludingAssessedTax', label: 'Revenue' }, { key: 'Revenues', label: 'Revenue' }, { key: 'SalesRevenueNet', label: 'Sales' },
  { key: 'CashAndCashEquivalentsAtCarryingValue', label: 'Cash' }, { key: 'Assets', label: 'Assets' }, { key: 'Liabilities', label: 'Liabilities' },
  { key: 'LongTermDebtCurrent', label: 'Current debt' }, { key: 'LongTermDebtNoncurrent', label: 'Long-term debt' }, { key: 'NetIncomeLoss', label: 'Net income' },
]
function latestUnit(units?: Record<string, SecFactUnit[]>): SecFactUnit | null { const candidates = Object.values(units ?? {}).flat().filter((item) => typeof item.val === 'number' && item.filed); candidates.sort((a, b) => String(b.filed).localeCompare(String(a.filed))); return candidates[0] ?? null }
async function fetchSecSource(ticker: string, signal?: AbortSignal): Promise<EvidenceSource | null> { const map = await getSecTickerMap(signal), item = map[ticker.toUpperCase()]; if (!item?.cik_str) return null; const cik = String(item.cik_str).padStart(10, '0'), url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, payload = await fetchJson<SecFacts>(url, signal), usGaap = payload.facts?.['us-gaap'] ?? {}; const lines: string[] = [`SEC Company Facts for ${ticker.toUpperCase()} — ${payload.entityName ?? item.title}`]; let latestFiled: string | undefined; for (const candidate of FACT_CANDIDATES) { const fact = latestUnit(usGaap[candidate.key]?.units); if (!fact) continue; if (fact.filed && (!latestFiled || fact.filed > latestFiled)) latestFiled = fact.filed; lines.push(`${candidate.label}: ${fact.val} (${fact.form ?? 'filing'}, filed ${fact.filed}${fact.fp ? `, ${fact.fp}` : ''})`) } if (lines.length === 1) return null; const publishedAt = latestFiled ? Date.parse(`${latestFiled}T00:00:00Z`) : undefined; return createEvidenceSource({ url, title: `${ticker.toUpperCase()} SEC Company Facts`, sourceType: 'sec_companyfacts', sourceTier: 1, retrievedAt: Date.now(), publishedAt: Number.isFinite(publishedAt) ? publishedAt : undefined, text: lines.join('\n'), id: `SEC-${ticker.toUpperCase()}`, relatedEntities: [ticker.toUpperCase()] }) }
function cacheBypassArgs(args: Record<string, unknown>): Record<string, unknown> { return { ...args, evidence_refresh_nonce: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}` } }
// Architecture fix (2026-09-17), root-caused against a real production failure (CEO could not answer
// "give me updates on GEOS and MIND Technology"): equity-research evidence acquisition had exactly one
// dispatch shape -- executeSearch below, hardcoded to {query, num, recency_days} -- so the dedicated,
// symbol-keyed market-data tools (yahoo_finance/tiingo_daily/polygon_aggregates/finnhub_quote/
// roic_stock_prices/alpha_vantage) could never be called here regardless of how selectCeoTool scored
// them; QUERY_SEARCH_TOOL_IDS below exists purely to degrade that mismatch to a silent web_search
// fallback instead of a hard dispatch error. For a thinly-covered small-cap ticker, generic web search
// frequently returns few or no usable results for a bare price/market-cap query, which is exactly the
// evidence-insufficient path that produced the generic degraded-mode refusal. This is a second, genuine
// dispatch channel -- not a patch on executeSearch's shape -- for exactly the one purpose (`market`) that
// always has a real, structured, symbol-addressable answer: a governed fallback chain of market-data
// tools, tried in reliability order, stopping at the first real success. Purely additive to the existing
// search-query path (still runs unchanged for financials/risks/filing/comparison, and for 'market' itself
// if every provider here is unavailable/unconfigured), so this can only add evidence sources, never
// remove the coverage that existed before it.
const MARKET_DATA_TOOL_ORDER = ['yahoo_finance', 'tiingo_daily', 'polygon_aggregates', 'finnhub_quote', 'roic_stock_prices', 'alpha_vantage'] as const
const MARKET_DATA_TOOL_URL: Record<(typeof MARKET_DATA_TOOL_ORDER)[number], (ticker: string) => string> = {
  yahoo_finance: (ticker) => `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}`,
  tiingo_daily: (ticker) => `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(ticker)}/prices`,
  polygon_aggregates: (ticker) => `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}`,
  finnhub_quote: (ticker) => `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}`,
  roic_stock_prices: (ticker) => `https://api.roic.ai/v2/stock-prices/${encodeURIComponent(ticker)}`,
  alpha_vantage: (ticker) => `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(ticker)}`,
}
// Deep-audit fix, same live-production incident: this chain tries up to 6 tools SEQUENTIALLY per
// ticker, with no overall deadline -- an unconfigured or slow tool early in MARKET_DATA_TOOL_ORDER
// (missing API key, a real network call that times out on its own multi-second budget) could eat most
// of a ticker's share of the request's latency budget before ever reaching a tool that would actually
// succeed, and this runs for every ticker in the request. A bounded overall deadline means a ticker
// whose easy tools are all unavailable still leaves time for the OTHER evidence sources (search, page
// reads, the other ticker) rather than exhausting the budget one slow fallback at a time.
const MARKET_DATA_CHAIN_DEADLINE_MS = 20_000
export async function fetchMarketDataSource(ticker: string, signal?: AbortSignal): Promise<EvidenceSource | null> {
  const deadline = Date.now() + MARKET_DATA_CHAIN_DEADLINE_MS
  for (const toolName of MARKET_DATA_TOOL_ORDER) {
    throwIfCeoRequestAborted(signal)
    if (Date.now() >= deadline) break
    try {
      const result = await dispatch(toolName, { symbol: ticker, ticker, latest: true }, signal)
      recordToolOutcome({ toolId: toolName, capability: 'market_intelligence', status: result.ok ? 'succeeded' : 'partial' })
      if (!result.ok || !result.result.trim()) continue
      return createEvidenceSource({ url: MARKET_DATA_TOOL_URL[toolName](ticker), title: `${ticker} market data (${toolName})`, sourceType: 'market_data', sourceTier: 1, retrievedAt: Date.now(), text: result.result, id: `MKT-${toolName}-${ticker}`, relatedEntities: [ticker] })
    } catch (error) { throwIfCeoRequestAborted(signal); recordToolOutcome({ toolId: toolName, capability: 'market_intelligence', status: 'failed' }) }
  }
  return null
}
// Fresh-audit fix (round 2): executeSearch below always dispatches the selected tool with
// {query, num, recency_days} -- a free-text web-search argument shape. Fixing the capability-domain
// lookup bug in ceo-tool-selection.ts (see ceo-capability-architecture.ts's findCapabilityForDomain)
// makes the finance/commerce domains' tool lists reachable for the first time, but several of those
// tools take a completely different argument shape (finnhub_quote/alpha_vantage/yahoo_finance need
// "symbol", fred_economic needs "series_id", financial_tracker/payment_processor take no query at
// all -- internal-state only). Dispatching one of those here with {query,...} would deterministically
// fail ("requires symbol") instead of gathering evidence, regressing what used to be a working
// web_search fallback for finance-domain external-evidence requests. Only ever hand a genuine
// free-text search tool to executeSearch; anything else falls back to web_search exactly as before.
const QUERY_SEARCH_TOOL_IDS = new Set(['web_search', 'tavily_search', 'exa_search', 'serpapi', 'perplexity_ai_search', 'you_com_search', 'google_ai_search', 'brave_ai_search', 'copilot_search', 'chatgpt_search', 'newsapi', 'multi_search_compare', 'kb_search', 'gdelt_search'])
function urlsFromSearchResult(result: ToolResult): string[] { return [...result.result.matchAll(/URL:\s*(https?:\/\/[^\s]+)/gi)].map((match) => match[1]) }
function titleFromSearchResult(result: ToolResult, url: string): string { const line = result.result.split('\n').find((candidate) => candidate.includes(url)); return line ? line.replace(/^[0-9]+\.\s*/, '').replace(/\*\*/g, '').trim() || url : url }
export function deriveSearchSourceType(url: string, query: EvidenceQuery): EvidenceSourceType { if (query.sourcePreference === 'market') return sourceTierForUrl(url) <= 2 ? 'market_data' : 'web'; return 'web' }
async function executeSearch(query: EvidenceQuery, toolName: string, signal?: AbortSignal): Promise<{ result: ToolResult; sources: EvidenceSource[] }> { throwIfCeoRequestAborted(signal); const result = await dispatch(toolName, cacheBypassArgs({ query: query.query, num: 6, recency_days: query.recencyDays }), signal); if (!result.ok) return { result, sources: [] }; const retrievedAt = Date.now(), urls = urlsFromSearchResult(result).slice(0, 6), relatedEntities = query.ticker ? [query.ticker] : []; return { result, sources: urls.map((url, index) => createEvidenceSource({ url, title: titleFromSearchResult(result, url), sourceType: deriveSearchSourceType(url, query), sourceTier: sourceTierForUrl(url), retrievedAt, text: result.result.slice(0, 6000), id: `${query.id}-${index + 1}`, relatedEntities })) } }
async function readPages(urls: string[], signal?: AbortSignal): Promise<EvidenceSource[]> { const outputs = await Promise.all(urls.map(async (url, index) => { throwIfCeoRequestAborted(signal); const result = await dispatch('page_reader', cacheBypassArgs({ url }), signal); if (!result.ok) return null; return createEvidenceSource({ url, title: result.preview.replace(/^Read page(?: \\(via fallback\\))?:\\s*/i, '').slice(0, 240) || url, sourceType: 'page', sourceTier: sourceTierForUrl(url), retrievedAt: Date.now(), text: result.result, id: `PAGE-${index + 1}` }) })); return outputs.filter((source): source is EvidenceSource => source !== null) }
async function executeOnce(plan: ExternalEvidencePlan, querySuffix = '', signal?: AbortSignal): Promise<ExternalEvidenceExecution> {
  throwIfCeoRequestAborted(signal)
  const failures: string[] = []
  const queries = plan.queries.slice(0, plan.maxSearchQueries).map((query) => querySuffix ? { ...query, query: `${query.query} ${querySuffix}` } : query)
  const selectedSearchTool = plan.selectedTool && QUERY_SEARCH_TOOL_IDS.has(plan.selectedTool) ? plan.selectedTool : 'web_search'
  assertRuntimeIntegration({ capability: 'evidence_acquisition', owner: 'ceo-evidence-planner + ceo-evidence-executor', runtimeEntryPoint: 'src/app/api/agent/route.ts', verified: true })
  const searchResults = await Promise.all(queries.map(async (query) => {
    try { const outcome = await executeSearch(query, selectedSearchTool, signal); recordToolOutcome({ toolId: selectedSearchTool, capability: plan.capability ?? 'research', status: outcome.sources.length > 0 ? 'succeeded' : 'partial' }); return outcome }
    catch (error) { throwIfCeoRequestAborted(signal); recordToolOutcome({ toolId: selectedSearchTool, capability: plan.capability ?? 'research', status: 'failed' }); failures.push(`${query.id}: ${error instanceof Error ? error.message : String(error)}`); return { result: { ok: false, preview: '', result: '' } as ToolResult, sources: [] } }
  }))
  throwIfCeoRequestAborted(signal)
  const searchSources = searchResults.flatMap((entry) => entry.sources)
  const discoveredUrls = [...new Set(searchSources.map((source) => source.url))]
  const pagesToRead = discoveredUrls.filter((url) => sourceTierForUrl(url) <= 2).slice(0, plan.maxPageReads)
  let pageSources: EvidenceSource[] = []
  if (pagesToRead.length) try { pageSources = await readPages(pagesToRead, signal) } catch (error) { throwIfCeoRequestAborted(signal); failures.push(`page_reader: ${error instanceof Error ? error.message : String(error)}`) }
  let secSources: EvidenceSource[] = []
  let marketDataSources: EvidenceSource[] = []
  const secSourceByTicker = new Map<string, EvidenceSource>()
  if (plan.profile === 'public_equity') {
    const tickers = [...new Set(plan.queries.map((query) => query.ticker).filter((ticker): ticker is string => Boolean(ticker)))]
    const tickerResults = await Promise.all(tickers.map(async (ticker) => {
      const [secSource, marketSource] = await Promise.all([
        fetchSecSource(ticker, signal).catch((error) => { throwIfCeoRequestAborted(signal); failures.push(`SEC ${ticker}: ${error instanceof Error ? error.message : String(error)}`); return null }),
        // See fetchMarketDataSource's own comment: this is a dedicated, symbol-keyed dispatch path
        // for real market data (price/quote), independent of the free-text search-query dispatch
        // below -- not a substitute for it, purely additional evidence coverage.
        fetchMarketDataSource(ticker, signal).catch((error) => { throwIfCeoRequestAborted(signal); failures.push(`market-data ${ticker}: ${error instanceof Error ? error.message : String(error)}`); return null }),
      ])
      return { ticker, secSource, marketSource }
    }))
    for (const { ticker, secSource, marketSource } of tickerResults) {
      if (secSource) { secSources.push(secSource); secSourceByTicker.set(ticker, secSource) }
      if (marketSource) marketDataSources.push(marketSource)
    }
  }
  throwIfCeoRequestAborted(signal)
  const bundle = buildEvidenceBundle({ profile: plan.profile, operation: plan.operation, sources: [...secSources, ...marketDataSources, ...pageSources, ...searchSources], scope: 'external_web', minimumSources: plan.minimumSources, minimumTierOneSources: plan.profile === 'public_equity' ? 1 : 0 })
  // Deep-audit fix (P0, 2026-09-13): cross-turn claim ledger. Each ticker's freshly fetched SEC source is
  // checked against claims verified in an earlier, separate turn/conversation (lookupRecentVerifiedClaims
  // -- see ceo-claim-ledger.ts), and any genuine disagreement is appended to the bundle's contradictions
  // alongside this turn's own intra-bundle ones. This turn's SEC source is then recorded as the new
  // verified claim for future turns to check against. Both steps fail open (never throw) and run only for
  // the unambiguous, one-source-per-ticker SEC data -- never for pooled multi-ticker search/page sources.
  let finalBundle = bundle
  if (secSourceByTicker.size) {
    const crossTurnRecords = (await Promise.all([...secSourceByTicker.entries()].map(async ([ticker, source]) => {
      const priorClaims = await lookupRecentVerifiedClaims(ticker, DEFAULT_CROSS_TURN_CLAIM_MAX_AGE_MS)
      const records = crossTurnContradictions(ticker, [source], priorClaims)
      await recordVerifiedClaims({ subject: ticker, sources: [source], contradictions: [] })
      return records
    }))).flat()
    if (crossTurnRecords.length) finalBundle = { ...bundle, contradictions: [...bundle.contradictions, ...crossTurnRecords] }
  }
  // External World Intelligence, part c (2026-09-16): records real co-occurrence (companies genuinely
  // researched/compared together this turn) into the Financial Evidence Graph -- see
  // ceo-evidence-graph.ts. Fails open, same convention as recordVerifiedClaims above.
  await recordEvidenceGraphFromBundle(finalBundle)
  if (plan.profile === 'public_equity' || plan.operation === 'recommend' || plan.operation === 'decide') assertDecisionGradeEvidence({ domain: plan.domain, operation: plan.operation, bundle: finalBundle })
  return { bundle: finalBundle, attemptedQueries: queries.length, successfulQueries: searchResults.filter((entry) => entry.sources.length > 0).length, pageReads: pageSources.length, secSources: secSources.length, marketDataSources: marketDataSources.length, failures }
}
export async function executeExternalEvidencePlan(plan: ExternalEvidencePlan, signal = getCeoCancellationSignal()): Promise<ExternalEvidenceExecution> { return executeOnce(plan, '', signal) }
export async function recoverExternalEvidencePlan(plan: ExternalEvidencePlan, signal = getCeoCancellationSignal()): Promise<ExternalEvidenceExecution> {
  const equityRecovery = plan.domain === 'public_equity' || plan.profile === 'public_equity'
  if (!equityRecovery) {
    return executeOnce({ ...plan, maxSearchQueries: Math.min(plan.maxSearchQueries, 4), maxPageReads: Math.min(plan.maxPageReads, 3) }, 'official primary source filing', signal)
  }

  // Equity recovery must acquire fresh evidence rather than asking another model to rewrite the same
  // unsupported answer. Preserve market/financial/risk coverage first, add targeted recent-news queries,
  // then retain filings/comparison within a bounded search budget.
  const tickers = [...new Set(plan.queries.map((query) => query.ticker).filter((ticker): ticker is string => Boolean(ticker)))]
  const newsQueries: EvidenceQuery[] = tickers.map((ticker) => ({
    id: `${ticker.toLowerCase()}-news-recovery`,
    ticker,
    purpose: 'news',
    sourcePreference: 'web',
    recencyDays: 14,
    query: `${ticker} latest news recent developments company update earnings guidance`,
  }))
  const broad = plan.queries.filter((query) => query.purpose === 'market' || query.purpose === 'financials' || query.purpose === 'risks')
  const durable = plan.queries.filter((query) => query.purpose === 'filing' || query.purpose === 'comparison')
  const genericNewsRecovery: EvidenceQuery[] = tickers.length === 0 && plan.queries.length > 0
    ? [{ id: 'equity-news-recovery', purpose: 'news', sourcePreference: 'web', recencyDays: 14, query: `${plan.queries[0].query} latest news recent developments company update earnings guidance` }]
    : []
  const recoveryQueries = [...broad, ...newsQueries, ...genericNewsRecovery, ...durable]
  return executeOnce({
    ...plan,
    profile: 'public_equity',
    evidenceClass: 'external_web',
    queries: recoveryQueries,
    maxSearchQueries: Math.min(recoveryQueries.length, 16),
    maxPageReads: Math.min(Math.max(plan.maxPageReads, 4), 6),
  }, '', signal)
}