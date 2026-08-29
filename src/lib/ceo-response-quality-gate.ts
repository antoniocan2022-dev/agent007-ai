import type { QualityResult, EvidenceState, VerificationStatus, EvidenceScope, EvidenceFreshness } from './ceo-cognitive-contract'
import type { EvidenceBundle } from './ceo-evidence-bundle'
import { verifyClaimEvidence } from './ceo-claim-evidence-gate'

const STOPWORDS = new Set(['about','after','again','also','because','before','being','between','could','from','have','into','more','most','other','should','that','their','there','these','they','this','those','through','under','what','when','where','which','while','with','would','your','agent007','please'])
function normalize(value: string): string[] { return value.toLowerCase().split(/[^a-z0-9]+/).map((token) => token.trim()).filter((token) => token.length >= 4 && !STOPWORDS.has(token)).slice(0, 160) }
function objectiveCoverage(objective: string, content: string, path: 'fast' | 'full' | 'critical'): boolean {
  const wanted = [...new Set(normalize(objective))]; if (!wanted.length) return Boolean(content.trim())
  const answer = new Set(normalize(content)), coverage = wanted.filter((token) => answer.has(token)).length / wanted.length
  if (path === 'fast') return coverage >= (wanted.length <= 4 ? 0.5 : 0.25)
  const minimumCoverage = path === 'critical' ? 0.35 : 0.25, minimumLength = path === 'critical' ? 320 : Math.min(500, Math.max(180, Math.floor(objective.length * 0.55)))
  return coverage >= minimumCoverage && content.trim().length >= minimumLength
}
function consistency(content: string): boolean {
  const normalized = content.toLowerCase(); if (!normalized.trim()) return false
  const pairs: Array<[RegExp, RegExp]> = [[/\bdo not\b/i,/\bmust\b[^.\n]{0,160}\bdo\b/i],[/\bmust not\b/i,/\bmust\b(?! not)[^.\n]{0,160}\b/i],[/\bcannot\b/i,/\bcan\b[^.\n]{0,160}\b/i],[/\bnever\b/i,/\balways\b/i],[/\bno evidence\b/i,/\bverified\b/i],[/\bunverified\b/i,/\bconfirmed\b/i],[/\bfailed\b/i,/\bsucceeded\b/i],[/\bunavailable\b/i,/\bavailable\b/i]]
  if (pairs.some(([left,right]) => left.test(content) && right.test(content))) return false
  const numericClaims = [...normalized.matchAll(/\b(\d+(?:\.\d+)?)\s*(%|percent|ms|seconds?|minutes?|hours?|days?)\b/g)].map((m) => `${m[1]} ${m[2]}`)
  const duplicates = numericClaims.length - new Set(numericClaims).size
  return !(numericClaims.length >= 4 && duplicates > 2)
}
const LIVE_ASSERTION_RE = /\b(?:current(?:ly)?|today|live|deployed|serving|confirmed|verified|proven|in\s+production|production\s+traffic)\b/i
const EXTERNAL_ASSERTION_RE = /\b(?:according\s+to|latest\s+(?:market|industry|customer|competitor|report|study)|market\s+(?:is|shows|grew|declined)|customer(?:s)?\s+(?:are|have|said|reported)|competitor(?:s)?\s+(?:are|have|offer)|industry\s+(?:is|shows|grew|declined)|(?:study|studies|report|reports)\s+(?:show|shows|found|find)|revenue\s+(?:is|was|grew|declined|increased|decreased)|sales\s+(?:are|were|grew|declined|increased|decreased)|stock(?:s)?\s+(?:price|trades?|is)|shares?\s+(?:trade|are)|valuation\s+(?:is|looks|appears))\b/i
const INTERNAL_ASSERTION_RE = /\b(?:architectur(?:e|al)|designed|implemented|configured|codebase|workflow|contract|module|repository|system\s+design|execution\s+path)\b/i
const NEGATION_RE = /\b(?:not|no|without|unverified|unknown|unclear|uncertain|cannot|can't|never)\b/i
function positiveAssertionExists(content: string, pattern: RegExp): boolean { return content.split(/[.!?\n]+/).some((sentence) => pattern.test(sentence) && !NEGATION_RE.test(sentence)) }
function claimScopes(content: string): EvidenceScope[] { const scopes: EvidenceScope[] = []; if (positiveAssertionExists(content, INTERNAL_ASSERTION_RE)) scopes.push('internal_state'); if (positiveAssertionExists(content, LIVE_ASSERTION_RE)) scopes.push('live_system'); if (positiveAssertionExists(content, EXTERNAL_ASSERTION_RE)) scopes.push('external_web'); return scopes }
function validFreshness(freshness?: EvidenceFreshness): freshness is EvidenceFreshness { return Boolean(freshness && Number.isFinite(freshness.observedAt) && Number.isFinite(freshness.maxAgeMs) && freshness.maxAgeMs >= 0) }
function evidenceIsFresh(freshness: EvidenceFreshness): boolean { return validFreshness(freshness) && (() => { const age = Date.now() - freshness.observedAt; return age >= 0 && age <= freshness.maxAgeMs })() }

export function evaluateCeoQuality(input: { objective: string; content: string; path: 'fast' | 'full' | 'critical'; reviewed?: boolean; externalExecutionSucceeded?: boolean; evidenceProvided?: boolean; evidenceScope?: EvidenceScope; evidenceFreshness?: EvidenceFreshness; evidenceBundle?: EvidenceBundle }): QualityResult {
  const nonEmpty = Boolean(input.content.trim()), contractValid = nonEmpty && input.content.length <= 100_000, coverage = objectiveCoverage(input.objective, input.content, input.path), consistent = consistency(input.content)
  const evidenceProvided = Boolean(input.evidenceProvided), claims = claimScopes(input.content), freshnessValid = validFreshness(input.evidenceFreshness), fresh = freshnessValid && evidenceIsFresh(input.evidenceFreshness!), externalClaims = claims.includes('external_web') || claims.includes('live_system')
  const bundle = input.evidenceBundle
  const claimVerification = externalClaims ? verifyClaimEvidence(input.content, bundle) : { passed: true, claims: [], supportedClaimCount: 0, requiredClaimCount: 0 }
  const evidenceOk = (() => {
    if (!input.content.trim()) return false
    const scope = input.evidenceScope
    if (claims.includes('live_system') && (scope !== 'live_system' && scope !== 'mixed' || !fresh)) return false
    if (claims.includes('external_web') && (scope !== 'external_web' && scope !== 'mixed' || !fresh)) return false
    if (claims.includes('internal_state') && scope && scope !== 'internal_state' && scope !== 'mixed' && scope !== 'live_system') return false
    if (externalClaims && bundle && !bundle.sufficient && input.path !== 'fast') return false
    if (externalClaims && bundle && !claimVerification.passed) return false
    if (externalClaims && !bundle && !evidenceProvided) return false
    return input.path !== 'critical' || evidenceProvided || Boolean(scope && scope !== 'none')
  })()
  const structureOk = input.path === 'fast' ? true : ((/^|\n)\s*#{1,4}\s+\S+/m.test(input.content) || /(^|\n)\s*(?:[-*]\s+|\d+[.)]\s+)/m.test(input.content) || /\b(recommendation|decision|risks?|next steps?|actions?|evidence|assumptions?)\b/i.test(input.content)) && input.content.length >= (input.path === 'critical' ? 320 : 180))
  const reviewed = Boolean(input.reviewed), verificationStatus: VerificationStatus = reviewed ? 'INDEPENDENT_PASS' : input.path === 'critical' ? 'NOT_PERFORMED' : 'NOT_REQUIRED', reasons: string[] = []
  if (!nonEmpty) reasons.push('The response is empty.')
  if (!contractValid) reasons.push('The response violates the canonical response-size contract.')
  if (!coverage) reasons.push('The response does not adequately cover the requested objective.')
  if (!consistent) reasons.push('The response contains a detected contradiction or conflicting claim.')
  if (!evidenceOk) reasons.push(externalClaims ? 'One or more claims lack sufficient, fresh, provenance-matched evidence.' : 'The response makes a claim that requires evidence outside the supplied evidence scope.')
  if (!structureOk) reasons.push('The response does not meet the structural requirements for the requested execution depth.')
  if (input.path === 'critical' && !reviewed) reasons.push('Critical execution requires an independent review stage before acceptance.')
  const passed = nonEmpty && contractValid && coverage && consistent && evidenceOk && structureOk && (input.path !== 'critical' || reviewed)
  const evidenceIsVerifiedLive = passed && (input.evidenceScope === 'live_system' || input.evidenceScope === 'mixed') && fresh
  const evidenceState: EvidenceState = !input.externalExecutionSucceeded ? 'UNAVAILABLE' : evidenceIsVerifiedLive ? 'LIVE_VERIFIED' : passed ? 'LIVE_EXECUTED' : 'PARTIAL_UNCONFIRMED'
  return { decision: passed ? 'PASS' : input.path === 'fast' ? 'DEGRADED' : 'ESCALATE', evidenceState, verificationStatus, checks: { nonEmpty, contractValid, objectiveCoverage: coverage, internalConsistency: consistent, evidenceDiscipline: evidenceOk, actionableStructure: structureOk }, evidenceScope: input.evidenceScope, evidenceFreshness: input.evidenceFreshness, claimScopes: claims, reasons: reasons.length ? reasons : ['Response satisfied the applicable deterministic quality contract.'] }
}

export function evaluateFastResponse(content: string, objective: string): QualityResult { return evaluateCeoQuality({ objective, content, path: 'fast', reviewed: false, externalExecutionSucceeded: true }) }
