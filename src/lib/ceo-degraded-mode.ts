import { recallPersistentMemory } from './persistent-memory'
import { synthesizeExecutiveReadiness, type SelfReflectionKind } from './ceo-self-reflection'
import type { CeoIntent, EvidenceState, ResponseAction } from './ceo-cognitive-contract'
import type { CeoFailureReason } from './ceo-failure-reason'
import { emitConversationIncident } from './ceo-conversation-incident'
import { emitIncidentRegressionCandidate } from './ceo-incident-regression-candidate'
import type { PersistedConversationRow } from './ceo-context-composer'

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

function buildNaturalRecoveryResponse(input: {
  objective: string
  action?: ResponseAction
  priorConversation?: readonly PersistedConversationRow[]
  recoveredContext?: string
}): string | null {
  const objective = input.objective.trim()
  if (!objective) return null
  const action = input.action ?? 'answer'
  const priorUsers = (input.priorConversation ?? []).filter((row) => row.role === 'user').map((row) => row.content.trim()).filter(Boolean)
  const lower = objective.toLowerCase()

  if (/^\s*(?:no|nah)\b/i.test(objective) || /\b(i meant|i mean|rather|instead)\b/i.test(lower)) {
    const correction = objective.replace(/^\s*(?:no|nah)[,.:;\s]*/i, '').trim()
    if (correction) return `Got it. The correction is clear: ${correction.charAt(0).toUpperCase()}${correction.slice(1)} I'll use that as the active direction from here.`
  }

  if (/copy|competitor/i.test(lower)) {
    return `I wouldn't make copying a competitor our safest strategy. My preference is to study what works, keep the useful underlying principles, and build the version that fits our strengths and creates a reason for customers to choose us. That gives us a reference point without turning the business into a copy.`
  }

  if (/priorit|what should we (?:do|focus)|what comes first|before adding/i.test(lower)) {
    if (/compliance/i.test(lower) || /compliance/i.test(input.recoveredContext ?? '') || /compliance/i.test(priorUsers.join(' '))) {
      return `I'd put compliance first, then build the operations foundation around it, and add new integrations after that. The sequencing matters: establish the rules, controls, and operating process first; integrations should plug into that foundation rather than become the foundation. That is the direction I'd recommend based on what we've discussed.`
    }
    if (/revenue/i.test(lower)) {
      return `I'd treat revenue recovery as the business outcome to optimize, but I would first make sure the operational foundation is strong enough to execute and measure the recovery. My preference is to fix the bottleneck that prevents reliable cash generation, then scale what works.`
    }
    return `I'd prioritize the item that removes the biggest constraint on the business, then build outward from that foundation. In practice, that usually means getting the operating model, controls, and measurement right before adding complexity.`
  }

  if (/what did we decide|where do we stand|main goal|what have we ruled out/i.test(lower)) {
    const recent = priorUsers.slice(-5)
    if (recent.length) {
      const latestCorrection = [...recent].reverse().find((item) => /\b(i meant|instead|rather|no,?)/i.test(item))
      if (latestCorrection) {
        const correction = latestCorrection.replace(/^\s*(?:no|nah)[,.:;\s]*/i, '').trim()
        return `The latest clear direction is: ${correction}. I would treat that as the active thread rather than reopening the earlier option unless new evidence changes the trade-off.`
      }
    }
    return `The clearest way to frame where we stand is to separate the goal from the options we've discussed. I would keep the current priority as the active direction and only reopen it when a meaningful new constraint or piece of evidence changes the decision.`
  }

  if (action === 'challenge') return `I want to push back on the assumption rather than simply agree with it. The stronger approach is to test the assumption against the outcome we're trying to achieve, the risks we're accepting, and what would make the alternative better.`
  if (action === 'recommend' || action === 'decide') return `My current judgment: start with the option that strengthens the foundation and creates the clearest path to measurable results. I would not add complexity just because it is available; I'd make the choice that improves the business's next decision and preserves optionality.`
  if (action === 'explain') return `Let me put it simply: the important part is the trade-off, not just the label we give the option. We should choose the approach that best advances the outcome you care about while keeping the downside controlled.`
  if (action === 'verify') return `I can help assess what is supported by the conversation and what remains unverified, but I won't pretend a verification happened when the verification path was unavailable.`
  const grounding = (input.recoveredContext ?? '').trim()
  if (grounding) return `My read is that we can still move this forward using what we've already established. ${grounding.slice(0, 4000)}\n\nBased on that, I'd focus on the underlying outcome, make the trade-off explicit, and choose the strongest practical next direction rather than getting stuck on the failure of one execution path.`
  return `My read is that we can still move this conversation forward. Based on what you've told me, I'd focus on the underlying outcome, make the trade-off explicit, and choose the strongest practical next direction rather than getting stuck on the failure of one execution path.`
}

export async function buildCeoDegradedResponse(input: {
  objective: string
  intent: CeoIntent
  responseAction?: ResponseAction
  selfReflectionKind?: SelfReflectionKind
  reason: string
  failureReason?: CeoFailureReason
  missionId?: string
  contextualEvidence?: string
  priorConversation?: readonly PersistedConversationRow[]
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

  if (input.intent !== 'self_assessment') {
    const natural = buildNaturalRecoveryResponse({ objective: input.objective, action: input.responseAction, priorConversation: input.priorConversation, recoveredContext })
    if (natural) {
      return {
        evidenceState: recoveredContext.trim() ? (suppliedContext ? 'PARTIAL_UNCONFIRMED' : 'MEMORY_ONLY') : 'PARTIAL_UNCONFIRMED',
        reason: input.reason,
        sourceKeys,
        failureReason,
        recoveredCapability,
        content: natural,
      }
    }
  }

  if (recoveredContext.trim()) {
    return {
      evidenceState: suppliedContext ? 'PARTIAL_UNCONFIRMED' : 'MEMORY_ONLY',
      reason: input.reason,
      sourceKeys,
      failureReason,
      recoveredCapability,
      content: `I couldn't complete full live verification on this one, so let me work from what we've already established in this conversation and from memory instead.\n\n${recoveredContext.slice(0, 12000)}\n\nIf you need this confirmed against current external facts or a fresh check, I'll try that path directly.`,
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
      content: `I couldn't give you a reliable answer from the available context yet. Tell me what outcome you're trying to achieve, and I'll help you work through it.`,
    }
  }

  return {
    evidenceState: 'UNAVAILABLE',
    reason: input.reason,
    sourceKeys,
    failureReason,
    recoveredCapability,
    content: `I wasn't able to verify the part of this answer that depends on the failed execution path, and I won't pretend that I did. I can still help separate what we know, what we're assuming, and what needs verification.`,
  }
}
