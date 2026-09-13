/**
 * Issuer/entity resolution for equity research.
 *
 * Deep-audit fix (P0, 2026-09-13): confirmed by direct investigation that no company-name -> ticker/
 * CIK resolver existed anywhere in the codebase. ceo-evidence-planner.ts's extractEquityTickers only
 * regex-harvests uppercase tokens that already look like tickers straight out of the user's free text --
 * a bare company name with no parenthesized/bare-uppercase ticker token anywhere in the message (e.g.
 * "tell me about Geospace Technologies") resolved to zero tickers, so the equity-specific query plan
 * (market/financials/filing/SEC lookups) never engaged at all; the request silently fell back to a
 * generic 2-query plan while still being held to the full public_equity decision-grade bar.
 *
 * This module resolves ticker AND company-name candidates against SEC's own public ticker/company
 * registry (the same data ceo-evidence-executor.ts already fetches for CIK lookups) -- reusing a real,
 * authoritative, already-integrated data source rather than inventing a new one. All matching logic here
 * is pure and synchronous over an already-fetched map, specifically so it stays fully unit-testable
 * without live network access (this sandbox has no egress to sec.gov -- confirmed directly). Only
 * getSecTickerMap itself does I/O; every resolution function below takes the map as a parameter.
 */
import { throwIfCeoRequestAborted } from './ceo-cancellation'
import { extractEquityTickers } from './ceo-evidence-planner'

export interface IssuerIdentity { ticker: string; cik: string; title: string }
export type IssuerResolutionMethod = 'ticker_exact' | 'name_match' | 'unresolved'
export interface IssuerResolution { query: string; resolved: IssuerIdentity | null; candidates: readonly IssuerIdentity[]; method: IssuerResolutionMethod }

export type SecTickerMap = Record<string, { cik_str: number; title: string; ticker: string }>
let cachedSecTickers: { loadedAt: number; value: SecTickerMap } | null = null
const SEC_TICKER_TTL_MS = 6 * 60 * 60 * 1000
const DEFAULT_SEC_UA = 'Agent007-AI research/1.0'

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  throwIfCeoRequestAborted(signal)
  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': process.env.SEC_USER_AGENT?.trim() || DEFAULT_SEC_UA }, redirect: 'follow', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000) })
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`)
  return response.json() as Promise<T>
}

/** Canonical fetcher for SEC's public ticker/CIK/company-name registry; shared by resolution and evidence acquisition so both use one cached copy. */
export async function getSecTickerMap(signal?: AbortSignal): Promise<SecTickerMap> {
  throwIfCeoRequestAborted(signal)
  if (cachedSecTickers && Date.now() - cachedSecTickers.loadedAt < SEC_TICKER_TTL_MS) return cachedSecTickers.value
  const data = await fetchJson<SecTickerMap>('https://www.sec.gov/files/company_tickers.json', signal)
  const normalized: SecTickerMap = {}
  for (const item of Object.values(data)) { const ticker = String(item.ticker ?? '').trim().toUpperCase(); if (ticker) normalized[ticker] = item }
  cachedSecTickers = { loadedAt: Date.now(), value: normalized }
  return normalized
}

function toIdentity(entry: SecTickerMap[string]): IssuerIdentity { return { ticker: entry.ticker.toUpperCase(), cik: String(entry.cik_str).padStart(10, '0'), title: entry.title } }

export function matchIssuerByTicker(query: string, tickerMap: SecTickerMap): IssuerIdentity | null {
  const ticker = query.trim().toUpperCase()
  if (!/^[A-Z]{1,5}$/.test(ticker)) return null
  const entry = tickerMap[ticker]
  return entry ? toIdentity(entry) : null
}

const COMPANY_SUFFIX_RE = /\b(?:incorporated|corporation|company|limited|holdings?|technolog(?:y|ies)|tech|group|systems?)\b|[.,]/gi
function normalizeName(value: string): string { return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim() }
function coreTokens(name: string): string[] { return normalizeName(name.replace(COMPANY_SUFFIX_RE, ' ')).split(' ').filter((token) => token.length > 0) }

// Small, dependency-free Levenshtein distance -- only ever called on short (<=20 char) company-name
// tokens, so the O(n*m) DP table is negligible; used to absorb genuine typos ("Tecnologies" for
// "Technologies", a single deleted character) without over-matching unrelated words.
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0
  const rows = a.length + 1, cols = b.length + 1
  const table: number[][] = Array.from({ length: rows }, (_, i) => [i, ...Array(cols - 1).fill(0)])
  for (let j = 0; j < cols; j += 1) table[0][j] = j
  for (let i = 1; i < rows; i += 1) for (let j = 1; j < cols; j += 1) table[i][j] = a[i - 1] === b[j - 1] ? table[i - 1][j - 1] : 1 + Math.min(table[i - 1][j], table[i][j - 1], table[i - 1][j - 1])
  return table[rows - 1][cols - 1]
}
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true
  const maxLen = Math.max(a.length, b.length)
  if (maxLen < 4) return false
  const distance = levenshteinDistance(a, b)
  return distance <= (maxLen >= 8 ? 2 : 1)
}
function nameMatchScore(queryTokens: readonly string[], titleTokens: readonly string[]): number {
  if (!queryTokens.length || !titleTokens.length) return 0
  let matched = 0
  for (const queryToken of queryTokens) if (titleTokens.some((titleToken) => tokensMatch(queryToken, titleToken))) matched += 1
  return matched / queryTokens.length
}

/** Fuzzy company-name match against SEC's registered company titles. Never guesses past ambiguity: returns every close match (caller decides whether >1 candidate means "ask, don't assume"). */
export function matchIssuerByName(query: string, tickerMap: SecTickerMap, limit = 3): IssuerIdentity[] {
  const queryTokens = coreTokens(query)
  if (queryTokens.length === 0) return []
  const scored: Array<{ identity: IssuerIdentity; score: number }> = []
  for (const entry of Object.values(tickerMap)) {
    const score = nameMatchScore(queryTokens, coreTokens(entry.title))
    if (score >= 0.75) scored.push({ identity: toIdentity(entry), score })
  }
  scored.sort((a, b) => b.score - a.score)
  const seen = new Set<string>(), results: IssuerIdentity[] = []
  for (const candidate of scored) { if (seen.has(candidate.identity.ticker)) continue; seen.add(candidate.identity.ticker); results.push(candidate.identity); if (results.length >= limit) break }
  return results
}

export function resolveIssuerFromMap(query: string, tickerMap: SecTickerMap): IssuerResolution {
  const byTicker = matchIssuerByTicker(query, tickerMap)
  if (byTicker) return { query, resolved: byTicker, candidates: [byTicker], method: 'ticker_exact' }
  const byName = matchIssuerByName(query, tickerMap)
  if (byName.length === 1) return { query, resolved: byName[0], candidates: byName, method: 'name_match' }
  if (byName.length > 1) return { query, resolved: null, candidates: byName, method: 'name_match' }
  return { query, resolved: null, candidates: [], method: 'unresolved' }
}

// Runs of 2-4 capitalized words -- deliberately loose (no required "Inc./Corp./Technologies" suffix,
// since that would miss exactly the typo'd suffix case this module exists to catch) because precision
// comes from the fuzzy name-match step against the real registry, not from the harvesting regex.
const COMPANY_NAME_PHRASE_RE = /\b(?:[A-Z][a-zA-Z''&-]*\s+){1,3}[A-Z][a-zA-Z''&-]*\b/g
function harvestCompanyNamePhrases(text: string): string[] {
  const phrases = new Set<string>()
  for (const match of text.matchAll(COMPANY_NAME_PHRASE_RE)) { const phrase = match[0].trim(); if (phrase.split(/\s+/).length >= 2) phrases.add(phrase) }
  return [...phrases].slice(0, 10)
}

/**
 * Resolves every ticker- and company-name-shaped candidate in a research objective against SEC's real
 * registry. Ticker candidates come from the existing, already-stopword-filtered extractEquityTickers
 * (unchanged) and are only kept here if they match a REAL ticker -- closing the false-positive gap where
 * a stopword-surviving token was previously trusted with no validation at all. Company-name phrases are
 * a new, additive candidate source for the case extractEquityTickers structurally cannot cover: a
 * company mentioned by name with no ticker-shaped token anywhere in the message. Pure/synchronous over
 * an already-fetched tickerMap -- no network I/O in this function.
 */
export function resolveEquityIssuers(objective: string, tickerMap: SecTickerMap): IssuerResolution[] {
  const resolutions: IssuerResolution[] = []
  const resolvedTickers = new Set<string>()
  for (const candidate of extractEquityTickers(objective)) {
    const identity = matchIssuerByTicker(candidate, tickerMap)
    if (identity && !resolvedTickers.has(identity.ticker)) { resolvedTickers.add(identity.ticker); resolutions.push({ query: candidate, resolved: identity, candidates: [identity], method: 'ticker_exact' }) }
  }
  for (const phrase of harvestCompanyNamePhrases(objective)) {
    const byName = matchIssuerByName(phrase, tickerMap)
    if (byName.length === 1) { if (!resolvedTickers.has(byName[0].ticker)) { resolvedTickers.add(byName[0].ticker); resolutions.push({ query: phrase, resolved: byName[0], candidates: byName, method: 'name_match' }) } }
    else if (byName.length > 1 && !byName.some((identity) => resolvedTickers.has(identity.ticker))) resolutions.push({ query: phrase, resolved: null, candidates: byName, method: 'name_match' })
  }
  return resolutions
}
