import type { EvidenceState, QualityResult } from './ceo-cognitive-contract'

export function composeCeoResponse(input: {
  content: string
  evidenceState: EvidenceState
  quality: QualityResult
  degraded: boolean
}): string {
  const content = input.content.trim()
  if (!content) return 'Agent007 could not produce a usable response.'

  const evidenceLabel = `Evidence state: ${input.evidenceState}.`
  const qualityLabel = input.quality.decision === 'PASS' ? 'Quality gate: PASS.' : `Quality gate: ${input.quality.decision}.`

  if (input.degraded || input.evidenceState !== 'LIVE_VERIFIED') {
    return `${evidenceLabel}\n${qualityLabel}\n\n${content}`
  }
  return `${content}\n\n${evidenceLabel}`
}
