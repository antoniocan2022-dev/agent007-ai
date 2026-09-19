import { deriveEvidenceProfile } from './ceo-cognitive-contract'
import { assertCeoEvidenceContractInvariant, deriveEvidenceProfile, normalizeCeoEvidenceContract } from './ceo-cognitive-contract'
import type { EvidenceClass, EvidenceDomain, EvidenceOperation, EvidenceProfile, TemporalScope, CeoExecutionContract } from './ceo-cognitive-contract'
import { selectCeoTool } from './ceo-tool-selection'
// Type-only: ceo-issuer-resolution.ts imports extractEquityTickers (a real value) FROM this file, so
// this import must stay type-only to avoid a runtime circular dependency -- it's erased at compile time.
import type { IssuerResolution } from './ceo-issuer-resolution'

export interface EvidenceQuery { id: string; query: string; ticker?: string; purpose: 'identity' | 'market' | 'financials' | 'filing' | 'news' | 'risks' | 'comparison'; sourcePreference: 'sec' | 'company' | 'market' | 'web'; recencyDays?: number }
export interface ExternalEvidencePlan { profile: EvidenceProfile; evidenceClass: EvidenceClass; domain: EvidenceDomain; operation: EvidenceOperation; temporalScope: TemporalScope; minimumSources: number; maxSearchQueries: number; maxPageReads: number; queries: EvidenceQuery[]; capability: string; selectedTool?: string; toolSelectionScore?: number; executionStrategy: string; evidenceRequirements: string[]; resolvedIssuers?: readonly IssuerResolution[] }
const TICKER_STOPWORDS = new Set(['THE','AND','WITH','THIS','THAT','THOSE','STOCK','STOCKS','SHARE','SHARES','MARKET','PRICE','TARGET','BUY','SELL','HOLD','CASH','FLOW','EPS','SEC','FILING','CEO','CFO','COO','CTO','CIO','CMO','CPO','CHRO','CRO','VP','SVP','EVP','HR','IR','AI','API','CI','CD','DB','SQL','URL','HTTP','HTTPS','SSE','UI','UX','QA','RCA','KPI'])
export function extractEquityTickers(text: string): string[] { const matches = new Set<string>(); for (const match of text.matchAll(/\(([A-Z]{1,5})\)/g)) if (!TICKER_STOPWORDS.has(match[1])) matches.add(match[1]); for (const match of text.matchAll(/\b([A-Z]{2,5})\b/g)) if (!TICKER_STOPWORDS.has(match[1])) matches.add(match[1]); return [...matches].slice(0, 8) }
// Fresh-audit fix: 'risks' has always been a valid EvidenceQuery purpose (see the type above) but
// nothing ever generated one -- equity research here always searched FOR the investment case
// (market data, earnings, the filing itself) and never explicitly AGAINST it. A deliberately
// adversarial query -- debt, dilution, going-concern language, lawsuits, customer concentration,
// insider selling, regulatory trouble -- closes that gap as one more EvidenceQuery in the plan.
//
// Fresh-audit fix (round 2): the queries used to be emitted ticker-by-ticker (all 4 of ticker 1's
// queries, then all 4 of ticker 2's, ...), so a hard cap on the plan below silently dropped every
// query -- risks included -- for whichever tickers came last once 3+ tickers were requested. Ordered
// by purpose-round instead (every ticker's market query, then every ticker's financials query, then
// every ticker's risks query, before any ticker's filing query) so a tight cap degrades breadth-first:
// every requested ticker keeps its risks coverage, which is the entire point of this purpose existing.
function equityQueries(tickers: string[]): EvidenceQuery[] {
  const perTicker = new Map<string, Record<'market' | 'financials' | 'risks' | 'filing', EvidenceQuery>>()
  for (const ticker of tickers) {
    const lower = ticker.toLowerCase()
    perTicker.set(ticker, {
      market: { id: `${lower}-market`, ticker, purpose: 'market', sourcePreference: 'market', recencyDays: 7, query: `${ticker} stock price market cap valuation latest` },
      financials: { id: `${lower}-financials`, ticker, purpose: 'financials', sourcePreference: 'company', recencyDays: 120, query: `${ticker} latest earnings revenue cash debt cash flow financial results` },
      risks: { id: `${lower}-risks`, ticker, purpose: 'risks', sourcePreference: 'web', recencyDays: 180, query: `${ticker} debt concerns dilution going concern lawsuit customer concentration insider selling regulatory problems` },
      filing: { id: `${lower}-filing`, ticker, purpose: 'filing', sourcePreference: 'sec', recencyDays: 180, query: `${ticker} SEC 10-K 10-Q latest filing risks outlook` },
    })
  }
  const rounds: Array<'market' | 'financials' | 'risks' | 'filing'> = ['market', 'financials', 'risks', 'filing']
  const queries: EvidenceQuery[] = []
  for (const purpose of rounds) for (const ticker of tickers) queries.push(perTicker.get(ticker)![purpose])
  if (tickers.length >= 2) queries.push({ id: 'equity-comparison', purpose: 'comparison', sourcePreference: 'web', recencyDays: 30, query: `${tickers.slice(0, 4).join(' vs ')} comparison valuation financial strength risks` })
  return queries
}
function capabilityContract(input: { evidenceClass: EvidenceClass; domain: EvidenceDomain; operation: EvidenceOperation; temporalScope: TemporalScope; evidenceProfile: EvidenceProfile }): CeoExecutionContract { return { intent: 'research', evidenceClass: input.evidenceClass, domain: input.domain, operation: input.operation, temporalScope: input.temporalScope, evidenceProfile: input.evidenceProfile, evidenceRequirement: input.evidenceClass === 'external_web' ? 'external_web' : 'multi_source', executionRequirement: 'one_tool', orchestrationOwner: 'ceo_lifecycle', maxTurns: 4, maxRecoveries: 1, latencyBudgetMs: 30000, toolRequired: true, subagentsRequired: false, reason: 'Evidence acquisition capability selection' } }
export function buildExternalEvidencePlan(input: { objective: string; evidenceClass: EvidenceClass; domain: EvidenceDomain; operation: EvidenceOperation; temporalScope: TemporalScope; evidenceProfile: EvidenceProfile; resolvedIssuers?: readonly IssuerResolution[] }): ExternalEvidencePlan {
  // Domain is authoritative: callers cannot accidentally downgrade public_equity to generic research by passing a stale profile.
  const effectiveEvidenceProfile = deriveEvidenceProfile(input.domain)
  const effectiveInput = effectiveEvidenceProfile === 'none' ? input : { ...input, evidenceProfile: effectiveEvidenceProfile }
  const normalizedContract = normalizeCeoEvidenceContract(capabilityContract(effectiveInput))
  assertCeoEvidenceContractInvariant(normalizedContract)
  const selection = selectCeoTool(normalizedContract, { requiresFreshness: effectiveInput.temporalScope === 'current' })
  const selectionMeta = { capability: selection.capability, selectedTool: selection.selected?.id, toolSelectionScore: selection.selected ? selection.scores[selection.selected.id]?.total : undefined, executionStrategy: selection.executionStrategy, evidenceRequirements: selection.evidenceRequirements }
  if (effectiveInput.domain === 'public_equity') {
    // Deep-audit fix (P0, 2026-09-13): extractEquityTickers alone requires a ticker-shaped token
    // (parenthesized or bare-uppercase) somewhere in the raw text -- a company mentioned only by name
    // ("Geospace Technologies", no "(GEOS)" anywhere) resolved to zero tickers, so this whole
    // equity-specific branch never engaged and the request silently fell back to the generic 2-query
    // path below while still being held to the full public_equity evidence bar. resolvedIssuers (built
    // by the caller via ceo-issuer-resolution.ts's resolveEquityIssuers, since that needs a live SEC
    // ticker-map fetch this pure/synchronous planner deliberately doesn't do itself) supplies tickers
    // resolved from company names too -- additive to, never a replacement for, the raw regex harvest.
    const resolvedTickers = (effectiveInput.resolvedIssuers ?? []).flatMap((resolution) => resolution.resolved ? [resolution.resolved.ticker] : [])
    const tickers = [...new Set([...extractEquityTickers(effectiveInput.objective), ...resolvedTickers])]
    const queries = equityQueries(tickers)
    // Fresh-audit fix (round 2): a flat cap of 10 was still too tight once 3+ tickers were requested
    // (up to 8 tickers are allowed, at 4 queries each = 32, +1 comparison). equityQueries() above now
    // orders queries by purpose-round (market/financials/risks for every ticker before any ticker's
    // filing), so a cap of 24 = 3 rounds x the 8-ticker max guarantees every requested ticker keeps its
    // market, financials, AND risks queries regardless of how many tickers are in play -- only the
    // filing and cross-ticker comparison queries degrade under extreme multi-ticker requests.
    const genericQuery = effectiveInput.objective.slice(0, 500)
    const queryCap = Math.min(24, queries.length)
    if (queries.length > 0) return { profile: 'public_equity', evidenceClass: effectiveInput.evidenceClass, domain: effectiveInput.domain, operation: effectiveInput.operation, temporalScope: effectiveInput.temporalScope, minimumSources: Math.max(3, Math.min(6, tickers.length * 2)), maxSearchQueries: queryCap, maxPageReads: Math.max(2, Math.min(4, tickers.length * 2)), queries: queries.slice(0, queryCap), resolvedIssuers: effectiveInput.resolvedIssuers, ...selectionMeta }
    const fallbackQueries: EvidenceQuery[] = [
      { id: 'equity-overview', purpose: 'identity', sourcePreference: 'web', recencyDays: 14, query: genericQuery },
      { id: 'equity-financials', purpose: 'financials', sourcePreference: 'company', recencyDays: 120, query: genericQuery + ' financial results revenue cash debt' },
      { id: 'equity-filing', purpose: 'filing', sourcePreference: 'sec', recencyDays: 180, query: genericQuery + ' SEC latest filing risks outlook' },
    ]
    return {
      profile: 'public_equity',
      evidenceClass: effectiveInput.evidenceClass,
      domain: effectiveInput.domain,
      operation: effectiveInput.operation,
      temporalScope: effectiveInput.temporalScope,
      minimumSources: 3,
      maxSearchQueries: fallbackQueries.length,
      maxPageReads: 3,
      queries: fallbackQueries,
      resolvedIssuers: effectiveInput.resolvedIssuers,
      ...selectionMeta,
    }
  }
  const genericQuery = effectiveInput.objective.slice(0, 500)
  return { profile: effectiveInput.evidenceProfile === 'none' ? 'general_research' : effectiveInput.evidenceProfile, evidenceClass: effectiveInput.evidenceClass, domain: effectiveInput.domain, operation: effectiveInput.operation, temporalScope: effectiveInput.temporalScope, minimumSources: 2, maxSearchQueries: 2, maxPageReads: 2, queries: [{ id: 'general-1', query: genericQuery, purpose: 'identity', sourcePreference: 'web', recencyDays: effectiveInput.temporalScope === 'current' ? 7 : 30 }, { id: 'general-2', query: `${genericQuery} official source`, purpose: 'filing', sourcePreference: 'company', recencyDays: 30 }], resolvedIssuers: effectiveInput.resolvedIssuers, ...selectionMeta }
}