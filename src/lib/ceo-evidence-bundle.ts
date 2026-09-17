import type { EvidenceFreshness, EvidenceOperation, EvidenceProfile, EvidenceScope } from './ceo-cognitive-contract'
import type { CeoEvidenceTruthState } from './ceo-system-contract'
import { detectContradictions, renderContradictions, type ContradictionRecord } from './ceo-contradiction-resolver'

export type EvidenceSourceType = 'sec_companyfacts' | 'sec_filing' | 'company_ir' | 'market_data' | 'news' | 'web' | 'page'
export type EvidenceAssessmentState = CeoEvidenceTruthState
// Deep-audit fix (P0, 2026-09-13): publisher/sourceFamily added -- previously EvidenceSource/
// EvidenceProvenance carried no structured notion of who published a source at all, so two URLs from
// e.g. reuters.com and finance.yahoo.com quoting the identical wire story were always counted as two
// fully independent sources everywhere in the pipeline (see ceo-decision-grade-evidence.ts's
// independentSourceFamilyCount). sourceFamily defaults to the registered publisher domain but resolves
// to the underlying wire service (e.g. 'reuters') when one is detected in the source's own text via a
// byline/attribution pattern (see ceo-contradiction-resolver.ts's sibling module for the analogous
// per-metric contradiction detection) -- so re-publications of the same story collapse to one family
// regardless of which domain hosts them.
export interface EvidenceProvenance { url: string; title: string; sourceType: EvidenceSourceType; sourceTier: 1 | 2 | 3 | 4; retrievedAt: number; publishedAt?: number; publisher: string; sourceFamily: string }
// relatedEntities added: previously a source's connection to a specific ticker/company only ever
// existed transiently in the EvidenceQuery that produced it (ceo-evidence-planner.ts's query.ticker)
// and was discarded the moment the source was built -- so a multi-ticker research bundle had no
// structured way to say which evidence was about which company, only prose. Optional and
// best-effort (empty when the producing query had no known entity), never a hard requirement.
export interface EvidenceSource { id: string; url: string; title: string; sourceType: EvidenceSourceType; sourceTier: 1 | 2 | 3 | 4; retrievedAt: number; publishedAt?: number; sourceAgeMs?: number; text: string; claimCandidates: string[]; provenance: EvidenceProvenance[]; publisher: string; sourceFamily: string; relatedEntities?: string[] }
// relatedEntities added alongside EvidenceSource's (union of the contributing sources' entities).
export interface EvidenceClaimCandidate { claim: string; sourceIds: string[]; sourceUrls: string[]; observedAt?: number; verifiedAt?: number; confidence?: number; state?: EvidenceAssessmentState; contradictionSourceIds?: string[]; relatedEntities?: string[] }
// Deep-audit fix (P0, 2026-09-13): operation added so ceo-claim-evidence-gate.ts's post-generation
// fail-closed check can be operation-aware (research vs. recommend/decide), matching
// ceo-decision-grade-evidence.ts's own pre-acquisition split -- optional because most EvidenceBundle
// construction sites (tests, non-equity callers) have no operation to thread through and don't need one.
export interface EvidenceBundle { scope: EvidenceScope; profile: EvidenceProfile; operation?: EvidenceOperation; createdAt: number; sources: EvidenceSource[]; claims: EvidenceClaimCandidate[]; freshness: EvidenceFreshness; contextText: string; sufficient: boolean; contradictions: readonly ContradictionRecord[] }

const PROFILE_MAX_AGE_MS: Record<EvidenceProfile, number> = { none: 0, general_research: 60 * 60 * 1000, public_equity: 15 * 60 * 1000, market_current: 15 * 60 * 1000, news_recent: 30 * 60 * 1000, competitor_research: 6 * 60 * 60 * 1000, business_due_diligence: 24 * 60 * 60 * 1000 }
function canonicalizeUrl(input: string): string { try { const url = new URL(input.trim()); url.hash = ''; for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|ref$|source$)/i.test(key)) url.searchParams.delete(key); return url.toString().replace(/\/$/, '') } catch { return input.trim() } }
function stableSourceId(url: string, index: number): string { let hash = 2166136261; for (let i = 0; i < url.length; i += 1) hash = Math.imul(hash ^ url.charCodeAt(i), 16777619); return `S${index + 1}-${(hash >>> 0).toString(16)}` }
function extractClaimCandidates(text: string): string[] { return text.split(/\n+/).map((line) => line.trim()).filter((line) => line.length >= 25 && /\b(?:revenue|sales|earnings|eps|cash|debt|assets|liabilities|income|loss|margin|guidance|backlog|price|market cap|valuation|shares|regulation|competitor|customer)\b/i.test(line)).slice(0, 20) }
// Fresh-audit fix: this used to recognize only ~10 hardcoded hostnames -- sec.gov for tier 1,
// nasdaq/nyse/stockanalysis for tier 2, reuters/bloomberg/wsj/cnbc for tier 3 -- so every other
// reputable source (Yahoo Finance, Morningstar, the Fed's own FRED domain, the Financial Times,
// AP, MarketWatch, ...) silently fell to tier 4 ("everything else") even though decision-grade
// evidence gating (ceo-decision-grade-evidence.ts) treats tier 1/2 specially. Widened to a
// data-driven table so it stays easy to extend; still deliberately conservative -- only domains
// that are unambiguously either an official government/regulator, a stock exchange or a major,
// long-established financial-news operation get a tier above 4.
const TIER_1_HOSTS = ['sec.gov', 'data.sec.gov', 'fred.stlouisfed.org', 'federalreserve.gov', 'treasury.gov', 'bls.gov', 'census.gov']
const TIER_2_HOSTS = ['nasdaq.com', 'nyse.com', 'stockanalysis.com', 'finance.yahoo.com', 'morningstar.com', 'investing.com']
const TIER_3_HOSTS = ['reuters.com', 'bloomberg.com', 'wsj.com', 'cnbc.com', 'ft.com', 'barrons.com', 'apnews.com', 'marketwatch.com', 'forbes.com', 'businessinsider.com']
function hostMatches(host: string, list: string[]): boolean { return list.some((candidate) => host === candidate || host.endsWith(`.${candidate}`)) }
export function sourceTierForUrl(url: string): 1 | 2 | 3 | 4 { try { const host = new URL(url).hostname.toLowerCase(); if (hostMatches(host, TIER_1_HOSTS)) return 1; if (hostMatches(host, TIER_2_HOSTS)) return 2; if (hostMatches(host, TIER_3_HOSTS)) return 3 } catch { return 4 }; return 4 }
function publisherForUrl(url: string): string { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, '') } catch { return url.trim().toLowerCase() } }
// Deliberately narrow: only recognizes an explicit wire-service byline/attribution actually present in
// the source's own text (e.g. "(Reuters)", "-- Bloomberg", "Source: AP") -- never inferred from the
// hosting domain, since the whole point is to catch a DIFFERENT domain republishing a wire story.
const WIRE_SERVICE_ATTRIBUTION_RE = /\((Reuters|AP|Associated Press|Bloomberg|AFP|Dow Jones|PR Newswire|Business Wire|GlobeNewswire)\)|(?:—|--)\s*(Reuters|AP|Associated Press|Bloomberg|AFP)\b|\b(?:Source|By)\s*:\s*(Reuters|AP|Associated Press|Bloomberg|AFP)\b/i
function sourceFamilyFor(url: string, text: string): string {
  const match = text.match(WIRE_SERVICE_ATTRIBUTION_RE)
  const service = (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim().toLowerCase()
  if (service) return service === 'associated press' ? 'ap' : service.replace(/\s+/g, '_')
  return publisherForUrl(url)
}
export function createEvidenceSource(input: { url: string; title: string; sourceType: EvidenceSourceType; sourceTier?: 1 | 2 | 3 | 4; retrievedAt?: number; publishedAt?: number; text: string; id?: string; relatedEntities?: string[] }): EvidenceSource { const url = canonicalizeUrl(input.url), retrievedAt = input.retrievedAt ?? Date.now(), sourceTier = input.sourceTier ?? sourceTierForUrl(url), cleanText = input.text.trim().slice(0, 12000), publisher = publisherForUrl(url), sourceFamily = sourceFamilyFor(url, cleanText); return { id: input.id ?? stableSourceId(url, 0), url, title: input.title.trim() || url, sourceType: input.sourceType, sourceTier, retrievedAt, publishedAt: input.publishedAt, sourceAgeMs: input.publishedAt ? Math.max(0, retrievedAt - input.publishedAt) : undefined, text: cleanText, claimCandidates: extractClaimCandidates(cleanText), publisher, sourceFamily, relatedEntities: input.relatedEntities ?? [], provenance: [{ url, title: input.title.trim() || url, sourceType: input.sourceType, sourceTier, retrievedAt, publishedAt: input.publishedAt, publisher, sourceFamily }] } }
export function buildEvidenceBundle(input: { profile: EvidenceProfile; operation?: EvidenceOperation; sources: EvidenceSource[]; scope?: EvidenceScope; minimumSources?: number; minimumTierOneSources?: number }): EvidenceBundle {
  const createdAt = Date.now(), deduped = new Map<string, EvidenceSource>()
  input.sources.forEach((source, index) => { const url = canonicalizeUrl(source.url), normalized = { ...source, url, provenance: source.provenance.map((entry) => ({ ...entry, url: canonicalizeUrl(entry.url) })) }; if (!deduped.has(url)) deduped.set(url, { ...normalized, id: stableSourceId(url, index) }) })
  const sources = [...deduped.values()]
  // Deep-audit fix (P0, 2026-09-13): detectContradictions (ceo-contradiction-resolver.ts) is the real
  // detector for the previously-dead contradictionSourceIds field -- run once here, over the deduped
  // source set, and used below to actually populate it on any claim candidate whose own text references
  // the same metric a detected contradiction covers (a simple keyword match; the contradiction record
  // itself, not this per-claim linkage, is the primary signal rendered to the model).
  const contradictions = detectContradictions(sources)
  const contradictingSourceIdsByMetric = new Map<string, string[]>()
  for (const record of contradictions) { const ids = contradictingSourceIdsByMetric.get(record.metric) ?? []; for (const value of record.values) if (!ids.includes(value.sourceId)) ids.push(value.sourceId); contradictingSourceIdsByMetric.set(record.metric, ids) }
  // Fresh-audit addition: sourceIds/sourceUrls were always declared plural on EvidenceClaimCandidate
  // but nothing ever merged into them -- two sources reporting byte-identical claim text (a
  // re-fetched duplicate, or the same fact restated verbatim by an independent source) always
  // produced two disconnected entries at the same tier-derived confidence, never crediting
  // corroboration. Claims are now deduped by normalized text; a repeat from a NEW, independent
  // source family (not just a re-fetch of the same publisher) merges in and raises confidence
  // instead of appending a duplicate.
  //
  // Round-2 deep-audit fix: merging purely on claim TEXT, with no entity scoping, let two sources
  // about entirely different tickers merge into one claim whenever they happened to share boilerplate
  // phrasing (SEC filing revenue-recognition language, disclaimers, templated comparison-article
  // sentences) -- the merged claim's relatedEntities would then include a ticker the claim text has
  // nothing to do with. Concretely dangerous downstream: ceo-claim-evidence-gate.ts's
  // verifyClaimEvidence maps a claim's sourceIds back to sources and treats ANY of them as
  // supporting evidence, so a model's claim about company A could pass the fail-closed evidence gate
  // using company B's source purely because of shared boilerplate. entitiesCompatible below blocks
  // exactly the clear-cut dangerous case -- two NON-EMPTY, fully disjoint entity sets -- while still
  // allowing corroboration merges when at least one side is unscoped (a general web source) or the
  // sets share any entity in common.
  const normalizeClaimText = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim()
  const entitiesCompatible = (a: string[] = [], b: string[] = []): boolean => a.length === 0 || b.length === 0 || a.some((entity) => b.includes(entity))
  const claims: EvidenceClaimCandidate[] = []
  const claimIndicesByText = new Map<string, number[]>()
  const contributingFamiliesByIndex = new Map<number, Set<string>>()
  for (const source of sources) for (const claim of source.claimCandidates.slice(0, 12)) {
    const matchingMetric = [...contradictingSourceIdsByMetric.keys()].find((metric) => new RegExp(`\\b${metric.replace(/_/g, '[\\s_]?')}\\b`, 'i').test(claim))
    const contradictionSourceIds = matchingMetric ? contradictingSourceIdsByMetric.get(matchingMetric)!.filter((id) => id !== source.id) : undefined
    const baseConfidence = source.sourceTier === 1 ? 0.95 : source.sourceTier === 2 ? 0.85 : source.sourceTier === 3 ? 0.75 : 0.55
    const normalized = normalizeClaimText(claim)
    const candidateIndices = claimIndicesByText.get(normalized) ?? []
    const mergeIndex = candidateIndices.find((index) => entitiesCompatible(claims[index].relatedEntities, source.relatedEntities))
    if (mergeIndex !== undefined) {
      const existing = claims[mergeIndex]
      if (!existing.sourceIds.includes(source.id)) {
        const families = contributingFamiliesByIndex.get(mergeIndex) ?? new Set<string>()
        const isIndependentFamily = !families.has(source.sourceFamily)
        families.add(source.sourceFamily)
        contributingFamiliesByIndex.set(mergeIndex, families)
        existing.sourceIds = [...existing.sourceIds, source.id]
        existing.sourceUrls = [...new Set([...existing.sourceUrls, source.url])]
        existing.relatedEntities = [...new Set([...(existing.relatedEntities ?? []), ...(source.relatedEntities ?? [])])]
        if (isIndependentFamily) existing.confidence = Math.min(0.98, (existing.confidence ?? baseConfidence) + 0.08)
        if (contradictionSourceIds?.length) { existing.state = 'contradictory'; existing.contradictionSourceIds = [...new Set([...(existing.contradictionSourceIds ?? []), ...contradictionSourceIds])] }
      }
      continue
    }
    claims.push({ claim, sourceIds: [source.id], sourceUrls: [source.url], observedAt: source.retrievedAt, confidence: baseConfidence, relatedEntities: source.relatedEntities ?? [], state: contradictionSourceIds?.length ? 'contradictory' : 'unverified', ...(contradictionSourceIds?.length ? { contradictionSourceIds } : {}) })
    claimIndicesByText.set(normalized, [...candidateIndices, claims.length - 1])
    contributingFamiliesByIndex.set(claims.length - 1, new Set([source.sourceFamily]))
  }
  const observedAt = sources.length > 0 ? sources.reduce((latest, source) => Math.max(latest, source.retrievedAt), 0) : createdAt, profileMaxAge = PROFILE_MAX_AGE_MS[input.profile], minimumSources = input.minimumSources ?? (input.profile === 'public_equity' ? 3 : input.profile === 'none' ? 0 : 2), minimumTierOneSources = input.minimumTierOneSources ?? (input.profile === 'public_equity' ? 1 : 0), sufficient = sources.length >= minimumSources && sources.filter((source) => source.sourceTier <= 1).length >= minimumTierOneSources
  const contextText = sources.map((source) => `[${source.id}] ${source.title}\nURL: ${source.url}\nTier: ${source.sourceTier}\nRetrieved: ${new Date(source.retrievedAt).toISOString()}${source.publishedAt ? `\nPublished: ${new Date(source.publishedAt).toISOString()}` : ''}${source.relatedEntities?.length ? `\nEntities: ${source.relatedEntities.join(', ')}` : ''}\n\n${source.text.slice(0, 2800)}`).join('\n\n---\n\n').slice(0, 16000)
  return { scope: input.scope ?? 'external_web', profile: input.profile, operation: input.operation, createdAt, sources, claims, freshness: { observedAt, maxAgeMs: profileMaxAge }, contextText, sufficient, contradictions }
}
export function assessEvidenceClaim(input: { claim: EvidenceClaimCandidate; now?: number; maxAgeMs: number; verified?: boolean; contradictorySourceIds?: string[] }): EvidenceClaimCandidate { const now = input.now ?? Date.now(), observedAt = input.claim.observedAt ?? now, stale = now - observedAt > input.maxAgeMs, contradictionSourceIds = [...new Set(input.contradictorySourceIds ?? input.claim.contradictionSourceIds ?? [])]; const state: EvidenceAssessmentState = contradictionSourceIds.length ? 'contradictory' : input.verified ? 'verified' : stale ? 'stale' : 'unverified'; return { ...input.claim, state, verifiedAt: input.verified ? now : input.claim.verifiedAt, contradictionSourceIds } }
export function isEvidenceDecisionGrade(claim: EvidenceClaimCandidate): boolean { return claim.state === 'verified' && (claim.confidence ?? 0) >= 0.75 && !(claim.contradictionSourceIds?.length) }
export function renderEvidenceBundleForPrompt(bundle: EvidenceBundle): string {
  if (!bundle.sources.length) return 'No external evidence was acquired.'
  const now = Date.now()
  const staleClaimCount = bundle.claims.filter((claim) => assessEvidenceClaim({ claim, now, maxAgeMs: bundle.freshness.maxAgeMs }).state === 'stale').length
  const freshnessLine = staleClaimCount > 0
    ? `Freshness: ${staleClaimCount} of ${bundle.claims.length} extracted claim(s) are older than this profile's freshness window and should be treated as potentially outdated, not current.`
    : `Freshness: all extracted claims are within this profile's freshness window as of observation time.`
  const contradictionsBlock = renderContradictions(bundle.contradictions)
  return [`EVIDENCE BUNDLE: ${bundle.profile}`, `Observed: ${new Date(bundle.freshness.observedAt).toISOString()}`, `Sufficient: ${bundle.sufficient ? 'yes' : 'no'}`, freshnessLine, ...(contradictionsBlock ? [contradictionsBlock] : []), 'Source markers are authoritative. Do not create citations that are not present in this bundle.', 'Claims are unverified until the governed verification step upgrades them.', bundle.contextText].join('\n\n')
}