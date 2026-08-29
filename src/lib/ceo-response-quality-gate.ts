import type { QualityResult, EvidenceState, VerificationStatus, EvidenceScope, EvidenceFreshness, CeoIntent } from './ceo-cognitive-contract'
import type { EvidenceBundle } from './ceo-evidence-bundle'
import { verifyClaimEvidence } from './ceo-claim-evidence-gate'
import { evaluateClaimConsistency, scoreContextContinuity, type ContextContinuityScore } from './ceo-context-intelligence'
import type { CeoFailureReason } from './ceo-failure-reason'
import type { PersistedConversationRow } from './ceo-context-composer'

const STOPWORDS = new Set(['about', 'after', 'again', 'also', 'because', 'before', 'being', 'between', 'could', 'from', 'have', 'into', 'more', 'most', 'other', 'should', 'that', 'their', 'there', 'these', 'they', 'this', 'those', 'through', 'under', 'what', 'when', 'where', 'which', 'while', 'with', 'would', 'your', 'agent007', 'please'])
type EvaluationPath = 'fast' | 'full' | 'critical'
function normalize(value: string): string[] { return value.toLowerCase().split(/[^a-z0-9]+/).map((token) => token.trim()).filter((token) => token.length >= 4 && !STOPWORDS.has(token)).slice(0, 160) }
function objectiveCoverage(objective: string, content: string, path: EvaluationPath): boolean {
  const wanted = [...new Set(normalize(objective))]
  if (!wanted.length) return Boolean(content.trim())
  const answer = new Set(normalize(content))
  const coverage = wanted.filter((token) => answer.has(token)).length / wanted.length
  if (path === 'fast') return coverage >= (wanted.length <= 4 ? 0.5 : 0.25)
  const minimumCoverage = path === 'critical' ? 0.35 : 0.25
  const minimumLength = path === 'critical' ? 320 : Math.min(500, Math.max(180, Math.floor(objective.length * 0.55)))
  return coverage >= minimumCoverage && content.trim().length >= minimumLength
}
const CASUAL_CONVERSATION_RE = /^(?:hi|hello|hey|how(?:'s|\s+is)\s+(?:it|everything|things?)\s+going|how\s+are\s+(?:you|things?)(?:\s+doing)?|how\s+do\s+you\s+do|how\s+is\s+(?:agent007|the\s+(?:system|ceo|agent))\s+doing|you\s+(?:good|okay|alright)|what(?:'s|\s+is)\s+new(?:\s+with\s+you)?|good\s+(?:morning|afternoon|evening)|thanks?|thank\s+you|ok(?:ay)?|great|perfect)[\s,!.?]*$/i
const LIVE_ASSERTION_RE = /\b(?:current(?:ly)?|today|live|deployed|serving|confirmed|verified|proven|in\s+production|production\s+traffic)\b/i
const EXTERNAL_ASSERTION_RE = /\b(?:according\s+to|latest\s+(?:market|industry|customer|competitor|report|study)|market\s+(?:is|shows|grew|declined)|customer(?:s)?\s+(?:are|have|said|reported)|competitor(?:s)?\s+(?:are|have|offer)|industry\s+(?:is|shows|grew|declined)|(?:study|studies|report|reports)\s+(?:show|shows|found|find)|revenue\s+(?:is|was|grew|declined|increased|decreased)|sales\s+(?:are|were|grew|declined|increased|decreased)|stock(?:s)?\s+(?:price|trades?|is)|shares?\s+(?:trade|are)|valuation\s+(?:is|looks|appears))\b/i
const INTERNAL_ASSERTION_RE = /\b(?:architectur(?:e|al)|designed|implemented|configured|codebase|workflow|contract|module|repository|system\s+design|execution\s+path)\b/i
const NEGATION_RE = /\b(?:not|no|without|unverified|unknown|unclear|uncertain|cannot|can't|never)\b/i
function sentences(content: string): string[] { return content.split('\n').flatMap((line) => line.split(/[.!?]+/)).map((sentence) => sentence.trim()).filter(Boolean) }
function positiveAssertionExists(content: string, pattern: RegExp): boolean { return sentences(content).some((sentence) => pattern.test(sentence) && !NEGATION_RE.test(sentence)) }
function claimScopes(content: string): EvidenceScope[] { const scopes: EvidenceScope[] = []; if (positiveAssertionExists(content, INTERNAL_ASSERTION_RE)) scopes.push('internal_state'); if (positiveAssertionExists(content, LIVE_ASSERTION_RE)) scopes.push('live_system'); if (positiveAssertionExists(content, EXTERNAL_ASSERTION_RE)) scopes.push('external_web'); return scopes }
function validFreshness(freshness?: EvidenceFreshness): freshness is EvidenceFreshness { return Boolean(freshness && Number.isFinite(freshness.observedAt) && Number.isFinite(freshness.maxAgeMs) && freshness.maxAgeMs >= 0) }
function evidenceIsFresh(freshness: EvidenceFreshness): boolean { const age = Date.now() - freshness.observedAt; return age >= 0 && age <= freshness.maxAgeMs }

export function evaluateCeoQuality(input: {
  objective: string
  content: string
  path: EvaluationPath
  intent?: CeoIntent
  reviewed?: boolean
  externalExecutionSucceeded?: boolean
  evidenceProvided?: boolean
  evidenceScope?: EvidenceScope
  evidenceFreshness?: EvidenceFreshness
  evidenceBundle?: EvidenceBundle
  evidenceVerificationApplicable?: boolean
  priorTurns?: readonly PersistedConversationRow[]
  relevantOlderMessages?: readonly PersistedConversationRow[]
}): QualityResult {
  const nonEmpty = Boolean(input.content.trim())
  const contractValid = nonEmpty && input.content.length <= 100_000
  const conversational = input.intent === 'conversation' || CASUAL_CONVERSATION_RE.test(input.objective.trim())
  const coverage = conversational ? nonEmpty : objectiveCoverage(input.objective, input.content, input.path)
  const claimConsistency = evaluateClaimConsistency(input.content)
  const claims = claimScopes(input.content)
  const externalClaims = claims.includes('external_web') || claims.includes('live_system')
  const evidenceVerificationApplicable = conversational ? false : (input.evidenceVerificationApplicable ?? (input.path === 'critical' || Boolean(input.evidenceScope) || Boolean(input.evidenceProvided) || externalClaims))
  const bundle = input.evidenceBundle
  const fresh = validFreshness(input.evidenceFreshness) && evidenceIsFresh(input.evidenceFreshness!)
  const claimVerification = externalClaims && evidenceVerificationApplicable && bundle ? verifyClaimEvidence(input.content, bundle) : { passed: true }
  const evidenceOk = (() => {
    if (!nonEmpty) return false
    if (!evidenceVerificationApplicable) return true
    if (claims.includes('live_system') && ((input.evidenceScope !== 'live_system' && input.evidenceScope !== 'mixed') || !fresh)) return false
    if (claims.includes('external_web') && ((input.evidenceScope !== 'external_web' && input.evidenceScope !== 'mixed') || !fresh)) return false
    if (claims.includes('internal_state') && input.evidenceScope && input.evidenceScope !== 'internal_state' && input.evidenceScope !== 'mixed' && input.evidenceScope !== 'live_system') return false
    if (externalClaims && bundle && !bundle.sufficient && input.path !== 'fast') return false
    if (externalClaims && bundle && !claimVerification.passed) return false
    if (externalClaims && !bundle && !input.evidenceProvided && !(input.evidenceScope && input.evidenceScope !== 'none' && fresh)) return false
    return input.path !== 'critical' || Boolean(input.evidenceProvided) || Boolean(input.evidenceScope && input.evidenceScope !== 'none')
  })()
  const continuity: ContextContinuityScore | undefined = !conversational && input.priorTurns && input.priorTurns.length
    ? scoreContextContinuity({ currentUserMessage: input.objective, response: input.content, priorTurns: input.priorTurns, relevantOlderMessages: input.relevantOlderMessages })
    : undefined
  const continuityOk = conversational ? true : (continuity ? continuity.understood : true)
  const lines = input.content.split('\n')
  const hasHeadings = lines.some((line) => /^\s*#{1,4}\s+\S+/.test(line))
  const hasBullets = lines.some((line) => /^\s*(?:[-*]\s+|\d+[.)]\s+)/.test(line))
  const hasDecisionLanguage = /\b(recommendation|decision|risks?|next steps?|actions?|evidence|assumptions?)\b/i.test(input.content)
  const structureOk = conversational ? true : input.path === 'fast' ? true : (hasHeadings || hasBullets || hasDecisionLanguage) && input.content.length >= (input.path === 'critical' ? 320 : 180)
  const reviewed = Boolean(input.reviewed)
  const verificationStatus: VerificationStatus = conversational ? 'NOT_REQUIRED' : reviewed ? 'INDEPENDENT_PASS' : input.path === 'critical' ? 'NOT_PERFORMED' : 'NOT_REQUIRED'
  const reasons: string[] = []
  if (!nonEmpty) reasons.push('The response is empty.')
  if (!contractValid) reasons.push('The response violates the canonical response-size contract.')
  if (!coverage) reasons.push('The response does not adequately cover the requested objective.')
  if (!claimConsistency.consistent) reasons.push(`The response contains claim-level contradictions: ${claimConsistency.contradictions.slice(0, 3).map((item) => item.reason).join('; ')}`)
  if (!continuityOk) reasons.push(`The response did not demonstrate sufficient continuity with relevant prior context (score ${continuity?.score ?? 0}).`)
  if (!evidenceOk) reasons.push(externalClaims ? 'One or more claims lack sufficient, fresh, provenance-matched evidence.' : 'The response makes a claim that requires evidence outside the supplied evidence scope.')
  if (!structureOk) reasons.push('The response does not meet the structural requirements for the requested execution depth.')
  if (input.path === 'critical' && !reviewed && !conversational) reasons.push('Critical execution requires an independent review stage before acceptance.')
  const passed = nonEmpty && contractValid && coverage && claimConsistency.consistent && continuityOk && evidenceOk && structureOk && (input.path !== 'critical' || reviewed || conversational)
  const evidenceIsVerifiedLive = passed && (input.evidenceScope === 'live_system' || input.evidenceScope === 'mixed') && fresh
  let failureReason: CeoFailureReason | undefined
  if (!passed) {
    if (!continuityOk) failureReason = 'continuity_failure'
    else if (!claimConsistency.consistent) failureReason = 'claim_consistency_failure'
    else if (!evidenceOk) failureReason = externalClaims ? 'evidence_insufficient' : 'quality_failure'
    else failureReason = 'quality_failure'
  }
  let evidenceState: EvidenceState
  if (conversational) evidenceState = passed ? 'NOT_APPLICABLE' : 'PARTIAL_UNCONFIRMED'
  else if (!evidenceVerificationApplicable && !externalClaims) evidenceState = passed ? 'NOT_APPLICABLE' : 'PARTIAL_UNCONFIRMED'
  else if (!externalClaims && input.evidenceScope === 'none') evidenceState = passed ? 'NOT_APPLICABLE' : 'PARTIAL_UNCONFIRMED'
  else if (input.externalExecutionSucceeded === false && (externalClaims || evidenceVerificationApplicable)) evidenceState = 'UNAVAILABLE'
  else evidenceState = evidenceIsVerifiedLive ? 'LIVE_VERIFIED' : passed ? 'LIVE_EXECUTED' : 'PARTIAL_UNCONFIRMED'
  return {
    decision: passed ? 'PASS' : input.path === 'fast' ? 'DEGRADED' : 'ESCALATE',
    evidenceState,
    verificationStatus,
    checks: { nonEmpty, contractValid, objectiveCoverage: coverage, internalConsistency: claimConsistency.consistent && continuityOk, evidenceDiscipline: evidenceOk, actionableStructure: structureOk },
    evidenceScope: input.evidenceScope,
    evidenceFreshness: input.evidenceFreshness,
    claimScopes: claims,
    contextContinuity: continuity ? { score: continuity.score, relevantTurnCount: continuity.relevantTurnCount, matchedTurnCount: continuity.matchedTurnCount, understood: continuity.understood } : undefined,
    failureReason,
    reasons: reasons.length ? reasons : ['Response satisfied the applicable deterministic quality contract.'],
  }
}

export function evaluateFastResponse(content: string, objective: string): QualityResult {
  return evaluateCeoQuality({ objective, content, path: 'fast', intent: 'conversation', reviewed: false, externalExecutionSucceeded: true, evidenceVerificationApplicable: false })
}
