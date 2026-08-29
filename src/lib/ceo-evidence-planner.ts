import type {
  EvidenceClass,
  EvidenceDomain,
  EvidenceOperation,
  EvidenceProfile,
  TemporalScope,
} from './ceo-cognitive-contract'

export interface EvidenceQuery {
  id: string
  query: string
  ticker?: string
  purpose: 'identity' | 'market' | 'financials' | 'filing' | 'news' | 'risks' | 'comparison'
  sourcePreference: 'sec' | 'company' | 'market' | 'web'
  recencyDays?: number
}

export interface ExternalEvidencePlan {
  profile: EvidenceProfile
  evidenceClass: EvidenceClass
  domain: EvidenceDomain
  operation: EvidenceOperation
  temporalScope: TemporalScope
  minimumSources: number
  maxSearchQueries: number
  maxPageReads: number
  queries: EvidenceQuery[]
}

const TICKER_STOPWORDS = new Set([
  'THE', 'AND', 'WITH', 'THIS', 'THAT', 'THOSE', 'STOCK', 'STOCKS', 'SHARE', 'SHARES',
  'MARKET', 'PRICE', 'TARGET', 'BUY', 'SELL', 'HOLD', 'CASH', 'FLOW', 'EPS', 'SEC', 'FILING',
])

/** Extract explicit market identifiers first; conservative by design so that
 * internal words like "stock of spare parts" are not promoted to securities. */
export function extractEquityTickers(text: string): string[] {
  const matches = new Set<string>()
  for (const match of text.matchAll(/\(([A-Z]{1,5})\)/g)) matches.add(match[1])
  for (const match of text.matchAll(/\b([A-Z]{2,5})\b/g)) {
    const candidate = match[1]
    if (!TICKER_STOPWORDS.has(candidate)) matches.add(candidate)
  }
  return [...matches].slice(0, 8)
}

function equityQueries(tickers: string[]): EvidenceQuery[] {
  const queries: EvidenceQuery[] = []
  for (const ticker of tickers) {
    queries.push({
      id: `${ticker.toLowerCase()}-market`, ticker, purpose: 'market', sourcePreference: 'market', recencyDays: 7,
      query: `${ticker} stock price market cap valuation latest`,
    })
    queries.push({
      id: `${ticker.toLowerCase()}-financials`, ticker, purpose: 'financials', sourcePreference: 'company', recencyDays: 120,
      query: `${ticker} latest earnings revenue cash debt cash flow financial results`,
    })
    queries.push({
      id: `${ticker.toLowerCase()}-filing`, ticker, purpose: 'filing', sourcePreference: 'sec', recencyDays: 180,
      query: `${ticker} SEC 10-K 10-Q latest filing risks outlook`,
    })
  }
  if (tickers.length >= 2) {
    queries.push({
      id: 'equity-comparison', purpose: 'comparison', sourcePreference: 'web', recencyDays: 30,
      query: `${tickers.slice(0, 4).join(' vs ')} comparison valuation financial strength risks`,
    })
  }
  return queries
}

export function buildExternalEvidencePlan(input: {
  objective: string
  evidenceClass: EvidenceClass
  domain: EvidenceDomain
  operation: EvidenceOperation
  temporalScope: TemporalScope
  evidenceProfile: EvidenceProfile
}): ExternalEvidencePlan {
  if (input.domain === 'public_equity' && input.evidenceProfile === 'public_equity') {
    const tickers = extractEquityTickers(input.objective)
    const queries = equityQueries(tickers)
    if (queries.length > 0) {
      return {
        profile: 'public_equity',
        evidenceClass: input.evidenceClass,
        domain: input.domain,
        operation: input.operation,
        temporalScope: input.temporalScope,
        minimumSources: Math.max(3, Math.min(6, tickers.length * 2)),
        maxSearchQueries: Math.min(8, queries.length),
        maxPageReads: Math.max(2, Math.min(4, tickers.length * 2)),
        queries: queries.slice(0, 8),
      }
    }
  }

  const genericQuery = input.objective.slice(0, 500)
  return {
    profile: input.evidenceProfile === 'none' ? 'general_research' : input.evidenceProfile,
    evidenceClass: input.evidenceClass,
    domain: input.domain,
    operation: input.operation,
    temporalScope: input.temporalScope,
    minimumSources: 2,
    maxSearchQueries: 2,
    maxPageReads: 2,
    queries: [
      { id: 'general-1', query: genericQuery, purpose: 'identity', sourcePreference: 'web', recencyDays: input.temporalScope === 'current' ? 7 : 30 },
      { id: 'general-2', query: `${genericQuery} official source`, purpose: 'filing', sourcePreference: 'company', recencyDays: 30 },
    ],
  }
}