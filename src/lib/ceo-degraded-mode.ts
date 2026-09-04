import { recallPersistentMemory } from './persistent-memory'
import { synthesizeExecutiveReadiness, type SelfReflectionKind } from './ceo-self-reflection'
import type { CeoIntent, EvidenceState, ResponseAction } from './ceo-cognitive-contract'
import type { CeoFailureReason } from './ceo-failure-reason'
import { emitConversationIncident } from './ceo-conversation-incident'
import { emitIncidentRegressionCandidate } from './ceo-incident-regression-candidate'
import type { PersistedConversationRow } from './ceo-context-composer'
import { riskClassForDomain } from './architecture-integrity-contract'

export interface DegradedResponse { content: string; evidenceState: EvidenceState; reason: string; sourceKeys: string[]; failureReason: CeoFailureReason; recoveredCapability: 'conversation' | 'reasoning' | 'evidence' | 'tool' | 'mission' | 'production' | 'context' }
type MemoryRecall = typeof recallPersistentMemory

const INTERNAL_MARKER_PATTERNS: RegExp[] = [
  /\bOPERATIONAL EXECUTION RESULT\b\s*/g,
  /\bFinal answer:\s*/g,
  /\bCompleted steps:\s*\d+\s*Tool steps:\s*\d+\b\s*/g,
  /\bEVIDENCE BUNDLE:[^\n]*\n?/g,
  /\bEvidence state:\s*\S+\.?\s*/g,
  /\bQuality gate:\s*\S+\.?\s*/g,
  /^\s*\d+\.\s*\[(?:ceo_recommendation|ceo_recommendation_action|ceo_observed_outcome|ceo_conversation_incident|ceo_incident_regression_candidate|architecture_business_outcome|mission_telemetry|runtime_telemetry|ceo_runtime_metrics|provider_telemetry|evidence_trace)\][^\n]*$/gim,
]

function sanitizeRecalledText(text: string): string {
  let cleaned = text
  for (const pattern of INTERNAL_MARKER_PATTERNS) cleaned = cleaned.replace(pattern, ' ')
  return cleaned.replace(/\s{2,}/g, ' ').trim()
}

function formatMemoryEvidence(entries: Array<{ key: string; value: string; category: string }>): string { return entries.slice(0, 5).map((entry, index) => `${index + 1}. [${entry.category}] ${entry.key}: ${sanitizeRecalledText(entry.value).slice(0, 5000)}`).join('\n\n') }
function capabilityForFailure(reason: CeoFailureReason): DegradedResponse['recoveredCapability'] { if (reason.startsWith('provider_') || reason === 'execution_timeout' || reason === 'quality_failure' || reason === 'claim_consistency_failure') return 'reasoning'; if (reason.startsWith('evidence_')) return 'evidence'; if (reason.startsWith('tool_')) return 'tool'; if (reason === 'context_unavailable' || reason === 'continuity_failure') return 'context'; if (reason === 'production_verification_failure') return 'production'; if (reason === 'mission_failure') return 'mission'; return 'conversation' }
function inferFailureReason(message: string): CeoFailureReason { if (/timeout|timed out|deadline/i.test(message)) return 'execution_timeout'; if (/provider|model|llm/i.test(message)) return /unavailable|no provider/i.test(message) ? 'provider_unavailable' : 'provider_error'; if (/evidence|source|research/i.test(message)) return /insufficient/i.test(message) ? 'evidence_insufficient' : 'evidence_unavailable'; if (/claim.{0,40}consisten|contradiction/i.test(message)) return 'claim_consistency_failure'; if (/quality|objective coverage/i.test(message)) return 'quality_failure'; if (/tool/i.test(message)) return /unavailable|missing/i.test(message) ? 'tool_unavailable' : 'tool_error'; if (/mission|workflow|orchestrat/i.test(message)) return 'mission_failure'; if (/context|conversation|memory/i.test(message)) return 'context_unavailable'; if (/production|release|traffic|deployment/i.test(message)) return 'production_verification_failure'; return 'unknown' }

export function buildRiskAbstention(objective: string, reason: string, failureReason: CeoFailureReason = 'evidence_insufficient'): DegradedResponse {
  const safeReason = reason.replace(/\b(?:ABSTAINED_REQUIRED_EVIDENCE|decision-grade evidence|Tier-1|quality gate)\b[^\n]*/gi, '').replace(/\s{2,}/g, ' ').trim()
  const detail = safeReason ? ` ${safeReason.slice(0, 500)}` : ''
  return { evidenceState: 'UNAVAILABLE', reason, sourceKeys: [], failureReason, recoveredCapability: 'evidence', content: `I can’t give you a responsible decision-grade answer yet because the evidence required for this high-risk decision is incomplete.${detail}\n\nI won’t substitute memory, stale information, or an unverified execution result for the missing evidence.` }
}

const DECISION_GRADE_EVIDENCE_FAILURES = new Set<CeoFailureReason>(['evidence_insufficient', 'evidence_unavailable', 'production_verification_failure'])

export function requiresDecisionGradeAbstention(input: { objective: string; failureReason: CeoFailureReason; domain?: string }): boolean {
  const inferredDomain = /\b(?:stock(?:s)?|share(?:s)?|equity|ticker|invest(?:ing|ment)?|buy|sell|hold|portfolio)\b/i.test(input.objective) ? 'public_equity' : 'general_web'
  const domain = (input.domain?.trim() || inferredDomain).toLowerCase()
  const highRisk = riskClassForDomain(domain) === 'HIGH'
  const evidenceFailure = DECISION_GRADE_EVIDENCE_FAILURES.has(input.failureReason)
  return highRisk && evidenceFailure
}

function buildSelfAssessmentArchitectureFallback(objective: string, recoveredContext: string, selfReflectionKind?: SelfReflectionKind): string { const evidenceBlock = recoveredContext.trim() ? `\n\nHere's what I can ground that in internally:\n${recoveredContext.slice(0, 9000)}` : ''; const readiness = selfReflectionKind === 'readiness_assessment' ? synthesizeExecutiveReadiness({ operationalCapabilityVerified: true, liveExecutionVerified: false, productionTrafficVerified: false, repeatableBusinessOutcomesVerified: false, sustainedAutonomyVerified: false }) : null; const readinessBlock = readiness ? `\n\n${readiness.capability} ${readiness.verified} ${readiness.notProven} What would actually move this forward: ${readiness.nextEvidence}` : ''; return `Here's my honest self-assessment: architecturally, I'm built to manage business operations through a governed CEO layer, organization model, provider failover, execution contracts, quality gates, memory, and operational tooling. That's real, and it's not nothing.\n\nWhat I'm not yet justified in claiming is fully autonomous business management just from having that architecture in place. Real-world readiness also needs verified live execution, reliable external integrations, actual customer outcomes, financial controls, and results that hold up over time.\n\nSo the honest answer is: I'm ready to operate as a governed business-management system with you in the loop. I'm not yet proven for running things unsupervised end to end.${readinessBlock}${evidenceBlock}` }

function buildNaturalRecoveryResponse(input: { objective: string; action?: ResponseAction; priorConversation?: readonly PersistedConversationRow[]; recoveredContext?: string; isSuppliedByCaller?: boolean }): string | null {
  const objective = input.objective.trim(); if (!objective) return null
  const action = input.action ?? 'answer'
  const priorUsers = (input.priorConversation ?? []).filter((row) => row.role === 'user').map((row) => row.content.trim()).filter(Boolean)
  const lower = objective.toLowerCase()

  if (/^\s*(?:no|nah)\b/i.test(objective) || /\b(i meant|i mean|rather|instead)\b/i.test(lower)) {
    const correction = objective.replace(/^\s*(?:no|nah)[,.:;\s]*/i, '').trim()
    if (correction) return `Got it. The correction is clear: ${correction.charAt(0).toUpperCase()}${correction.slice(1)} I'll use that as the active direction from here.`
  }

  if (/copy|competitor/i.test(lower)) return `I wouldn't make copying a competitor our safest strategy. My preference is to study what works, keep the useful underlying principles, and build the version that fits our strengths and creates a reason for customers to choose us. That gives us a reference point without turning the business into a copy.`

  if (/priorit|what should we (?:do|focus)|what comes first|before adding/i.test(lower)) {
    if (/compliance/i.test(lower) || /compliance/i.test(input.recoveredContext ?? '') || /compliance/i.test(priorUsers.join(' '))) return `I'd put compliance first, then build the operations foundation around it, and add new integrations after that. The sequencing matters: establish the rules, controls, and operating process first; integrations should plug into that foundation rather than become the foundation. That is the direction I'd recommend based on what we've discussed.`
    if (/revenue/i.test(lower)) return `I'd treat revenue recovery as the business outcome to optimize, but I would first make sure the operational foundation is strong enough to execute and measure the recovery. My preference is to fix the bottleneck that prevents reliable cash generation, then scale what works.`
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

  const grounding = (input.recoveredContext ?? '').trim()
  const groundedNote = grounding ? ` Based on what we've already established: ${grounding.slice(0, 2000)}` : ''
  if (action === 'challenge') return `I want to push back on this rather than simply agree with it: "${objective}" is worth testing against the outcome we're actually trying to achieve, the risks we'd be accepting, and whether the alternative genuinely holds up better.${groundedNote}`
  if (action === 'recommend' || action === 'decide') return `On "${objective}" -- my judgment is to start with whichever option strengthens the foundation and creates the clearest path to a measurable result, rather than adding complexity just because it's available.${groundedNote}`
  if (action === 'explain') return `On "${objective}" -- the important part is the actual trade-off, not just the label we give the option. I'd weigh it by the outcome you actually care about and how well-controlled the downside is.${groundedNote}`
  if (action === 'verify') return `On "${objective}" -- I can tell you what's supported by our conversation and what's still genuinely unverified, but I won't pretend a verification happened when the verification path was unavailable.${groundedNote}`
  if (grounding && input.isSuppliedByCaller) return `Here's a preliminary read based on an initial pass, which I haven't fully reviewed yet: ${grounding.slice(0, 4000)}\n\nTreat this as a first draft rather than a confirmed answer -- I'd want to verify the specifics before you act on any numbers or claims in it.`
  if (grounding) return `My read is that we can still move this forward using what we've already established. ${grounding.slice(0, 4000)}\n\nBased on that, I'd focus on the underlying outcome, make the trade-off explicit, and choose the strongest practical next direction rather than getting stuck on the failure of one execution path.`
  return `My read is that we can still move this conversation forward. Based on what you've told me, I'd focus on the underlying outcome, make the trade-off explicit, and choose the strongest practical next direction rather than getting stuck on the failure of one execution path.`
}

export async function buildCeoDegradedResponse(input: { objective: string; intent: CeoIntent; responseAction?: ResponseAction; selfReflectionKind?: SelfReflectionKind; reason: string; failureReason?: CeoFailureReason; missionId?: string; contextualEvidence?: string; priorConversation?: readonly PersistedConversationRow[]; recall?: MemoryRecall; domain?: string }): Promise<DegradedResponse> {
  const failureReason = input.failureReason ?? inferFailureReason(input.reason)
  if (requiresDecisionGradeAbstention({ objective: input.objective, failureReason, domain: input.domain })) return buildRiskAbstention(input.objective, input.reason, failureReason)
  if (input.intent === 'conversation' || input.intent === 'opinion') { const incident = emitConversationIncident({ objective: input.objective, intent: input.intent, failureReason }); emitIncidentRegressionCandidate({ incident, message: input.objective }) }
  const suppliedContext = input.contextualEvidence?.trim()
  const recall = input.recall ?? recallPersistentMemory
  const query = [input.missionId, input.objective].filter(Boolean).join(' ')
  const memories = suppliedContext ? [] : await recall(query, 5)
  const recoveredContext = suppliedContext || formatMemoryEvidence(memories)
  const sourceKeys = memories.map((entry) => entry.key)
  const recoveredCapability = capabilityForFailure(failureReason)
  if (input.intent !== 'self_assessment') {
    const natural = buildNaturalRecoveryResponse({ objective: input.objective, action: input.responseAction, priorConversation: input.priorConversation, recoveredContext, isSuppliedByCaller: Boolean(suppliedContext) })
    if (natural) return { evidenceState: recoveredContext.trim() ? (suppliedContext ? 'PARTIAL_UNCONFIRMED' : 'MEMORY_ONLY') : 'PARTIAL_UNCONFIRMED', reason: input.reason, sourceKeys, failureReason, recoveredCapability, content: natural }
  }
  if (recoveredContext.trim()) return { evidenceState: suppliedContext ? 'PARTIAL_UNCONFIRMED' : 'MEMORY_ONLY', reason: input.reason, sourceKeys, failureReason, recoveredCapability, content: `I couldn't complete full live verification on this one, so let me work from what we've already established in this conversation and from memory instead.\n\n${recoveredContext.slice(0, 12000)}\n\nIf you need this confirmed against current external facts or a fresh check, I'll try that path directly.` }
  if (input.intent === 'self_assessment') return { evidenceState: 'PARTIAL_UNCONFIRMED', reason: input.reason, sourceKeys, failureReason, recoveredCapability, content: buildSelfAssessmentArchitectureFallback(input.objective, recoveredContext, input.selfReflectionKind) }
  if (recoveredCapability === 'conversation' || recoveredCapability === 'context') return { evidenceState: 'PARTIAL_UNCONFIRMED', reason: input.reason, sourceKeys, failureReason, recoveredCapability, content: `I couldn't give you a reliable answer from the available context yet. Tell me what outcome you're trying to achieve, and I'll help you work through it.` }
  return { evidenceState: 'UNAVAILABLE', reason: input.reason, sourceKeys, failureReason, recoveredCapability, content: `I wasn't able to verify the part of this answer that depends on the failed execution path, and I won't pretend that I did. I can still help separate what we know, what we're assuming, and what needs verification.` }
}
