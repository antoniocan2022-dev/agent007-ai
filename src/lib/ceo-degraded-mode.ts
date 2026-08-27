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

function isSelfAssessment(objective: string): boolean {
  return /\b(?:you|your|yourself|agent007|ceo)\b/i.test(objective)
    && /\b(?:self[-\s]?(?:analysis|assessment|reflection)|ready|readiness|capable|capability|prepared|equipped|strengths?|weakness(?:es)?|manage\s+(?:a\s+)?business(?:es)?|run\s+(?:a\s+)?business(?:es)?|how(?:'s|\s+is)\s+(?:it|agent007|the\s+system)\s+going)\b/i.test(objective)
}

function buildSelfAssessmentArchitectureFallback(objective: string, recoveredContext: string): string {
  const evidenceBlock = recoveredContext.trim()
    ? `\n\nInternal evidence currently available:\n${recoveredContext.slice(0, 9000)}`
    : ''
  return `Evidence state: INTERNAL-STATE-ONLY.\n\nI can still give a truthful self-assessment without pretending live external verification succeeded.\n\n## Self-assessment\n- Architecturally, Agent007 is designed to manage business operations through a governed CEO layer, canonical organization model, provider failover, execution contracts, quality gates, memory, and operational tooling.\n- I am **not yet justified in claiming fully autonomous business management** solely from architecture. Real-world business readiness also requires verified live execution, reliable external integrations, customer outcomes, financial controls, and sustained production results.\n- Therefore the defensible position is: **ready to operate as a governed business-management system with human oversight; not yet proven for unsupervised end-to-end business ownership.**${evidenceBlock}\n\nRequested objective: ${objective.slice(0, 2000)}`
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
      content: `Evidence state: MEMORY-ONLY.\n\nThe live reasoning path did not produce an accepted final answer, so Agent007 will not present new unverified facts as current. Based only on the internal evidence currently available, the strongest supported information is:\n\n${recoveredContext.slice(0, 12000)}\n\nRequested objective: ${input.objective.slice(0, 2000)}\n\nWhat still requires live verification: current external facts, new research, and conclusions that depend on unavailable execution.`,
    }
  }

  if (isSelfAssessment(input.objective)) {
    return {
      evidenceState: 'PARTIAL_UNCONFIRMED',
      reason: input.reason,
      sourceKeys,
      content: buildSelfAssessmentArchitectureFallback(input.objective, recoveredContext),
    }
  }

  return {
    evidenceState: 'UNAVAILABLE',
    reason: input.reason,
    sourceKeys,
    content: `Evidence state: UNAVAILABLE.\n\nThe live reasoning path did not produce an accepted final answer and no relevant internal evidence was recovered for this request. Agent007 will not fabricate a live or verified answer.\n\nRequested objective: ${input.objective.slice(0, 2000)}\n\nA stronger answer requires an accepted governed reasoning result or relevant internal evidence.`,
  }
}
