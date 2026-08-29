import type { EvidenceFreshness, EvidenceProfile, EvidenceScope } from './ceo-cognitive-contract'

export type EvidenceSourceType = 'sec_companyfacts' | 'sec_filing' | 'company_ir' | 'market_data' | 'news' | 'web' | 'page'

export interface EvidenceProvenance {
  url: string
  title: string
  sourceType: EvidenceSourceType
  sourceTier: 1 | 2 | 3 | 4
  retrievedAt: number
  publishedAt?: number
}

export interface EvidenceSource {
  id: string
  url: string
  title: string
  sourceType: EvidenceSourceType
  sourceTier: 1 | 2 | 3 | 4
  retrievedAt: number
  publishedAt?: number
  sourceAgeMs?: number
  text: string
  claimCandidates: string[]
  provenance: EvidenceProvenance[]
}

export interface EvidenceClaimCandidate {
  claim: string
  sourceIds: string[]
  sourceUrls: string[]
}

export interface EvidenceBundle {
  scope: EvidenceScope
  profile: EvidenceProfile
  createdAt: number
  sources: EvidenceSource[]
  claims: EvidenceClaimCandidate[]
  freshness: EvidenceFreshness
  contextText: string
}

const PROFILE_MAX_AGE_MS: Record<EvidenceProfile, number> = {
  none: 0,
  general_research: 60 * 60 * 1000,
  public_equity: 15 * 60 * 1000,
  market_current: 15 * 60 * 1000,
  news_recent: 30 * 60 * 1000,
  competitor_research: 6 * 60 * 60 * 1000,
  business_due_diligence: 24 * 60 * 60 * 1000,
}

function stableSourceId(url: string, index: number): string {
  let hash = 2166136261
  for (let i = 0; i < url.length; i += 1) hash = Math.imul(hash ^ url.charCodeAt(i), 16777619)
  return `S${index + 1}-${(hash >>> 0).toString(16)}`
}

function extractClaimCandidates(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 25 && /\b(?:revenue|sales|earnings|eps|cash|debt|assets|liabilities|income|loss|margin|guidance|backlog|price|market cap|valuation|shares)\b/i.test(line))
    .slice(0, 20)
}

/**
 * Conservative source classification. Tier 1 is reserved for clearly
 * authoritative regulatory endpoints; company IR is promoted by the executor
 * only when its identity is explicitly established, not merely because a
 * hostname contains words such as "investor" or "ir".
 */
export function sourceTierForUrl(url: string): 1 | 2 | 3 | 4 {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host === 'sec.gov' || host.endsWith('.sec.gov')) return 1
    if (host === 'data.sec.gov') return 1
    if (host === 'nasdaq.com' || host.endsWith('.nasdaq.com') || host === 'nyse.com' || host.endsWith('.nyse.com') || host === 'stockanalysis.com' || host.endsWith('.stockanalysis.com')) return 2
    if (host === 'reuters.com' || host.endsWith('.reuters.com') || host === 'bloomberg.com' || host.endsWith('.bloomberg.com') || host === 'wsj.com' || host.endsWith('.wsj.com') || host === 'cnbc.com' || host.endsWith('.cnbc.com')) return 3
  } catch {
    return 4
  }
  return 4
}

export function createEvidenceSource(input: {
  url: string
  title: string
  sourceType: EvidenceSourceType
  sourceTier?: 1 | 2 | 3 | 4
  retrievedAt?: number
  publishedAt?: number
  text: string
  id?: string
}): EvidenceSource {
  const retrievedAt = input.retrievedAt ?? Date.now()
  const sourceTier = input.sourceTier ?? sourceTierForUrl(input.url)
  const cleanText = input.text.trim().slice(0, 12000)
  return {
    id: input.id ?? stableSourceId(input.url, 0),
    url: input.url,
    title: input.title.trim() || input.url,
    sourceType: input.sourceType,
    sourceTier,
    retrievedAt,
    publishedAt: input.publishedAt,
    sourceAgeMs: input.publishedAt ? Math.max(0, retrievedAt - input.publishedAt) : undefined,
    text: cleanText,
    claimCandidates: extractClaimCandidates(cleanText),
    provenance: [{
      url: input.url,
      title: input.title.trim() || input.url,
      sourceType: input.sourceType,
      sourceTier,
      retrievedAt,
      publishedAt: input.publishedAt,
    }],
  }
}

export function buildEvidenceBundle(input: {
  profile: EvidenceProfile
  sources: EvidenceSource[]
  scope?: EvidenceScope
}): EvidenceBundle {
  const createdAt = Date.now()
  const deduped = new Map<string, EvidenceSource>()
  input.sources.forEach((source, index) => {
    const normalized = source.id.startsWith('S1-') && input.sources.length > 1
      ? { ...source, id: stableSourceId(source.url, index) }
      : source
    if (!deduped.has(normalized.url)) deduped.set(normalized.url, normalized)
  })
  const sources = [...deduped.values()]
  const claims: EvidenceClaimCandidate[] = []
  for (const source of sources) {
    for (const claim of source.claimCandidates.slice(0, 12)) {
      claims.push({ claim, sourceIds: [source.id], sourceUrls: [source.url] })
    }
  }
  const observedAt = sources.reduce((latest, source) => Math.max(latest, source.retrievedAt), createdAt)
  const profileMaxAge = PROFILE_MAX_AGE_MS[input.profile]
  const contextText = sources
    .map((source) => `[${source.id}] ${source.title}\nURL: ${source.url}\nTier: ${source.sourceTier}\nRetrieved: ${new Date(source.retrievedAt).toISOString()}${source.publishedAt ? `\nPublished: ${new Date(source.publishedAt).toISOString()}` : ''}\n\n${source.text.slice(0, 2800)}`)
    .join('\n\n---\n\n')
    .slice(0, 16000)

  return {
    scope: input.scope ?? 'external_web',
    profile: input.profile,
    createdAt,
    sources,
    claims,
    freshness: { observedAt, maxAgeMs: profileMaxAge },
    contextText,
  }
}

export function renderEvidenceBundleForPrompt(bundle: EvidenceBundle): string {
  if (!bundle.sources.length) return 'No external evidence was acquired.'
  return [
    `EVIDENCE BUNDLE: ${bundle.profile}`,
    `Observed: ${new Date(bundle.freshness.observedAt).toISOString()}`,
    'Source markers are authoritative. Do not create citations that are not present in this bundle.',
    bundle.contextText,
  ].join('\n\n')
}