import type { CeoIntent, EvidenceState } from './ceo-cognitive-contract'
import { recallPersistentMemory } from './persistent-memory'
import { synthesizeExecutiveReadiness, type SelfReflectionKind } from './ceo-self-reflection'
import type { CeoFailureReason } from './ceo-failure-reason'

export interface DegradedResponse {
  content: string
  evidenceState: EvidenceState
  reason: string
  sourceKeys: string[]
  failureReason: CeoFailureReason
  recoveredCapability: 'conversation' | 'reasoning' | 'evidence' | 'tool' | 'mission' | 'production' | 'context'
}

type MemoryRecall = typeof recallPersistentMemory

function formatMemoryEvidence(entries: Array<{ key: string; value: string; category: string }>): string {
  return entries
    .slice(0, 5)
    .map((entry, index) => `${index + 1}. [${entry.category}] ${entry.key}: ${entry.value.slice(0, 5000)}`)
    .join('\n\n')
}

function capabilityForFailure(reason: CeoFailureReason): DegradedResponse['recoveredCapability'] {
  if (reason.startsWith('provider_') || reason === 'execution_timeout' || reason === 'quality_failure' || reason === 'claim_consistency_failure') return 'reasoning'
  if (reason.startsWith('evidence_')) return 'evidence'
  if (reason.startsWith('tool_')) return 'tool'
  if (reason === 'context_unavailable') return 'context'
  if (reason === 'production_verification_failure') return 'production'
  return 'conversation'
}

function buildSelfAssessmentArchitectureFallback(objective: string, recoveredContext: string, selfReflectionKind?: SelfReflectionKind): string {
  const evidenceBlock = recoveredContext.trim() ? `\n\nInternal evidence currently available:\n${recoveredContext.slice(0, 9000)}` : ''
  const readiness = selfReflectionKind === 'readiness_assessment'
    ? synthesizeExecutiveReadiness({ operationalCapabilityVerified: true, liveExecutionVerified: false, productionTrafficVerified: false, repeatableBusinessOutcomesVerified: false, sustainedAutonomyVerified: false })
    : null
  const readinessBlock = readiness
    ? `\n\nExecutive readiness synthesis:\nLevel ${readiness.level} — ${readiness.label}.\n${readiness.capability}\n${readiness.verified}\n${readiness.notProven}\nNext evidence: ${readiness.nextEvidence}`
    : ''
  return `Evidence state: INTERNAL-STATE-ONLY.\n\nI can still give a truthful self-assessment without pretending live external verification succeeded.\n\n## Self-assessment\n- Architecturally, Agent007 is designed to manage business operations through a governed CEO layer, canonical organization model, provider failover, execution contracts, quality gates, memory, and operational tooling.\n- I am **not yet justified in claiming fully autonomous business management** solely from architecture. Real-world business readiness also requires verified live execution, reliable external integrations, customer outcomes, financial controls, and sustained production results.\n- Therefore the defensible position is: **ready to operate as a governed business-management system with human oversight; not yet proven for unsupervised end-to-end business ownership.**${readinessBlock}${evidenceBlock}\n\nRequested objective: ${objective.slice(0, 2000)}`
}

/**
 * Degraded mode recovers the failed capability first. It never silently turns
 * a reasoning/provider failure into evidence, and it never invents a stronger
 * evidence state than the recovered source supports.
 */
export async function buildCeoDegradedResponse(input: {
  objective: string
  intent: CeoIntent
  selfReflectionKind?: SelfReflectionKind
  reason: string
  failureReason: CeoFailureReason
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
  const recoveredCapability = capabilityForFailure(input.failureReason)

  if (recoveredContext.trim()) {
    return {
      evidenceState: suppliedContext ? 'PARTIAL_UNCONFIRMED' : 'MEMORY_ONLY',
      reason: input.reason,
      sourceKeys,
      failureReason: input.failureReason,
      recoveredCapability,
      content: `Recovered capability: ${recoveredCapability}.\n\nThe primary ${recoveredCapability} path did not produce an accepted final answer, so Agent007 is using the strongest safe contextual fallback available. Prior conversation, memory, and supplied context are context only and are not treated as new external proof.\n\n${recoveredContext.slice(0, 12000)}\n\nRequested objective: ${input.objective.slice(0, 2000)}\n\nStill requires the failed capability to verify: current external facts, new research, live execution, or unsupported conclusions.`
    }
  }

  if (input.intent === 'self_assessment' || recoveredCapability === 'conversation' || recoveredCapability === 'context') {
    return {
      evidenceState: 'PARTIAL_UNCONFIRMED',
      reason: input.reason,
      sourceKeys,
      failureReason: input.failureReason,
      recoveredCapability,
      content: buildSelfAssessmentArchitectureFallback(input.objective, recoveredContext, input.selfReflectionKind),
    }
  }

  return {
    evidenceState: 'UNAVAILABLE',
    reason: input.reason,
    sourceKeys,
    failureReason: input.failureReason,
    recoveredCapability,
    content: `Evidence state: UNAVAILABLE.\n\nThe failed capability was ${recoveredCapability}. No safe fallback source was available for this request, so Agent007 will not fabricate a result.\n\nRequested objective: ${input.objective.slice(0, 2000)}`,
  }
}
