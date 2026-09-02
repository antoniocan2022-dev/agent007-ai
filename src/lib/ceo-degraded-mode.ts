import { recallPersistentMemory } from './persistent-memory'
import { synthesizeExecutiveReadiness, type SelfReflectionKind } from './ceo-self-reflection'
import type { CeoIntent, EvidenceState } from './ceo-cognitive-contract'
import type { CeoFailureReason } from './ceo-failure-reason'
import { emitConversationIncident } from './ceo-conversation-incident'
import { emitIncidentRegressionCandidate } from './ceo-incident-regression-candidate'

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
  return entries.slice(0, 5).map((entry, index) => `${index + 1}. [${entry.category}] ${entry.key}: ${entry.value.slice(0, 5000)}`).join('\n\n')
}

function capabilityForFailure(reason: CeoFailureReason): DegradedResponse['recoveredCapability'] {
  if (reason.startsWith('provider_') || reason === 'execution_timeout' || reason === 'quality_failure' || reason === 'claim_consistency_failure') return 'reasoning'
  if (reason.startsWith('evidence_')) return 'evidence'
  if (reason.startsWith('tool_')) return 'tool'
  if (reason === 'context_unavailable' || reason === 'continuity_failure') return 'context'
  if (reason === 'production_verification_failure') return 'production'
  if (reason === 'mission_failure') return 'mission'
  return 'conversation'
}

function inferFailureReason(message: string): CeoFailureReason {
  if (/timeout|timed out/i.test(message)) return 'execution_timeout'
  if (/provider|model|llm/i.test(message)) return 'provider_error'
  if (/evidence|source|research/i.test(message)) return 'evidence_unavailable'
  if (/quality|contradiction|claim/i.test(message)) return 'quality_failure'
  if (/tool/i.test(message)) return 'tool_error'
  if (/mission|workflow|orchestrat/i.test(message)) return 'mission_failure'
  if (/context|conversation|memory/i.test(message)) return 'context_unavailable'
  return 'unknown'
}

function buildSelfAssessmentArchitectureFallback(objective: string, recoveredContext: string, selfReflectionKind?: SelfReflectionKind): string {
  const evidenceBlock = recoveredContext.trim() ? `\n\nHere's what I can ground that in internally:\n${recoveredContext.slice(0, 9000)}` : ''
  const readiness = selfReflectionKind === 'readiness_assessment'
    ? synthesizeExecutiveReadiness({ operationalCapabilityVerified: true, liveExecutionVerified: false, productionTrafficVerified: false, repeatableBusinessOutcomesVerified: false, sustainedAutonomyVerified: false })
    : null
  const readinessBlock = readiness ? `\n\n${readiness.capability} ${readiness.verified} ${readiness.notProven} What would actually move this forward: ${readiness.nextEvidence}` : ''
  return `Here's my honest self-assessment: architecturally, I'm built to manage business operations through a governed CEO layer, organization model, provider failover, execution contracts, quality gates, memory, and operational tooling. That's real, and it's not nothing.\n\nWhat I'm not yet justified in claiming is fully autonomous business management just from having that architecture in place. Real-world readiness also needs verified live execution, reliable external integrations, actual customer outcomes, financial controls, and results that hold up over time.\n\nSo the honest answer is: I'm ready to operate as a governed system with you in the loop. I'm not yet proven for running things unsupervised end to end.${readinessBlock}${evidenceBlock}`
}

export async function buildCeoDegradedResponse(input: {
  objective: string
  intent: CeoIntent
  selfReflectionKind?: SelfReflectionKind
  reason: string
  failureReason?: CeoFailureReason
  missionId?: string
  contextualEvidence?: string
  recall?: MemoryRecall
}): Promise<DegradedResponse> {
  const failureReason = input.failureReason ?? inferFailureReason(input.reason)
  if (input.intent === 'conversation' || input.intent === 'opinion') {
    const incident = emitConversationIncident({ objective: input.objective, intent: input.intent, failureReason })
    emitIncidentRegressionCandidate({ incident, message: input.objective })
  }
  const suppliedContext = input.contextualEvidence?.trim()
  const recall = input.recall ?? recallPersistentMemory
  const query = [input.missionId, input.objective].filter(Boolean).join(' ')
  const memories = suppliedContext ? [] : await recall(query, 5)
  const recoveredContext = suppliedContext || formatMemoryEvidence(memories)
  const sourceKeys = memories.map((entry) => entry.key)
  const recoveredCapability = capabilityForFailure(failureReason)

  if (recoveredContext.trim()) {
    return {
      evidenceState: suppliedContext ? 'PARTIAL_UNCONFIRMED' : 'MEMORY_ONLY',
      reason: input.reason,
      sourceKeys,
      failureReason,
      recoveredCapability,
      content: `I couldn't complete full live verification on this one, so let me work from what we've already established in this conversation and from memory instead.\n\n${recoveredContext.slice(0, 12000)}\n\nIf you need this confirmed against current external facts or a fresh check, let me know and I'll try that path directly.`,
    }
  }

  if (input.intent === 'self_assessment') {
    return {
      evidenceState: 'PARTIAL_UNCONFIRMED',
      reason: input.reason,
      sourceKeys,
      failureReason,
      recoveredCapability,
      content: buildSelfAssessmentArchitectureFallback(input.objective, recoveredContext, input.selfReflectionKind),
    }
  }

  if (recoveredCapability === 'conversation' || recoveredCapability === 'context') {
    return {
      evidenceState: 'PARTIAL_UNCONFIRMED',
      reason: input.reason,
      sourceKeys,
      failureReason,
      recoveredCapability,
      content: `Sorry, I wasn't able to put together a reliable answer to that one. Could you rephrase it, or tell me a bit more about what you're going for?`,
    }
  }

  return {
    evidenceState: 'UNAVAILABLE',
    reason: input.reason,
    sourceKeys,
    failureReason,
    recoveredCapability,
    content: `I wasn't able to work through that one reliably, and I'd rather tell you that than guess. Could you try rephrasing it, or let me know what you're actually trying to figure out here? I'll take another pass at it.`,
  }
}
