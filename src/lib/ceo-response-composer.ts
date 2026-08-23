import type { EvidenceState, QualityResult } from './ceo-cognitive-contract'

export function composeCeoResponse(input: {
  content: string
  evidenceState: EvidenceState
  quality: QualityResult
  degraded: boolean
}): string {
  const content = input.content.trim()
  if (!content) return 'Agent007 could not produce a usable response.'

  // Live provider execution can be successful without independent evidence
  // verification. Keep normal responses natural, but surface the evidence
  // state whenever the result is degraded, cached, memory-only, or partial.
  if (!input.degraded && (input.evidenceState === 'LIVE_VERIFIED' || input.evidenceState === 'LIVE_EXECUTED')) return content

  const evidenceLabel = `Evidence state: ${input.evidenceState}.`
  const qualityLabel = input.quality.decision === 'PASS' ? 'Quality gate: PASS.' : `Quality gate: ${input.quality.decision}.`
  return `${evidenceLabel}\n${qualityLabel}\n\n${content}`
}
