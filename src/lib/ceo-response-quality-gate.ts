import type { QualityResult, EvidenceState, VerificationStatus, EvidenceScope, EvidenceFreshness } from './ceo-cognitive-contract'

const STOPWORDS = new Set([
  'about', 'after', 'again', 'also', 'because', 'before', 'being', 'between', 'could', 'from',
  'have', 'into', 'more', 'most', 'other', 'should', 'that', 'their', 'there', 'these', 'they',
  'this', 'those', 'through', 'under', 'what', 'when', 'where', 'which', 'while', 'with', 'would',
  'your', 'agent007', 'please',
])

function normalize(value: string): string[] {
  return value.toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token))
    .slice(0, 160)
}

function objectiveCoverage(objective: string, content: string, path: 'fast' | 'full' | 'critical'): boolean {
  const wanted = [...new Set(normalize(objective))]
  if (!wanted.length) return Boolean(content.trim())
  const answer = new Set(normalize(content))
  const matches = wanted.filter((token) => answer.has(token)).length
  const coverage = matches / wanted.length
  if (path === 'fast') return coverage >= (wanted.length <= 4 ? 0.5 : 0.25)
  const minimumCoverage = path === 'critical' ? 0.35 : 0.25
  const minimumLength = path === 'critical' ? 320 : Math.min(500, Math.max(180, Math.floor(objective.length * 0.55)))
  return coverage >= minimumCoverage && content.trim().length >= minimumLength
}

function consistency(content: string): boolean {
  const normalized = content.toLowerCase()
  if (!normalized.trim()) return false

  const contradictionPairs: Array<[RegExp, RegExp]> = [
    /\bdo not\b/i, /\bmust\b[^.\n]{0,160}\bdo\b/i,
  ].length ? [
    [/\bdo not\b/i, /\bmust\b[^.\n]{0,160}\bdo\b/i],
    [/\bmust not\b/i, /\bmust\b(?! not)[^.\n]{0,160}\b/i],
    [/\bcannot\b/i, /\bcan\b[^.\n]{0,160}\b/i],
    [/\bnever\b/i, /\balways\b/i],
    [/\bno evidence\b/i, /\bverified\b/i],
    [/\bunverified\b/i, /\bconfirmed\b/i],
    [/\bfailed\b/i, /\bsucceeded\b/i],
    [/\bunavailable\b/i, /\bavailable\b/i],
  ] : []

  for (const [left, right] of contradictionPairs) {
    if (left.test(content) && right.test(content)) return false
  }

  const numericClaims = [...normalized.matchAll(/\b(\d+(?:\.\d+)?)\s*(%|percent|ms|seconds?|minutes?|hours?|days?)\b/g)]
    .map((match) => `${match[1]} ${match[2]}`)
  const uniqueNumericClaims = new Set(numericClaims)
  if (numericClaims.length >= 4 && uniqueNumericClaims.size !== numericClaims.length) {
    const duplicateCount = numericClaims.length - uniqueNumericClaims.size
    if (duplicateCount > 2) return false
  }

  return true
}

const LIVE_CLAIM_RE = /\b(?:current|today|latest|live|verified|confirmed|proven|deployed|serving|production\s+traffic|in\s+production)\b/i
const EXTERNAL_CLAIM_RE = /\b(?:according\s+to|market|customer(?:s)?|competitor(?:s)?|industry|study|studies|report|reports|revenue|sales|financial\s+results)\b/i
const INTERNAL_CLAIM_RE = /\b(?:architectur(?:e|al)|designed|implemented|configured|codebase|workflow|contract|module|repository|system\s+design|execution\s+path)\b/i

function claimScopes(content: string): EvidenceScope[] {
  const scopes: EvidenceScope[] = []
  if (INTERNAL_CLAIM_RE.test(content)) scopes.push('internal_state')
  if (LIVE_CLAIM_RE.test(content)) scopes.push('live_system')
  if (EXTERNAL_CLAIM_RE.test(content)) scopes.push('external_web')
  return scopes
}

function evidenceDiscipline(input: {
  content: string
  evidenceProvided: boolean
  path: 'fast' | 'full' | 'critical'
  evidenceScope?: EvidenceScope
  evidenceFreshness?: EvidenceFreshness
}): boolean {
  if (!input.content.trim()) return false
  const scopes = claimScopes(input.content)
  const scope = input.evidenceScope

  if (scopes.includes('live_system')) {
    if (scope) {
      if (scope !== 'live_system' && scope !== 'mixed') return false
      if (input.evidenceFreshness) {
        const age = Date.now() - input.evidenceFreshness.observedAt
        if (age < 0 || age > input.evidenceFreshness.maxAgeMs) return false
      }
    } else if (!input.evidenceProvided) {
      return false
    }
  }

  if (scopes.includes('external_web')) {
    if (scope) {
      if (scope !== 'external_web' && scope !== 'mixed') return false
    } else if (!input.evidenceProvided) {
      return false
    }
  }

  if (scopes.includes('internal_state')) {
    if (scope) {
      if (scope !== 'internal_state' && scope !== 'mixed' && scope !== 'live_system') return false
    }
  }

  if (input.path === 'critical' && /\b(recommend|decide|approve|deploy|invest|commit)\b/i.test(input.content) && !input.evidenceProvided && !scope) {
    return !/\bI recommend|I would recommend|recommendation\b/i.test(input.content) || /\bshould\b/i.test(input.content)
  }
  return true
}

function actionableStructure(content: string, path: 'fast' | 'full' | 'critical'): boolean {
  if (path === 'fast') return true
  const hasHeadings = /(^|\n)\s*#{1,4}\s+\S+/m.test(content)
  const hasBullets = /(^|\n)\s*(?:[-*]\s+|\d+[.)]\s+)/m.test(content)
  const hasDecisionLanguage = /\b(recommendation|decision|risks?|next steps?|actions?|evidence|assumptions?)\b/i.test(content)
  if (path === 'critical') return (hasHeadings || hasBullets) && hasDecisionLanguage && content.length >= 320
  return (hasHeadings || hasBullets || hasDecisionLanguage) && content.length >= 180
}

export function evaluateCeoQuality(input: {
  objective: string
  content: string
  path: 'fast' | 'full' | 'critical'
  reviewed?: boolean
  externalExecutionSucceeded?: boolean
  evidenceProvided?: boolean
  evidenceScope?: EvidenceScope
  evidenceFreshness?: EvidenceFreshness
}): QualityResult {
  const nonEmpty = Boolean(input.content.trim())
  const contractValid = nonEmpty && input.content.length <= 100_000
  const coverage = objectiveCoverage(input.objective, input.content, input.path)
  const consistent = consistency(input.content)
  const evidenceProvided = Boolean(input.evidenceProvided)
  const claims = claimScopes(input.content)
  const evidenceOk = evidenceDiscipline({
    content: input.content,
    evidenceProvided,
    path: input.path,
    evidenceScope: input.evidenceScope,
    evidenceFreshness: input.evidenceFreshness,
  })
  const structureOk = actionableStructure(input.content, input.path)
  const reviewed = Boolean(input.reviewed)
  const verificationStatus: VerificationStatus = reviewed ? 'INDEPENDENT_PASS' : input.path === 'critical' ? 'NOT_PERFORMED' : 'NOT_REQUIRED'
  const reasons: string[] = []

  if (!nonEmpty) reasons.push('The response is empty.')
  if (!contractValid) reasons.push('The response violates the canonical response-size contract.')
  if (!coverage) reasons.push('The response does not adequately cover the requested objective.')
  if (!consistent) reasons.push('The response contains a detected contradiction or conflicting claim.')
  if (!evidenceOk) {
    reasons.push(input.evidenceFreshness && claims.includes('live_system')
      ? 'A live/current claim depends on stale or incorrectly scoped evidence.'
      : 'The response makes a claim that requires evidence outside the supplied evidence scope.')
  }
  if (!structureOk) reasons.push('The response does not meet the structural requirements for the requested execution depth.')
  if (input.path === 'critical' && !reviewed) reasons.push('Critical execution requires an independent review stage before acceptance.')

  const passed = nonEmpty && contractValid && coverage && consistent && evidenceOk && structureOk && (input.path !== 'critical' || reviewed)
  let evidenceState: EvidenceState
  if (!input.externalExecutionSucceeded) evidenceState = 'UNAVAILABLE'
  else if (passed && input.evidenceScope === 'live_system' && input.evidenceFreshness) evidenceState = 'LIVE_VERIFIED'
  else if (passed && evidenceProvided) evidenceState = 'LIVE_VERIFIED'
  else if (passed) evidenceState = 'LIVE_EXECUTED'
  else evidenceState = 'PARTIAL_UNCONFIRMED'

  return {
    decision: passed ? 'PASS' : input.path === 'fast' ? 'DEGRADED' : 'ESCALATE',
    evidenceState,
    verificationStatus,
    checks: {
      nonEmpty,
      contractValid,
      objectiveCoverage: coverage,
      internalConsistency: consistent,
      evidenceDiscipline: evidenceOk,
      actionableStructure: structureOk,
    },
    evidenceScope: input.evidenceScope,
    evidenceFreshness: input.evidenceFreshness,
    claimScopes: claims,
    reasons: reasons.length ? reasons : ['Response satisfied the applicable deterministic quality contract.'],
  }
}

export function evaluateFastResponse(content: string, objective: string): QualityResult {
  return evaluateCeoQuality({ objective, content, path: 'fast', reviewed: false, externalExecutionSucceeded: true })
}
