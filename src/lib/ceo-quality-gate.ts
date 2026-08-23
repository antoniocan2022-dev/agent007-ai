import type { QualityResult, EvidenceState, VerificationStatus } from './ceo-cognitive-contract'

function normalize(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4).slice(0, 120)
}

function objectiveCoverage(objective: string, content: string): boolean {
  const wanted = [...new Set(normalize(objective))]
  if (!wanted.length) return true
  const answer = new Set(normalize(content))
  const matches = wanted.filter((token) => answer.has(token)).length
  const coverage = matches / wanted.length
  if (wanted.length <= 4) return coverage >= 0.5
  return coverage >= 0.2 && content.trim().length >= Math.min(240, Math.max(80, Math.floor(objective.length * 0.5)))
}

function consistency(content: string): boolean {
  if (!content.trim()) return false
  const contradictionPairs: Array<[RegExp, RegExp]> = [
    [/\bdo not\b/i, /\bmust\b[^.]{0,120}\bdo\b/i],
    [/\bno evidence\b/i, /\bverified\b/i],
    [/\bfailed\b/i, /\bsucceeded\b/i],
  ]
  return contradictionPairs.every(([a, b]) => !(a.test(content) && b.test(content)))
}

function evidenceDiscipline(content: string, evidenceProvided: boolean): boolean {
  if (!content.trim()) return false
  const claimsLive = /\b(current|today|latest|live|verified|confirmed|proven)\b/i.test(content)
  return !claimsLive || evidenceProvided
}

function actionableStructure(content: string, path: 'fast' | 'full' | 'critical'): boolean {
  if (path === 'fast') return true
  const hasStructure = /(^|\n)\s*(?:[-*]\s+|\d+[.)]\s+|#{1,4}\s+)/m.test(content)
  return hasStructure || content.length >= 500
}

export function evaluateCeoQuality(input: {
  objective: string
  content: string
  path: 'fast' | 'full' | 'critical'
  reviewed?: boolean
  externalExecutionSucceeded?: boolean
  evidenceProvided?: boolean
}): QualityResult {
  const nonEmpty = Boolean(input.content.trim())
  const contractValid = nonEmpty && input.content.length <= 100_000
  const coverage = objectiveCoverage(input.objective, input.content)
  const consistent = consistency(input.content)
  const evidenceProvided = Boolean(input.evidenceProvided)
  const evidenceOk = evidenceDiscipline(input.content, evidenceProvided)
  const structureOk = actionableStructure(input.content, input.path)
  const verificationStatus: VerificationStatus = input.path === 'critical'
    ? input.reviewed ? 'INDEPENDENT_PASS' : 'NOT_PERFORMED'
    : input.reviewed ? 'INDEPENDENT_PASS' : 'NOT_PERFORMED'
  const reasons: string[] = []

  if (!nonEmpty) reasons.push('The response is empty.')
  if (!contractValid) reasons.push('The response violates the canonical response-size contract.')
  if (!coverage) reasons.push('The response does not sufficiently cover the requested objective.')
  if (!consistent) reasons.push('The response contains a detected internal contradiction.')
  if (!evidenceOk) reasons.push('The response makes live/verified claims without supplied evidence.')
  if (!structureOk) reasons.push('The response is insufficiently structured for the requested execution depth.')
  if (input.path === 'critical' && !input.reviewed) reasons.push('Critical execution requires an independent review stage before acceptance.')

  const passed = nonEmpty && contractValid && coverage && consistent && evidenceOk && structureOk && (input.path !== 'critical' || input.reviewed)
  let evidenceState: EvidenceState
  if (!input.externalExecutionSucceeded) evidenceState = 'UNAVAILABLE'
  else if (input.path === 'critical' && input.reviewed && passed) evidenceState = 'LIVE_VERIFIED'
  else if (passed) evidenceState = 'LIVE_EXECUTED'
  else evidenceState = 'PARTIAL_UNCONFIRMED'

  return {
    decision: passed ? 'PASS' : input.path === 'fast' ? 'DEGRADED' : 'ESCALATE',
    evidenceState,
    verificationStatus,
    checks: { nonEmpty, contractValid, objectiveCoverage: coverage, internalConsistency: consistent, evidenceDiscipline: evidenceOk, actionableStructure: structureOk },
    reasons: reasons.length ? reasons : ['Response satisfied the applicable deterministic quality contract.'],
  }
}

export function evaluateFastResponse(content: string, objective: string): QualityResult {
  return evaluateCeoQuality({ objective, content, path: 'fast', reviewed: false, externalExecutionSucceeded: true })
}
