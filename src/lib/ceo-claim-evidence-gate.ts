import type { EvidenceBundle, EvidenceClaimCandidate, EvidenceSource } from './ceo-evidence-bundle'

export interface ClaimVerification {
  claim: string
  scope: 'external_web' | 'live_system' | 'internal_state'
  supported: boolean
  sourceIds: string[]
  sourceTiers: number[]
  reason: string
}

const EXTERNAL_CLAIM_RE = /\b(?:according\s+to|latest|market|revenue|sales|earnings|eps|cash|debt|assets|liabilities|income|loss|margin|guidance|backlog|price|valuation|shares|competitor|industry|report|study|stock|ticker|dividend|portfolio)\b/i
const LIVE_CLAIM_RE = /\b(?:current(?:ly)?|today|live|deployed|serving|in\s+production|production\s+traffic)\b/i
const INTERNAL_CLAIM_RE = /\b(?:architectur(?:e|al)|designed|implemented|configured|codebase|workflow|contract|module|repository|system\s+design|execution\s+path)\b/i
const STOPWORDS = new Set(['about','after','again','also','because','before','being','between','could','from','have','into','more','most','other','should','that','their','there','these','they','this','those','through','under','what','when','where','which','while','with','would','your','agent007'])
// Deep-audit fix (2026-09-13): widened to also match comma-grouped digits ("10,000"), which the
// plain \d+ form silently truncated at the first comma (matching only "10"). normalizeNumber strips
// the commas before calling Number() on the captured group.
const NUMBER_RE = /(?:[$€£]\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(k|thousand|m|mn|million|b|bn|billion|percent|%|usd|cad|dollars?)?/gi
const METRIC_RE = /\b(revenue|sales|earnings|eps|cash|debt|assets|liabilities|income|loss|margin|guidance|backlog|price|market\s+cap|valuation|shares?|contract|dividend)\b/i
const EVIDENCE_MARKER_RE = /\[(?:S\d+-[0-9a-f]+|SEC-[A-Z0-9]+|PAGE-\d+)\]/gi
function stripEvidenceMarkers(text: string): string { return text.replace(EVIDENCE_MARKER_RE, ' ') }
function tokens(value: string): string[] { return [...new Set(stripEvidenceMarkers(value).toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4 && !STOPWORDS.has(token)))] }
function normalizeNumber(value: string, unit?: string): string {
  const numeric = Number(value.replace(/,/g, ''))
  if (!Number.isFinite(numeric)) return `${value.toLowerCase()} ${unit?.toLowerCase() ?? ''}`.trim()
  const normalizedUnit = (unit ?? '').toLowerCase()
  const multiplier = normalizedUnit === 'b' || normalizedUnit === 'bn' || normalizedUnit === 'billion' ? 1_000_000_000 : normalizedUnit === 'm' || normalizedUnit === 'mn' || normalizedUnit === 'million' ? 1_000_000 : normalizedUnit === 'k' || normalizedUnit === 'thousand' ? 1_000 : 1
  const normalized = numeric * multiplier
  return `${Number.isInteger(normalized) ? normalized : normalized.toFixed(6)} ${normalizedUnit.replace('dollars', 'usd').replace('percent', '%')}`.trim()
}
function numericSignatures(text: string): string[] { return [...stripEvidenceMarkers(text).matchAll(NUMBER_RE)].map((match) => normalizeNumber(match[1], match[2])) }
function metricTokens(text: string): string[] { return [...new Set((stripEvidenceMarkers(text).match(new RegExp(METRIC_RE.source, 'gi')) ?? []).map((metric) => metric.toLowerCase()))] }
function claimValueSupported(sentence: string, sources: EvidenceSource[]): boolean {
  const claimNumbers = numericSignatures(sentence)
  if (!claimNumbers.length) return true
  const claimMetrics = metricTokens(sentence)
  const candidateLines = sources.flatMap((source) => source.text.split(/\n+/).filter((line) => line.trim())).filter((line) => claimMetrics.length === 0 || claimMetrics.some((metric) => new RegExp(`\\b${metric.replace(/\\s+/g, '\\s+')}\\b`, 'i').test(line)))
  return claimNumbers.every((number) => candidateLines.some((line) => numericSignatures(line).includes(number)))
}
// Deep-audit fix (2026-09-13): a sentence asserting a specific, checkable quantitative change ("We
// grew 40% last quarter.", "Signups reached 10,000 this week.") matched none of the three scope
// regexes above -- no revenue/sales/current/architecture-style keyword -- so claimScope returned null
// and the sentence was excluded from `claims` entirely at its only call site (verifyClaimEvidence),
// never counted toward requiredClaimCount and never checked against evidence. A change-direction verb
// co-occurring with a real parsed number is exactly the shape of claim this gate exists to catch, so it
// now gets the same 'external_web' scope EXTERNAL_CLAIM_RE's business-metric keywords already receive.
const QUANTITATIVE_CHANGE_RE = /\b(?:grew|grow|growth|grown|reached|rose|rising|increased?|decreased?|declined?|dropped|fell|hit|doubled|tripled|surged|jumped|plunged)\b/i
function claimScope(sentence: string): ClaimVerification['scope'] | null { if (LIVE_CLAIM_RE.test(sentence)) return 'live_system'; if (EXTERNAL_CLAIM_RE.test(sentence)) return 'external_web'; if (INTERNAL_CLAIM_RE.test(sentence)) return 'internal_state'; if (QUANTITATIVE_CHANGE_RE.test(sentence) && numericSignatures(sentence).length > 0) return 'external_web'; return null }
function markerIds(sentence: string): string[] { return [...sentence.matchAll(/\[(S\d+-[0-9a-f]+|SEC-[A-Z0-9]+|PAGE-\d+)\]/gi)].map((match) => match[1]) }
function claimEntities(sentence: string, bundle: EvidenceBundle, candidateMatches: EvidenceClaimCandidate[]): string[] {
  const required = bundle.requiredEntities ?? []
  if (!required.length) return []
  const sentenceTickers = new Set((sentence.toUpperCase().match(/\b[A-Z]{1,5}\b/g) ?? []))
  const direct = required.filter((entity) => sentenceTickers.has(entity))
  if (direct.length) return direct
  const candidateEntities = candidateMatches.flatMap((candidate) => candidate.relatedEntities ?? []).map((entity) => entity.toUpperCase())
  const knownCandidateEntities = required.filter((entity) => candidateEntities.includes(entity))
  if (knownCandidateEntities.length) return [...new Set(knownCandidateEntities)]
  return required.length === 1 ? [required[0]!] : []
}
function entityCompatibleSources(entities: readonly string[], sources: readonly EvidenceSource[]): boolean {
  if (!entities.length) return false
  return entities.every((entity) => sources.some((source) => (source.relatedEntities ?? []).some((related) => related.toUpperCase() === entity)))
}
function overlapScore(sentence: string, source: EvidenceSource): number {
  const wanted = tokens(sentence)
  if (!wanted.length) return 0
  const sourceTokens = new Set(tokens(source.text))
  return wanted.filter((token) => sourceTokens.has(token)).length / wanted.length
}
function matchingCandidates(sentence: string, bundle: EvidenceBundle): EvidenceClaimCandidate[] {
  const wanted = tokens(sentence)
  return bundle.claims.filter((candidate) => {
    const candidateTokens = tokens(candidate.claim)
    const shared = wanted.filter((token) => candidateTokens.includes(token)).length
    return shared >= Math.min(3, Math.max(1, Math.floor(wanted.length * 0.25)))
  }).slice(0, 6)
}

export function verifyClaimEvidence(content: string, bundle?: EvidenceBundle): { passed: boolean; claims: ClaimVerification[]; supportedClaimCount: number; requiredClaimCount: number } {
  if (!bundle) return { passed: false, claims: [], supportedClaimCount: 0, requiredClaimCount: 0 }
  const claims: ClaimVerification[] = []
  for (const sentence of content.split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean)) {
    const scope = claimScope(sentence)
    if (!scope) continue
    const markerSourceIds = markerIds(sentence)
    const markerSources = markerSourceIds.map((id) => bundle.sources.find((source) => source.id === id)).filter((source): source is EvidenceSource => Boolean(source))
    const candidateMatches = matchingCandidates(sentence, bundle)
    const matchedSources = markerSources.length
      ? markerSources
      : candidateMatches.flatMap((candidate) => candidate.sourceIds.map((id) => bundle.sources.find((source) => source.id === id)).filter((source): source is EvidenceSource => Boolean(source)))
    const uniqueSources = [...new Map(matchedSources.map((source) => [source.id, source])).values()]
    const fresh = uniqueSources.some((source) => { const age = Date.now() - source.retrievedAt; return age >= 0 && age <= bundle.freshness.maxAgeMs })
    const topicalSupport = Math.max(...uniqueSources.map((source) => overlapScore(sentence, source)), 0) >= 0.28
    const quantitativeSupport = claimValueSupported(sentence, uniqueSources)
    const entities = bundle.profile === 'public_equity' ? claimEntities(sentence, bundle, candidateMatches) : []
    const entityCompatible = bundle.profile !== 'public_equity' || !(bundle.requiredEntities?.length) || entityCompatibleSources(entities, uniqueSources)
    const supported = uniqueSources.length > 0 && fresh && topicalSupport && quantitativeSupport && entityCompatible
    claims.push({
      claim: sentence.slice(0, 500),
      scope,
      supported,
      sourceIds: uniqueSources.map((source) => source.id),
      sourceTiers: uniqueSources.map((source) => source.sourceTier),
      reason: supported
        ? 'Claim maps to fresh evidence with matching topic and quantitative values.'
        : !uniqueSources.length
          ? 'No matching evidence source was found for this claim.'
          : !fresh
            ? 'Mapped evidence is stale.'
            : !topicalSupport
              ? 'The cited source does not provide sufficient topical support for this claim.'
              : !quantitativeSupport
                ? 'Claim contains quantitative values that do not match the relevant source evidence.'
                : 'The claim does not map to evidence for the specific public-equity entity/entities it names or implies.',
    })
  }
  if (!claims.length) return { passed: true, claims, supportedClaimCount: 0, requiredClaimCount: 0 }
  const supportedClaimCount = claims.filter((claim) => claim.supported).length
  const result = { passed: supportedClaimCount === claims.length, claims, supportedClaimCount, requiredClaimCount: claims.length }
  // Deep-audit fix (P0, 2026-09-13): fail-closed regardless of operation meant a pure research response
  // ("tell me about GEOS and MIND") whose claims couldn't be fully verified hard-failed the whole turn
  // identically to a decision response -- mirrors the same research/decision split now applied
  // pre-acquisition in ceo-decision-grade-evidence.ts (positive-listed on recommend/decide there too,
  // for the same reason: EvidenceOperation has more members -- none/explain/research/compare/analyze/
  // forecast/verify -- than are worth naming individually as "not a decision"). bundle.operation is
  // optional (most bundles never carry one), so an equity bundle built without one keeps the previous
  // fail-closed behavior rather than silently becoming permissive.
  if (bundle.profile === 'public_equity' && (bundle.operation === 'recommend' || bundle.operation === 'decide' || bundle.operation === undefined) && !result.passed) {
    const error = new Error(`ABSTAINED_REQUIRED_EVIDENCE: ${result.requiredClaimCount - result.supportedClaimCount} public-equity claim(s) could not be verified against fresh evidence.`)
    error.name = 'DecisionGradeClaimVerificationBlockedError'
    Object.assign(error, { code: 'ABSTAINED_REQUIRED_EVIDENCE', claimVerification: result })
    throw error
  }
  return result
}
