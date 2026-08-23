import type { EvidenceState, QualityResult } from './ceo-cognitive-contract'

export function composeCeoResponse(input: {
  content: string
  evidenceState: EvidenceState
  quality: QualityResult
  degraded: boolean
}): string {
  const content = input.content.trim()
  if (!content) return 'Agent007 could not produce a usable response.'

  // Keep verified live answers natural. Provenance remains in the structured
  // lifecycle result. Surface evidence state only for degraded/non-live output.
  if (!input.degraded && input.evidenceState === 'LIVE_VERIFIED') return content

  const evidenceLabel = `Evidence state: ${input.evidenceState}.`
  const qualityLabel = input.quality.decision === 'PASS' ? 'Quality gate: PASS.' : `Quality gate: ${input.quality.decision}.`
  return `${evidenceLabel}\n${qualityLabel}\n\n${content}`
}
