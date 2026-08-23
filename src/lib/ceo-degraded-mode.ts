import type { EvidenceState } from './ceo-cognitive-contract'
import { recallPersistentMemory } from './persistent-memory'

export interface DegradedResponse {
  content: string
  evidenceState: EvidenceState
  reason: string
  sourceKeys: string[]
}

type MemoryRecall = typeof recallPersistentMemory

function formatMemoryEvidence(entries: Array<{ key: string; value: string; category: string }>): string {
  return entries
    .slice(0, 5)
    .map((entry, index) => `${index + 1}. [${entry.category}] ${entry.key}: ${entry.value.slice(0, 5000)}`)
    .join('\n\n')
}

/**
 * Degraded mode is a real internal-evidence recovery path, not a substitute
 * for live reasoning. It queries persistent memory automatically when the
 * caller did not provide a pre-assembled evidence string.
 *
 * `recall` is injectable only for deterministic tests; production defaults to
 * the canonical persistent-memory implementation.
 */
export async function buildCeoDegradedResponse(input: {
  objective: string
  reason: string
  missionId?: string
  contextualEvidence?: string
  recall?: MemoryRecall
}): Promise<DegradedResponse> {
  const suppliedContext = input.contextualEvidence?.trim()
  const recall = input.recall ?? recallPersistentMemory
  const query = [input.missionId, input.objective].filter(Boolean).join(' ')
  const memories = suppliedContext ? [] : await recall(query, 5)
  const recoveredContext = suppliedContext || formatMemoryEvidence(memories)
  const sourceKeys = memories.map((entry) => entry.key)

  if (recoveredContext.trim()) {
    return {
      evidenceState: 'MEMORY_ONLY',
      reason: input.reason,
      sourceKeys,
      content: `Evidence state: MEMORY-ONLY.\n\nLive external reasoning is currently unavailable, so Agent007 will not present new unverified facts as current. Based only on the internal evidence currently available, the strongest supported information is:\n\n${recoveredContext.slice(0, 12000)}\n\nRequested objective: ${input.objective.slice(0, 2000)}\n\nWhat still requires live verification: current external facts, new research, and conclusions that depend on unavailable providers.`,
    }
  }

  return {
    evidenceState: 'UNAVAILABLE',
    reason: input.reason,
    sourceKeys,
    content: `Evidence state: UNAVAILABLE.\n\nAgent007 cannot currently reach an external reasoning provider and no relevant internal evidence was recovered for this request. Agent007 will not fabricate a live or verified answer.\n\nRequested objective: ${input.objective.slice(0, 2000)}\n\nThe full reasoning path can resume when an approved provider becomes available.`,
  }
}
