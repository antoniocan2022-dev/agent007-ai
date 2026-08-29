import { dispatchTool, type ToolContext, type ToolResult } from './tools'
import { buildEvidenceBundle, createEvidenceSource, type EvidenceSource, sourceTierForUrl, type EvidenceSourceType } from './ceo-evidence-bundle'
import type { EvidenceProfile } from './ceo-cognitive-contract'
import type { ExternalEvidencePlan, EvidenceQuery } from './ceo-evidence-planner'

export interface ExternalEvidenceExecution { bundle: ReturnType<typeof buildEvidenceBundle>; attemptedQueries: number; successfulQueries: number; pageReads: number; secSources: number; failures: string[] }
type SecTickerMap = Record<string, { cik_str: number; title: string; ticker: string }>
let cachedSecTickers: { loadedAt: number; value: SecTickerMap } | null = null
const SEC_TICKER_TTL_MS = 6 * 60 * 60 * 1000
const DEFAULT_SEC_UA = 'Agent007-AI research/1.0'
function toolContext(): ToolContext { return { attachments: [], language: 'en' } }
async function dispatch(name: string, args: Record<string, unknown>): Promise<ToolResult> { return dispatchTool(name, args, toolContext()) }
async function fetchJson<T>(url: string): Promise<T> { const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': process.env.SEC_USER_AGENT?.trim() || DEFAULT_SEC_UA }, redirect: 'follow', signal: AbortSignal.timeout(12000) }); if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`); return response.json() as Promise<T> }
async function getSecTickerMap(): Promise<SecTickerMap> { if (cachedSecTickers && Date.now() - cachedSecTickers.loadedAt < SEC_TICKER_TTL_MS) return cachedSecTickers.value; const data = await fetchJson<SecTickerMap>('https://www.sec.gov/files/company_tickers.json'); const normalized: SecTickerMap = {}; for (const item of Object.values(data)) { const ticker = String(item.ticker ?? '').trim().toUpperCase(); if (ticker) normalized[ticker] = item } cachedSecTickers = { loadedAt: Date.now(), value: normalized }; return normalized }
interface SecFactUnit { fy?: number; fp?: string; form?: string; filed?: string; val?: number; frame?: string }
interface SecFacts { entityName?: string; facts?: Record<string, Record<string, { units?: Record<string, SecFactUnit[]> }>> }
const FACT_CANDIDATES: Array<{ key: string; label: string }> = [
  { key: 'RevenueFromContractWithCustomerExcludingAssessedTax', label: 'Revenue' }, { key: 'Revenues', label: 'Revenue' }, { key: 'SalesRevenueNet', label: 'Sales' },
  { key: 'CashAndCashEquivalentsAtCarryingValue', label: 'Cash' }, { key: 'Assets', label: 'Assets' }, { key: 'Liabilities', label: 'Liabilities' },
  { key: 'LongTermDebtCurrent', label: 'Current debt' }, { key: 'LongTermDebtNoncurrent', label: 'Long-term debt' }, { key: 'NetIncomeLoss', label: 'Net income' },
]
function latestUnit(units?: Record<string, SecFactUnit[]>): SecFactUnit | null { const candidates = Object.values(units ?? {}).flat().filter((item) => typeof item.val === 'number' && item.filed); candidates.sort((a, b) => String(b.filed).localeCompare(String(a.filed))); return candidates[0] ?? null }
async function fetchSecSource(ticker: string): Promise<EvidenceSource | null> {
  const map = await getSecTickerMap(), item = map[ticker.toUpperCase()]; if (!item?.cik_str) return null
  const cik = String(item.cik_str).padStart(10, '0'), url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, payload = await fetchJson<SecFacts>(url), usGaap = payload.facts?.['us-gaap'] ?? {}
  const lines: string[] = [`SEC Company Facts for ${ticker.toUpperCase()} — ${payload.entityName ?? item.title}`]; let latestFiled: string | undefined
  for (const candidate of FACT_CANDIDATES) { const fact = latestUnit(usGaap[candidate.key]?.units); if (!fact) continue; if (fact.filed && (!latestFiled || fact.filed > latestFiled)) latestFiled = fact.filed; lines.push(`${candidate.label}: ${fact.val} (${fact.form ?? 'filing'}, filed ${fact.filed}${fact.fp ? `, ${fact.fp}` : ''})`) }
  if (lines.length === 1) return null
  const publishedAt = latestFiled ? Date.parse(`${latestFiled}T00:00:00Z`) : undefined
  return createEvidenceSource({ url, title: `${ticker.toUpperCase()} SEC Company Facts`, sourceType: 'sec_companyfacts', sourceTier: 1, retrievedAt: Date.now(), publishedAt: Number.isFinite(publishedAt) ? publishedAt : undefined, text: lines.join('\n'), id: `SEC-${ticker.toUpperCase()}` })
}
function cacheBypassArgs(args: Record<string, unknown>): Record<string, unknown> { return { ...args, evidence_refresh_nonce: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}` } }
function urlsFromSearchResult(result: ToolResult): string[] { return [...result.result.matchAll(/URL:\s*(https?:\/\/[^\s]+)/gi)].map((match) => match[1]) }
function titleFromSearchResult(result: ToolResult, url: string): string { const line = result.result.split('\n').find((candidate) => candidate.includes(url)); return line ? line.replace(/^[0-9]+\.\s*/, '').replace(/\*\*/g, '').trim() || url : url }

/** Search-query preference never establishes source authority by itself. */
export function deriveSearchSourceType(url: string, query: EvidenceQuery): EvidenceSourceType {
  if (query.sourcePreference === 'market') return sourceTierForUrl(url) <= 2 ? 'market_data' : 'web'
  if (query.sourcePreference === 'news') return sourceTierForUrl(url) === 3 ? 'news' : 'web'
  // Company IR requires independent identity verification; search results alone
  // are not enough to establish that identity, so remain generic web evidence.
  return 'web'
}
async function executeSearch(query: EvidenceQuery): Promise<{ result: ToolResult; sources: EvidenceSource[] }> {
  const result = await dispatch('web_search', cacheBypassArgs({ query: query.query, num: 6, recency_days: query.recencyDays })); if (!result.ok) return { result, sources: [] }
  const retrievedAt = Date.now(), urls = urlsFromSearchResult(result).slice(0, 6)
  return { result, sources: urls.map((url, index) => createEvidenceSource({ url, title: titleFromSearchResult(result, url), sourceType: deriveSearchSourceType(url, query), sourceTier: sourceTierForUrl(url), retrievedAt, text: result.result.slice(0, 6000), id: `${query.id}-${index + 1}` })) }
}
async function readPages(urls: string[]): Promise<EvidenceSource[]> {
  const outputs = await Promise.all(urls.map(async (url, index) => { const result = await dispatch('page_reader', cacheBypassArgs({ url })); if (!result.ok) return null; return createEvidenceSource({ url, title: result.preview.replace(/^Read page(?: \(via fallback\))?:\s*/i, '').slice(0, 240) || url, sourceType: 'page', sourceTier: sourceTierForUrl(url), retrievedAt: Date.now(), text: result.result, id: `PAGE-${index + 1}` }) }))
  return outputs.filter((source): source is EvidenceSource => source !== null)
}
async function executeOnce(plan: ExternalEvidencePlan, querySuffix = ''): Promise<ExternalEvidenceExecution> {
  const failures: string[] = [], queries = plan.queries.slice(0, plan.maxSearchQueries).map((query) => querySuffix ? { ...query, query: `${query.query} ${querySuffix}` } : query)
  const searchResults = await Promise.all(queries.map(async (query) => { try { return await executeSearch(query) } catch (error) { failures.push(`${query.id}: ${error instanceof Error ? error.message : String(error)}`); return { result: { ok: false, preview: '', result: '' } as ToolResult, sources: [] } } }))
  const searchSources = searchResults.flatMap((entry) => entry.sources), discoveredUrls = [...new Set(searchSources.map((source) => source.url))]
  const pagesToRead = discoveredUrls.filter((url) => sourceTierForUrl(url) <= 2).slice(0, plan.maxPageReads)
  let pageSources: EvidenceSource[] = []
  if (pagesToRead.length) try { pageSources = await readPages(pagesToRead) } catch (error) { failures.push(`page_reader: ${error instanceof Error ? error.message : String(error)}`) }
  let secSources: EvidenceSource[] = []
  if (plan.profile === 'public_equity') {
    const tickers = [...new Set(plan.queries.map((query) => query.ticker).filter((ticker): ticker is string => Boolean(ticker)))]
    const secResults = await Promise.all(tickers.map(async (ticker) => { try { return await fetchSecSource(ticker) } catch (error) { failures.push(`SEC ${ticker}: ${error instanceof Error ? error.message : String(error)}`); return null } }))
    secSources = secResults.filter((source): source is EvidenceSource => source !== null)
  }
  return { bundle: buildEvidenceBundle({ profile: plan.profile, sources: [...secSources, ...pageSources, ...searchSources], scope: 'external_web', minimumSources: plan.minimumSources, minimumTierOneSources: plan.profile === 'public_equity' ? 1 : 0 }), attemptedQueries: queries.length, successfulQueries: searchResults.filter((entry) => entry.sources.length > 0).length, pageReads: pageSources.length, secSources: secSources.length, failures }
}
export async function executeExternalEvidencePlan(plan: ExternalEvidencePlan): Promise<ExternalEvidenceExecution> { return executeOnce(plan) }
export async function recoverExternalEvidencePlan(plan: ExternalEvidencePlan): Promise<ExternalEvidenceExecution> { return executeOnce({ ...plan, maxSearchQueries: Math.min(plan.maxSearchQueries, 4), maxPageReads: Math.min(plan.maxPageReads, 3) }, 'official primary source filing') }
