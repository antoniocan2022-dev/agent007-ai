import type { QualityResult, EvidenceState } from './ceo-cognitive-contract'

function normalize(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4).slice(0, 80)
}

function objectiveCoverage(objective: string, content: string): boolean {
  const wanted = normalize(objective)
  if (!wanted.length) return true
  const answer = new Set(normalize(content))
  const matches = wanted.filter((token) => answer.has(token)).length
  return matches / wanted.length >= 0.08 || content.length >= Math.max(240, objective.length)
}

function consistency(content: string): boolean {
  if (!content.trim()) return false
  const contradictionPairs: Array<[RegExp, RegExp]> = [
    [/\bdo not\b/i, /\bmust\b[^.]{0,80}\bdo\b/i],
    [/\bno evidence\b/i, /\bverified\b/i],
    [/\bfailed\b/i, /\bsucceeded\b/i],
  ]
  return contradictionPairs.every(([a, b]) => !(a.test(content) && b.test(content)))
}

export function evaluateCeoQuality(input: {
  objective: string
  content: string
  path: 'fast' | 'full' | 'critical'
  reviewed?: boolean
  externalExecutionSucceeded?: boolean
}): QualityResult {
  const nonEmpty = Boolean(input.content.trim())
  const contractValid = nonEmpty && input.content.length <= 100_000
  const coverage = objectiveCoverage(input.objective, input.content)
  const consistent = consistency(input.content)
  const reasons: string[] = []

  if (!nonEmpty) reasons.push('The response is empty.')
  if (!contractValid) reasons.push('The response violates the canonical response-size contract.')
  if (!coverage) reasons.push('The response does not sufficiently cover the requested objective.')
  if (!consistent) reasons.push('The response contains a detected internal contradiction.')
  if (input.path === 'critical' && !input.reviewed) reasons.push('Critical execution requires an independent review stage before acceptance.')

  const passed = nonEmpty && contractValid && coverage && consistent && (input.path !== 'critical' || input.reviewed)
  const evidenceState: EvidenceState = input.externalExecutionSucceeded && passed
    ? 'LIVE_VERIFIED'
    : input.externalExecutionSucceeded
      ? 'PARTIAL_UNCONFIRMED'
      : 'UNAVAILABLE'

  return {
    decision: passed ? 'PASS' : input.path === 'fast' ? 'DEGRADED' : 'ESCALATE',
    evidenceState,
    checks: { nonEmpty, contractValid, objectiveCoverage: coverage, internalConsistency: consistent },
    reasons: reasons.length ? reasons : ['Response satisfied the applicable deterministic quality contract.'],
  }
}

export function evaluateFastResponse(content: string, objective: string): QualityResult {
  return evaluateCeoQuality({ objective, content, path: 'fast', reviewed: false, externalExecutionSucceeded: true })
}
