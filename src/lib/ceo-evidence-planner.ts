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
// insider selling, regulatory trouble -- closes that gap as one more EvidenceQuery in the plan,
// with no change needed to the scoring/sufficiency logic downstream.
function equityQueries(tickers: string[]): EvidenceQuery[] { const queries: EvidenceQuery[] = []; for (const ticker of tickers) { queries.push({ id: `${ticker.toLowerCase()}-market`, ticker, purpose: 'market', sourcePreference: 'market', recencyDays: 7, query: `${ticker} stock price market cap valuation latest` }); queries.push({ id: `${ticker.toLowerCase()}-financials`, ticker, purpose: 'financials', sourcePreference: 'company', recencyDays: 120, query: `${ticker} latest earnings revenue cash debt cash flow financial results` }); queries.push({ id: `${ticker.toLowerCase()}-filing`, ticker, purpose: 'filing', sourcePreference: 'sec', recencyDays: 180, query: `${ticker} SEC 10-K 10-Q latest filing risks outlook` }); queries.push({ id: `${ticker.toLowerCase()}-risks`, ticker, purpose: 'risks', sourcePreference: 'web', recencyDays: 180, query: `${ticker} debt concerns dilution going concern lawsuit customer concentration insider selling regulatory problems` }) } if (tickers.length >= 2) queries.push({ id: 'equity-comparison', purpose: 'comparison', sourcePreference: 'web', recencyDays: 30, query: `${tickers.slice(0, 4).join(' vs ')} comparison valuation financial strength risks` }); return queries }
function capabilityContract(input: { evidenceClass: EvidenceClass; domain: EvidenceDomain; operation: EvidenceOperation; temporalScope: TemporalScope; evidenceProfile: EvidenceProfile }): CeoExecutionContract { return { intent: 'research', evidenceClass: input.evidenceClass, domain: input.domain, operation: input.operation, temporalScope: input.temporalScope, evidenceProfile: input.evidenceProfile, evidenceRequirement: input.evidenceClass === 'external_web' ? 'external_web' : 'multi_source', executionRequirement: 'one_tool', orchestrationOwner: 'ceo_lifecycle', maxTurns: 4, maxRecoveries: 1, latencyBudgetMs: 30000, toolRequired: true, subagentsRequired: false, reason: 'Evidence acquisition capability selection' } }
export function buildExternalEvidencePlan(input: { objective: string; evidenceClass: EvidenceClass; domain: EvidenceDomain; operation: EvidenceOperation; temporalScope: TemporalScope; evidenceProfile: EvidenceProfile; resolvedIssuers?: readonly IssuerResolution[] }): ExternalEvidencePlan {
  const selection = selectCeoTool(capabilityContract(input), { requiresFreshness: input.temporalScope === 'current' })
  const selectionMeta = { capability: selection.capability, selectedTool: selection.selected?.id, toolSelectionScore: selection.selected ? selection.scores[selection.selected.id]?.total : undefined, executionStrategy: selection.executionStrategy, evidenceRequirements: selection.evidenceRequirements }
  if (input.domain === 'public_equity' && input.evidenceProfile === 'public_equity') {
    // Deep-audit fix (P0, 2026-09-13): extractEquityTickers alone requires a ticker-shaped token
    // (parenthesized or bare-uppercase) somewhere in the raw text -- a company mentioned only by name
    // ("Geospace Technologies", no "(GEOS)" anywhere) resolved to zero tickers, so this whole
    // equity-specific branch never engaged and the request silently fell back to the generic 2-query
    // path below while still being held to the full public_equity evidence bar. resolvedIssuers (built
    // by the caller via ceo-issuer-resolution.ts's resolveEquityIssuers, since that needs a live SEC
    // ticker-map fetch this pure/synchronous planner deliberately doesn't do itself) supplies tickers
    // resolved from company names too -- additive to, never a replacement for, the raw regex harvest.
    const resolvedTickers = (input.resolvedIssuers ?? []).flatMap((resolution) => resolution.resolved ? [resolution.resolved.ticker] : [])
    const tickers = [...new Set([...extractEquityTickers(input.objective), ...resolvedTickers])]
    const queries = equityQueries(tickers)
    // Fresh-audit fix: the cap was 8, tuned for the old 3-queries-per-ticker set. Now that each
    // ticker contributes a 4th (risks) query, 2 tickers alone produce 8 -- crowding out the
    // comparison query entirely. Raised to 10 so the new risks queries don't starve the others.
    if (queries.length > 0) return { profile: 'public_equity', evidenceClass: input.evidenceClass, domain: input.domain, operation: input.operation, temporalScope: input.temporalScope, minimumSources: Math.max(3, Math.min(6, tickers.length * 2)), maxSearchQueries: Math.min(10, queries.length), maxPageReads: Math.max(2, Math.min(4, tickers.length * 2)), queries: queries.slice(0, 10), resolvedIssuers: input.resolvedIssuers, ...selectionMeta }
  }
  const genericQuery = input.objective.slice(0, 500)
  return { profile: input.evidenceProfile === 'none' ? 'general_research' : input.evidenceProfile, evidenceClass: input.evidenceClass, domain: input.domain, operation: input.operation, temporalScope: input.temporalScope, minimumSources: 2, maxSearchQueries: 2, maxPageReads: 2, queries: [{ id: 'general-1', query: genericQuery, purpose: 'identity', sourcePreference: 'web', recencyDays: input.temporalScope === 'current' ? 7 : 30 }, { id: 'general-2', query: `${genericQuery} official source`, purpose: 'filing', sourcePreference: 'company', recencyDays: 30 }], resolvedIssuers: input.resolvedIssuers, ...selectionMeta }
}