import type { EvidenceBundle, EvidenceClaimCandidate, EvidenceSource } from './ceo-evidence-bundle'

export interface ClaimVerification { claim: string; scope: 'external_web' | 'live_system' | 'internal_state'; supported: boolean; sourceIds: string[]; sourceTiers: number[]; reason: string }
const EXTERNAL_CLAIM_RE = /\b(?:according\s+to|latest|market|revenue|sales|earnings|eps|cash|debt|assets|liabilities|income|loss|margin|guidance|backlog|price|valuation|shares|competitor|industry|report|study|stock|ticker|dividend|portfolio)\b/i
const LIVE_CLAIM_RE = /\b(?:current(?:ly)?|today|live|deployed|serving|in\s+production|production\s+traffic)\b/i
const INTERNAL_CLAIM_RE = /\b(?:architectur(?:e|al)|designed|implemented|configured|codebase|workflow|contract|module|repository|system\s+design|execution\s+path)\b/i
const STOPWORDS = new Set(['about','after','again','also','because','before','being','between','could','from','have','into','more','most','other','should','that','their','there','these','they','this','those','through','under','what','when','where','which','while','with','would','your','agent007'])
const NUMBER_RE = /(?:[$€£]\s*)?(\d+(?:\.\d+)?)\s*(k|thousand|m|mn|million|b|bn|billion|percent|%|usd|cad|dollars?)?/gi
const METRIC_RE = /\b(revenue|sales|earnings|eps|cash|debt|assets|liabilities|income|loss|margin|guidance|backlog|price|market\s+cap|valuation|shares?|contract|dividend)\b/i
const EVIDENCE_MARKER_RE = /\[(?:S\d+-[0-9a-f]+|SEC-[A-Z0-9]+|PAGE-\d+)\]/gi
function stripEvidenceMarkers(text: string): string { return text.replace(EVIDENCE_MARKER_RE, ' ') }
function tokens(value: string): string[] { return [...new Set(stripEvidenceMarkers(value).toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4 && !STOPWORDS.has(token)))] }
function normalizeNumber(value: string, unit?: string): string { const numeric = Number(value); if (!Number.isFinite(numeric)) return `${value.toLowerCase()} ${unit?.toLowerCase() ?? ''}`.trim(); const normalizedUnit = (unit ?? '').toLowerCase(); const multiplier = normalizedUnit === 'b' || normalizedUnit === 'bn' || normalizedUnit === 'billion' ? 1_000_000_000 : normalizedUnit === 'm' || normalizedUnit === 'mn' || normalizedUnit === 'million' ? 1_000_000 : normalizedUnit === 'k' || normalizedUnit === 'thousand' ? 1_000 : 1; const normalized = numeric * multiplier; return `${Number.isInteger(normalized) ? normalized : normalized.toFixed(6)} ${normalizedUnit.replace('dollars', 'usd').replace('percent', '%')}`.trim() }
function numericSignatures(text: string): string[] { return [...stripEvidenceMarkers(text).matchAll(NUMBER_RE)].map((match) => normalizeNumber(match[1], match[2])) }
function metricTokens(text: string): string[] { return [...new Set((stripEvidenceMarkers(text).match(new RegExp(METRIC_RE.source, 'gi')) ?? []).map((metric) => metric.toLowerCase()))] }
function claimValueSupported(sentence: string, sources: EvidenceSource[]): boolean { const claimNumbers = numericSignatures(sentence); if (!claimNumbers.length) return true; const claimMetrics = metricTokens(sentence); const candidateLines = sources.flatMap((source) => source.text.split(/\n+/).filter((line) => line.trim())).filter((line) => claimMetrics.length === 0 || claimMetrics.some((metric) => new RegExp(`\\b${metric.replace(/\\s+/g, '\\s+')}\\b`, 'i').test(line))); return claimNumbers.every((number) => candidateLines.some((line) => numericSignatures(line).includes(number))) }
function claimScope(sentence: string): ClaimVerification['scope'] | null { if (LIVE_CLAIM_RE.test(sentence)) return 'live_system'; if (EXTERNAL_CLAIM_RE.test(sentence)) return 'external_web'; if (INTERNAL_CLAIM_RE.test(sentence)) return 'internal_state'; return null }
function markerIds(sentence: string): string[] { return [...sentence.matchAll(/\[(S\d+-[0-9a-f]+|SEC-[A-Z0-9]+|PAGE-\d+)\]/gi)].map((match) => match[1]) }
function overlapScore(sentence: string, source: EvidenceSource): number { const wanted = tokens(sentence); if (!wanted.length) return 0; const sourceTokens = new Set(tokens(source.text)); return wanted.filter((token) => sourceTokens.has(token)).length / wanted.length }
function matchingCandidates(sentence: string, bundle: EvidenceBundle): EvidenceClaimCandidate[] { const wanted = tokens(sentence); return bundle.claims.filter((candidate) => { const ct = tokens(candidate.claim); const shared = wanted.filter((token) => ct.includes(token)).length; return shared >= Math.min(3, Math.max(1, Math.floor(wanted.length * 0.25))) }).slice(0, 6) }

export function verifyClaimEvidence(content: string, bundle?: EvidenceBundle): { passed: boolean; claims: ClaimVerification[]; supportedClaimCount: number; requiredClaimCount: number } {
  if (!bundle) return { passed: false, claims: [], supportedClaimCount: 0, requiredClaimCount: 0 }
  const claims: ClaimVerification[] = []
  for (const sentence of content.split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean)) {
    const scope = claimScope(sentence); if (!scope) continue
    const markerSourceIds = markerIds(sentence)
    const markerSources = markerSourceIds.map((id) => bundle.sources.find((source) => source.id === id)).filter((source): source is EvidenceSource => Boolean(source))
    const candidateMatches = matchingCandidates(sentence, bundle)
    const matchedSources = markerSources.length ? markerSources : candidateMatches.flatMap((candidate) => candidate.sourceIds.map((id) => bundle.sources.find((source) => source.id === id)).filter((source): source is EvidenceSource => Boolean(source)))
    const uniqueSources = [...new Map(matchedSources.map((source) => [source.id, source])).values()]
    const fresh = uniqueSources.some((source) => { const age = Date.now() - source.retrievedAt; return age >= 0 && age <= bundle.freshness.maxAgeMs })
    const topicalSupport = markerSources.length > 0 || Math.max(...uniqueSources.map((source) => overlapScore(sentence, source)), 0) >= 0.28
    const quantitativeSupport = claimValueSupported(sentence, uniqueSources)
    const supported = uniqueSources.length > 0 && fresh && topicalSupport && quantitativeSupport
    claims.push({ claim: sentence.slice(0, 500), scope, supported, sourceIds: uniqueSources.map((source) => source.id), sourceTiers: uniqueSources.map((source) => source.sourceTier), reason: supported ? 'Claim maps to fresh evidence with matching topic and quantitative values.' : quantitativeSupport ? 'No sufficiently fresh, matching source was found for this claim.' : 'Claim contains quantitative values that do not match the relevant source evidence.' })
  }
  if (!claims.length) return { passed: true, claims, supportedClaimCount: 0, requiredClaimCount: 0 }
  const supportedClaimCount = claims.filter((claim) => claim.supported).length
  const result = { passed: supportedClaimCount === claims.length, claims, supportedClaimCount, requiredClaimCount: claims.length }
  if (bundle.profile === 'public_equity' && !result.passed) { const error = new Error(`ABSTAINED_REQUIRED_EVIDENCE: ${result.requiredClaimCount - result.supportedClaimCount} public-equity claim(s) could not be verified against fresh evidence.`); error.name = 'DecisionGradeClaimVerificationBlockedError'; Object.assign(error, { code: 'ABSTAINED_REQUIRED_EVIDENCE', claimVerification: result }); throw error }
  return result
}
