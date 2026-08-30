import type { QualityResult, EvidenceState, VerificationStatus, EvidenceScope, EvidenceFreshness, CeoIntent } from './ceo-cognitive-contract'
import type { EvidenceBundle } from './ceo-evidence-bundle'
import { verifyClaimEvidence } from './ceo-claim-evidence-gate'
import { evaluateClaimConsistency, scoreContextContinuity, type ContextContinuityScore } from './ceo-context-intelligence'
import type { CeoFailureReason } from './ceo-failure-reason'
import type { PersistedConversationRow } from './ceo-context-composer'
import type { ConversationReference } from './ceo-conversation-state'

type EvaluationPath = 'fast' | 'full' | 'critical'
const STOPWORDS = new Set(['about','after','again','also','because','before','being','between','could','from','have','into','more','most','other','should','that','their','there','these','they','this','those','through','under','what','when','where','which','while','with','would','your','agent007','please','then','than','just','like','really','very','doing','does','doesnt','dont','you','are','how','why','can','tell','give','make','want'])
const CASUAL_CONVERSATION_RE = /^(?:hi|hello|hey|how(?:'s|\s+is)\s+(?:it|everything|things?)\s+going|how\s+are\s+(?:you|things?)(?:\s+doing)?|how\s+do\s+you\s+do|how\s+is\s+(?:agent007|the\s+(?:system|ceo|agent))\s+doing|you\s+(?:good|okay|alright)|what(?:'s|\s+is)\s+new(?:\s+with\s+you)?|good\s+(?:morning|afternoon|evening)|thanks?|thank\s+you|ok(?:ay)?|great|perfect)[\s,!.?]*$/i
const LIVE_ASSERTION_RE = /\b(?:current(?:ly)?|today|live|deployed|serving|confirmed|verified|proven|in\s+production|production\s+traffic)\b/i
const EXTERNAL_ASSERTION_RE = /\b(?:according\s+to|latest\s+(?:market|industry|customer|competitor|report|study)|market\s+(?:is|shows|grew|declined)|customer(?:s)?\s+(?:are|have|said|reported)|competitor(?:s)?\s+(?:are|have|offer)|industry\s+(?:is|shows|grew|declined)|(?:study|studies|report|reports)\s+(?:show|shows|found|find)|revenue\s+(?:is|was|grew|declined|increased|decreased)|sales\s+(?:are|were|grew|declined|increased|decreased)|stock(?:s)?\s+(?:price|trades?|is)|shares?\s+(?:trade|are)|valuation\s+(?:is|looks|appears))\b/i
const INTERNAL_ASSERTION_RE = /\b(?:architectur(?:e|al)|designed|implemented|configured|codebase|workflow|contract|module|repository|system\s+design|execution\s+path)\b/i
const NEGATION_RE = /\b(?:not|no|without|unverified|unknown|unclear|uncertain|cannot|can't|never)\b/i
const CONVERSATIONAL_ROBOTIC_RE = /\b(?:as an ai|as an assistant|i am an ai|your request|the user|objective:|quality gate|evidence state|execution contract|cannot comply|please provide)\b/i
const REPETITION_RE = /(.{18,80})\s+\1/i
const EMOTIONAL_TONE_RE = /\b(?:frustrated|frustrating|excited|happy|worried|concerned|disappointed|angry|confused|hopeful|great|excellent|thanks|thank you)\b/i
function normalize(value: string): string[] { return value.toLowerCase().split(/[^a-z0-9]+/).map((token) => token.trim()).filter((token) => token.length >= 4 && !STOPWORDS.has(token)).slice(0, 160) }
function sentences(content: string): string[] { return content.split('\n').flatMap((line) => line.split(/[.!?]+/)).map((sentence) => sentence.trim()).filter(Boolean) }
function positiveAssertionExists(content: string, pattern: RegExp): boolean { return sentences(content).some((sentence) => pattern.test(sentence) && !NEGATION_RE.test(sentence)) }
function claimScopes(content: string): EvidenceScope[] { const scopes: EvidenceScope[] = []; if (positiveAssertionExists(content, INTERNAL_ASSERTION_RE)) scopes.push('internal_state'); if (positiveAssertionExists(content, LIVE_ASSERTION_RE)) scopes.push('live_system'); if (positiveAssertionExists(content, EXTERNAL_ASSERTION_RE)) scopes.push('external_web'); return scopes }
function validFreshness(freshness?: EvidenceFreshness): freshness is EvidenceFreshness { return Boolean(freshness && Number.isFinite(freshness.observedAt) && Number.isFinite(freshness.maxAgeMs) && freshness.maxAgeMs >= 0) }
function evidenceIsFresh(freshness: EvidenceFreshness): boolean { const age = Date.now() - freshness.observedAt; return age >= 0 && age <= freshness.maxAgeMs }
function objectiveCoverage(objective: string, content: string, path: EvaluationPath): boolean {
  const wanted = [...new Set(normalize(objective))]; if (!wanted.length) return Boolean(content.trim())
  const answer = new Set(normalize(content)); const coverage = wanted.filter((token) => answer.has(token)).length / wanted.length
  if (path === 'fast') return coverage >= (wanted.length <= 4 ? 0.5 : 0.25)
  const minimumCoverage = path === 'critical' ? 0.35 : 0.25; const minimumLength = path === 'critical' ? 320 : Math.min(500, Math.max(180, Math.floor(objective.length * 0.55)))
  return coverage >= minimumCoverage && content.trim().length >= minimumLength
}

export interface ConversationQualityScore {
  score: number
  continuity: number
  relevance: number
  naturalness: number
  toneAlignment: number
  coherence: number
  nonRepetition: number
  initiative: number
  referenceResolution: number
  personalityConsistency: number
  progression: number
  issues: string[]
}

export function scoreCeoConversationQuality(input: {
  objective: string
  content: string
  priorTurns?: readonly PersistedConversationRow[]
  relevantOlderMessages?: readonly PersistedConversationRow[]
  resolvedReferences?: readonly ConversationReference[]
}): ConversationQualityScore {
  const objective = input.objective.trim(); const content = input.content.trim(); const prior = [...(input.priorTurns ?? [])].filter((row) => row.role === 'user' || row.role === 'assistant')
  const continuity = prior.length ? scoreContextContinuity({ currentUserMessage: objective, response: content, priorTurns: prior, relevantOlderMessages: input.relevantOlderMessages }).score : 70
  const wanted = new Set(normalize(objective)); const answer = new Set(normalize(content)); const overlap = wanted.size ? [...wanted].filter((token) => answer.has(token)).length / wanted.size : 1
  const relevance = Math.round(Math.min(100, overlap * 80 + (content.length > 0 ? 20 : 0)))
  const naturalness = Math.max(0, 100 - (CONVERSATIONAL_ROBOTIC_RE.test(content) ? 45 : 0) - (content.length > 1600 ? 10 : 0) - (/\b(?:first|second|third)\s+step\b/i.test(content) && objective.length < 100 ? 10 : 0))
  const toneAlignment = EMOTIONAL_TONE_RE.test(objective) ? (EMOTIONAL_TONE_RE.test(content) ? 100 : 72) : 88
  const coherence = evaluateClaimConsistency(content).consistent ? 96 : 45
  const nonRepetition = REPETITION_RE.test(content) ? 45 : 96
  const referenceDetected = /\b(?:it|this|that|these|those|same|earlier|yesterday|previous|continue|second|first|other)\b/i.test(objective)
  const resolutions = input.resolvedReferences ?? []
  const resolvedUsable = resolutions.filter((reference) => Boolean(reference.resolvedText) && !reference.ambiguous && reference.confidence >= 0.7).length
  const referenceResolution = !referenceDetected ? 90 : resolutions.length === 0 ? 35 : Math.round((resolvedUsable / resolutions.length) * 100)
  const initiative = content.length >= 20 ? 88 : 55
  const personalityConsistency = CONVERSATIONAL_ROBOTIC_RE.test(content) ? 50 : 92
  const progression = content.length > 40 ? 90 : 65
  const score = Math.round((continuity + relevance + naturalness + toneAlignment + coherence + nonRepetition + referenceResolution + initiative + personalityConsistency + progression) / 10)
  const issues: string[] = []
  if (continuity < 70) issues.push(`continuity is weak (${Math.round(continuity)}/100)`)
  if (naturalness < 80) issues.push('response uses robotic or procedural language')
  if (toneAlignment < 80) issues.push('tone does not sufficiently match the conversation')
  if (nonRepetition < 80) issues.push('response appears repetitive')
  if (referenceResolution < 75) issues.push('conversational reference was not resolved with sufficient confidence')
  if (personalityConsistency < 80) issues.push('CEO communication style is inconsistent')
  if (progression < 75) issues.push('response does not move the conversation forward')
  return { score, continuity, relevance, naturalness, toneAlignment, coherence, nonRepetition, referenceResolution, initiative, personalityConsistency, progression, issues }
}

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
  resolvedReferences?: readonly ConversationReference[]
}): QualityResult {
  const nonEmpty = Boolean(input.content.trim()); const contractValid = nonEmpty && input.content.length <= 100_000
  const conversational = input.intent !== undefined ? input.intent === 'conversation' : CASUAL_CONVERSATION_RE.test(input.objective.trim())
  const coverage = conversational ? nonEmpty : objectiveCoverage(input.objective, input.content, input.path)
  const claimConsistency = evaluateClaimConsistency(input.content); const claims = claimScopes(input.content); const externalClaims = claims.includes('external_web') || claims.includes('live_system')
  const evidenceVerificationApplicable = conversational ? false : (input.evidenceVerificationApplicable ?? (input.path === 'critical' || Boolean(input.evidenceScope) || Boolean(input.evidenceProvided) || externalClaims))
  const bundle = input.evidenceBundle; const fresh = validFreshness(input.evidenceFreshness) && evidenceIsFresh(input.evidenceFreshness!)
  const claimVerification = externalClaims && evidenceVerificationApplicable && bundle ? verifyClaimEvidence(input.content, bundle) : { passed: true }
  const evidenceOk = (() => {
    if (!nonEmpty) return false; if (!evidenceVerificationApplicable) return true
    if (claims.includes('live_system') && ((input.evidenceScope !== 'live_system' && input.evidenceScope !== 'mixed') || !fresh)) return false
    if (claims.includes('external_web') && ((input.evidenceScope !== 'external_web' && input.evidenceScope !== 'mixed') || !fresh)) return false
    if (claims.includes('internal_state') && input.evidenceScope && !['internal_state', 'mixed', 'live_system'].includes(input.evidenceScope)) return false
    if (externalClaims && bundle && !bundle.sufficient && input.path !== 'fast') return false
    if (externalClaims && bundle && !claimVerification.passed) return false
    if (externalClaims && !bundle && !input.evidenceProvided && !(input.evidenceScope && input.evidenceScope !== 'none' && fresh)) return false
    return input.path !== 'critical' || Boolean(input.evidenceProvided) || Boolean(input.evidenceScope && input.evidenceScope !== 'none')
  })()
  const continuity: ContextContinuityScore | undefined = !conversational && input.priorTurns?.length ? scoreContextContinuity({ currentUserMessage: input.objective, response: input.content, priorTurns: input.priorTurns, relevantOlderMessages: input.relevantOlderMessages }) : undefined
  const conversationQuality = conversational ? scoreCeoConversationQuality({ objective: input.objective, content: input.content, priorTurns: input.priorTurns, relevantOlderMessages: input.relevantOlderMessages, resolvedReferences: input.resolvedReferences }) : undefined
  const continuityScore = conversationQuality?.continuity ?? continuity?.score ?? 100; const continuityOk = conversational ? continuityScore >= 55 : (continuity ? continuity.understood : true)
  const lines = input.content.split('\n'); const hasHeadings = lines.some((line) => /^\s*#{1,4}\s+\S+/.test(line)); const hasBullets = lines.some((line) => /^\s*(?:[-*]\s+|\d+[.)]\s+)/.test(line)); const hasDecisionLanguage = /\b(recommendation|decision|risks?|next steps?|actions?|evidence|assumptions?)\b/i.test(input.content)
  const structureOk = conversational ? true : input.path === 'fast' ? true : (hasHeadings || hasBullets || hasDecisionLanguage) && input.content.length >= (input.path === 'critical' ? 320 : 180)
  const conversationOk = conversational ? Boolean(conversationQuality && conversationQuality.score >= 78 && continuityOk) : true
  const reviewed = Boolean(input.reviewed); const verificationStatus: VerificationStatus = conversational ? 'NOT_REQUIRED' : reviewed ? 'INDEPENDENT_PASS' : input.path === 'critical' ? 'NOT_PERFORMED' : 'NOT_REQUIRED'
  const reasons: string[] = []
  if (!nonEmpty) reasons.push('The response is empty.')
  if (!contractValid) reasons.push('The response violates the canonical response-size contract.')
  if (!coverage) reasons.push('The response does not adequately cover the requested objective.')
  if (!claimConsistency.consistent) reasons.push(`The response contains claim-level contradictions: ${claimConsistency.contradictions.slice(0, 3).map((item) => item.reason).join('; ')}`)
  if (!continuityOk) reasons.push(conversational ? `The conversational context score was too weak (${Math.round(continuityScore)}/100).` : `The response did not demonstrate sufficient continuity with relevant prior context (score ${continuity?.score ?? 0}).`)
  if (conversationQuality?.issues.length) reasons.push(...conversationQuality.issues.map((issue) => `Conversation quality: ${issue}.`))
  if (!evidenceOk) reasons.push(externalClaims ? 'One or more claims lack sufficient, fresh, provenance-matched evidence.' : 'The response makes a claim that requires evidence outside the supplied evidence scope.')
  if (!structureOk) reasons.push('The response does not meet the structural requirements for the requested execution depth.')
  if (input.path === 'critical' && !reviewed && !conversational) reasons.push('Critical execution requires an independent review stage before acceptance.')
  const passed = nonEmpty && contractValid && coverage && claimConsistency.consistent && continuityOk && evidenceOk && structureOk && conversationOk && (input.path !== 'critical' || reviewed || conversational)
  const evidenceIsVerifiedLive = passed && (input.evidenceScope === 'live_system' || input.evidenceScope === 'mixed') && fresh
  let failureReason: CeoFailureReason | undefined
  if (!passed) { if (!continuityOk) failureReason = 'continuity_failure'; else if (conversational && conversationQuality && conversationQuality.naturalness < 70) failureReason = 'quality_failure'; else if (!claimConsistency.consistent) failureReason = 'claim_consistency_failure'; else if (!evidenceOk) failureReason = externalClaims ? 'evidence_insufficient' : 'quality_failure'; else failureReason = 'quality_failure' }
  let evidenceState: EvidenceState
  if (conversational) evidenceState = passed ? 'NOT_APPLICABLE' : 'PARTIAL_UNCONFIRMED'
  else if (!evidenceVerificationApplicable && !externalClaims) evidenceState = passed ? 'NOT_APPLICABLE' : 'PARTIAL_UNCONFIRMED'
  else if (!externalClaims && input.evidenceScope === 'none') evidenceState = passed ? 'NOT_APPLICABLE' : 'PARTIAL_UNCONFIRMED'
  else if (input.externalExecutionSucceeded === false && (externalClaims || evidenceVerificationApplicable)) evidenceState = 'UNAVAILABLE'
  else evidenceState = evidenceIsVerifiedLive ? 'LIVE_VERIFIED' : passed ? 'LIVE_EXECUTED' : 'PARTIAL_UNCONFIRMED'
  return { decision: passed ? 'PASS' : conversational ? 'ESCALATE' : input.path === 'fast' ? 'DEGRADED' : 'ESCALATE', evidenceState, verificationStatus, checks: { nonEmpty, contractValid, objectiveCoverage: coverage, internalConsistency: claimConsistency.consistent && continuityOk, evidenceDiscipline: evidenceOk, actionableStructure: structureOk }, evidenceScope: input.evidenceScope, evidenceFreshness: input.evidenceFreshness, claimScopes: claims, contextContinuity: continuity ? { score: continuity.score, relevantTurnCount: continuity.relevantTurnCount, matchedTurnCount: continuity.matchedTurnCount, understood: continuity.understood } : conversationQuality ? { score: conversationQuality.continuity, relevantTurnCount: input.priorTurns?.length ?? 0, matchedTurnCount: Math.round((input.priorTurns?.length ?? 0) * conversationQuality.continuity / 100), understood: continuityOk } : undefined, conversationQuality, failureReason, reasons: reasons.length ? reasons : ['Response satisfied the deterministic quality contract.'] } as QualityResult & { conversationQuality?: ConversationQualityScore }
}

export function evaluateFastResponse(content: string, objective: string): QualityResult { return evaluateCeoQuality({ objective, content, path: 'fast', intent: 'conversation', reviewed: false, externalExecutionSucceeded: true, evidenceVerificationApplicable: false }) }
