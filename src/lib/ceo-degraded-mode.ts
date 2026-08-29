import type { CeoIntent, EvidenceState } from './ceo-cognitive-contract'
import { recallPersistentMemory } from './persistent-memory'
import { synthesizeExecutiveReadiness, type SelfReflectionKind } from './ceo-self-reflection'

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

function buildSelfAssessmentArchitectureFallback(objective: string, recoveredContext: string, selfReflectionKind?: SelfReflectionKind): string {
  const evidenceBlock = recoveredContext.trim()
    ? `\n\nInternal evidence currently available:\n${recoveredContext.slice(0, 9000)}`
    : ''
  const readiness = selfReflectionKind === 'readiness_assessment'
    ? synthesizeExecutiveReadiness({
      operationalCapabilityVerified: true,
      liveExecutionVerified: false,
      productionTrafficVerified: false,
      repeatableBusinessOutcomesVerified: false,
      sustainedAutonomyVerified: false,
    })
    : null
  const readinessBlock = readiness
    ? `\n\nExecutive readiness synthesis:\nLevel ${readiness.level} — ${readiness.label}.\n${readiness.capability}\n${readiness.verified}\n${readiness.notProven}\nNext evidence: ${readiness.nextEvidence}`
    : ''
  return `Evidence state: INTERNAL-STATE-ONLY.\n\nI can still give a truthful self-assessment without pretending live external verification succeeded.\n\n## Self-assessment\n- Architecturally, Agent007 is designed to manage business operations through a governed CEO layer, canonical organization model, provider failover, execution contracts, quality gates, memory, and operational tooling.\n- I am **not yet justified in claiming fully autonomous business management** solely from architecture. Real-world business readiness also requires verified live execution, reliable external integrations, customer outcomes, financial controls, and sustained production results.\n- Therefore the defensible position is: **ready to operate as a governed business-management system with human oversight; not yet proven for unsupervised end-to-end business ownership.**${readinessBlock}${evidenceBlock}\n\nRequested objective: ${objective.slice(0, 2000)}`
}

/**
 * Degraded mode is a real internal-evidence recovery path, not a substitute
 * for live reasoning. The caller supplies the already-decided CEO intent so
 * this layer never reclassifies the original request from raw text.
 */
export async function buildCeoDegradedResponse(input: {
  objective: string
  intent: CeoIntent
  selfReflectionKind?: SelfReflectionKind
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

  if (input.intent === 'self_assessment') {
    return {
      evidenceState: 'PARTIAL_UNCONFIRMED',
      reason: input.reason,
      sourceKeys,
      content: buildSelfAssessmentArchitectureFallback(input.objective, recoveredContext, input.selfReflectionKind),
    }
  }

  return {
    evidenceState: 'UNAVAILABLE',
    reason: input.reason,
    sourceKeys,
    content: `Evidence state: UNAVAILABLE.\n\nThe live reasoning path did not produce an accepted final answer and no relevant internal evidence was recovered for this request. Agent007 will not fabricate a live or verified answer.\n\nRequested objective: ${input.objective.slice(0, 2000)}\n\nA stronger answer requires an accepted governed reasoning result or relevant internal evidence.`,
  }
}
