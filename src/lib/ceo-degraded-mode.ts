import type { EvidenceState } from './ceo-cognitive-contract'

export interface DegradedResponse {
  content: string
  evidenceState: EvidenceState
  reason: string
}

export function buildCeoDegradedResponse(input: {
  objective: string
  reason: string
  contextualEvidence?: string
}): DegradedResponse {
  const context = input.contextualEvidence?.trim()
  if (context) {
    return {
      evidenceState: 'MEMORY_ONLY',
      reason: input.reason,
      content: `Evidence state: MEMORY-ONLY.\n\nLive external reasoning is currently unavailable, so I will not present new unverified facts as if they were current. Based only on the verified context already available to Agent007, the strongest supported information is:\n\n${context.slice(0, 12000)}\n\nRequested objective: ${input.objective.slice(0, 2000)}\n\nWhat requires live verification: current external facts, new research, and any conclusion that depends on unavailable providers.`,
    }
  }

  return {
    evidenceState: 'UNAVAILABLE',
    reason: input.reason,
    content: `Evidence state: UNAVAILABLE.\n\nAgent007 cannot currently reach an external reasoning provider for this request. I will not fabricate a live or verified answer.\n\nRequested objective: ${input.objective.slice(0, 2000)}\n\nI can safely resume the full reasoning path when an approved provider becomes available.`,
  }
}
