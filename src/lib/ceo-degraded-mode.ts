import { recallPersistentMemory } from './persistent-memory'
import { synthesizeExecutiveReadiness, type SelfReflectionKind } from './ceo-self-reflection'
import type { CeoIntent, EvidenceState, ResponseAction } from './ceo-cognitive-contract'
import type { CeoFailureReason } from './ceo-failure-reason'
import { emitConversationIncident } from './ceo-conversation-incident'
import { emitIncidentRegressionCandidate } from './ceo-incident-regression-candidate'
import type { PersistedConversationRow } from './ceo-context-composer'
import { riskClassForDomain } from './architecture-integrity-contract'
import { filterConversationalMemories } from './ceo-memory-visibility'

export interface DegradedResponse { content: string; evidenceState: EvidenceState; reason: string; sourceKeys: string[]; failureReason: CeoFailureReason; recoveredCapability: 'conversation' | 'reasoning' | 'evidence' | 'tool' | 'mission' | 'production' | 'context' }
type MemoryRecall = typeof recallPersistentMemory

const INTERNAL_MARKER_PATTERNS: RegExp[] = [
  /\bOPERATIONAL EXECUTION RESULT\b\s*/g,
  /\bFinal answer:\s*/g,
  /\bCompleted steps:\s*\d+\s*Tool steps:\s*\d+\b\s*/g,
  /\bEVIDENCE BUNDLE:[^\n]*\n?/g,
  /\bEvidence state:\s*\S+\.?\s*/g,
  /\bQuality gate:\s*\S+\.?\s*/g,
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
  void reason
  return { evidenceState: 'UNAVAILABLE', reason, sourceKeys: [], failureReason, recoveredCapability: 'evidence', content: `I can’t give you a responsible decision-grade answer yet because the evidence required for this high-risk decision is incomplete.\n\nI won’t substitute memory, stale information, or an unverified execution result for the missing evidence.\n\nRequest: ${objective.slice(0, 800)}` }
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

function isContinuityRecoveryRequest(objective: string): boolean {
  return /\b(?:what did we decide|where do we stand|what have we ruled out|continue|earlier|previous|prior|same|as before|what about the (?:first|second|third|last|other) option|based on what we established|from where we left off|what did we discuss|what was the reasoning)\b/i.test(objective)
}

function buildNaturalRecoveryResponse(input: { objective: string; action?: ResponseAction; priorConversation?: readonly PersistedConversationRow[]; recoveredContext?: string; isSuppliedByCaller?: boolean }): string | null {
  const objective = input.objective.trim(); if (!objective) return null
  const action = input.action ?? 'answer'
  const priorUsers = (input.priorConversation ?? []).filter((row) => row.role === 'user').map((row) => row.content.trim()).filter(Boolean)
  const lower = objective.toLowerCase()
  if (/^\s*(?:no|nah)\b/i.test(objective) || /\b(i meant|i mean|rather|instead)\b/i.test(lower)) { const correction = objective.replace(/^\s*(?:no|nah)[,.:;\s]*/i, '').trim(); if (correction) return `Got it. The correction is clear. I'll use that as the active direction from here.` }
  if (action === 'challenge') {
    const grounding = (input.recoveredContext ?? '').trim()
    return `I couldn't complete the challenge path reliably, so I don't want to manufacture an argument or pretend I evaluated the current question properly.${grounding && input.isSuppliedByCaller ? ` I can use the supplied context to continue once the reasoning path is available.` : ''}`
  }
  if (action === 'recommend' || action === 'decide') {
    const grounding = (input.recoveredContext ?? '').trim()
    if (!grounding || !input.isSuppliedByCaller) return `I couldn't produce a reliable recommendation for this specific request, so I won't substitute a generic priority or repeat an earlier decision.`
    return `I couldn't complete the recommendation path reliably. I can preserve the supplied evidence, but I won't turn it into a stronger recommendation than the failed path supports.`
  }
  if (action === 'explain') {
    return `I couldn't reliably complete the explanation you asked for, so I won't replace it with a generic explanation that may answer a different question.`
  }
  if (action === 'verify') {
    return `I couldn't complete the verification path for this specific request, so I won't claim that the requested fact or state was verified.`
  }
  if (action === 'execute') {
    return `I couldn't complete the execution path for this specific request, so I won't claim that the action occurred.`
  }
  if (/copy|competitor/i.test(lower)) return `I wouldn't make copying a competitor our safest strategy. My preference is to study what works, keep the useful underlying principles, and build the version that fits our strengths and creates a reason for customers to choose us.`
  if (/priorit|what should we (?:do|focus)|what comes first|before adding/i.test(lower)) {
    if (/compliance/i.test(lower) || /compliance/i.test(input.recoveredContext ?? '') || /compliance/i.test(priorUsers.join(' '))) return `I'd put compliance first, then build the operations foundation around it, and add new integrations after that.`
    if (/revenue/i.test(lower)) return `I'd treat revenue as the business outcome to optimize, but I would first make sure the operational foundation is strong enough to execute and measure it.`
  }
  if (action === 'answer' && !isContinuityRecoveryRequest(objective)) {
    return `I couldn't reliably complete that specific request, so I don't want to give you a generic answer that could miss what you're actually asking.`
  }
  const grounding = (input.recoveredContext ?? '').trim()
  if (grounding && input.isSuppliedByCaller) return `I couldn't complete the normal reasoning path, but I can safely preserve the supplied context without presenting it as a verified conclusion.\n\n${grounding.slice(0, 4000)}`
  if (isContinuityRecoveryRequest(objective) && priorUsers.length) {
    const recent = priorUsers.slice(-5)
    const latestCorrection = [...recent].reverse().find((item) => /\b(i meant|instead|rather|no,?)/i.test(item))
    if (latestCorrection) return `The latest clear direction in this conversation is the correction you gave me. I will treat that as the active thread rather than reopening the earlier option.`
  }
  return null
}

export async function buildCeoDegradedResponse(input: { objective: string; intent: CeoIntent; responseAction?: ResponseAction; selfReflectionKind?: SelfReflectionKind; reason: string; failureReason?: CeoFailureReason; missionId?: string; contextualEvidence?: string; priorConversation?: readonly PersistedConversationRow[]; recall?: MemoryRecall; domain?: string }): Promise<DegradedResponse> {
  const failureReason = input.failureReason ?? inferFailureReason(input.reason)
  if (requiresDecisionGradeAbstention({ objective: input.objective, failureReason, domain: input.domain })) return buildRiskAbstention(input.objective, input.reason, failureReason)
  if (input.intent === 'conversation' || input.intent === 'opinion') { const incident = emitConversationIncident({ objective: input.objective, intent: input.intent, failureReason }); emitIncidentRegressionCandidate({ incident, message: input.objective }) }
  const suppliedContext = input.contextualEvidence?.trim()
  const recall = input.recall ?? recallPersistentMemory
  const query = [input.missionId, input.objective].filter(Boolean).join(' ')
  const memories = suppliedContext ? [] : filterConversationalMemories(await recall(query, 5))
  const recoveredContext = suppliedContext || formatMemoryEvidence(memories)
  const sourceKeys = memories.map((entry) => entry.key)
  const recoveredCapability = capabilityForFailure(failureReason)
  if (input.intent !== 'self_assessment') {
    const natural = buildNaturalRecoveryResponse({ objective: input.objective, action: input.responseAction, priorConversation: input.priorConversation, recoveredContext, isSuppliedByCaller: Boolean(suppliedContext) })
    if (natural) {
      const safeContent = natural.includes('continuous_loop_trace') ? `I couldn't complete that specific request reliably, so I won't expose internal execution records.` : natural
      return { evidenceState: suppliedContext ? 'PARTIAL_UNCONFIRMED' : (isContinuityRecoveryRequest(input.objective) && sourceKeys.length ? 'MEMORY_ONLY' : 'PARTIAL_UNCONFIRMED'), reason: input.reason, sourceKeys: isContinuityRecoveryRequest(input.objective) ? sourceKeys : [], failureReason, recoveredCapability, content: safeContent }
    }
  }
  if (input.intent === 'self_assessment') return { evidenceState: suppliedContext ? 'PARTIAL_UNCONFIRMED' : 'MEMORY_ONLY', reason: input.reason, sourceKeys, failureReason, recoveredCapability, content: buildSelfAssessmentArchitectureFallback(input.objective, recoveredContext, input.selfReflectionKind) }
  if (isContinuityRecoveryRequest(input.objective) && recoveredContext.trim()) return { evidenceState: suppliedContext ? 'PARTIAL_UNCONFIRMED' : 'MEMORY_ONLY', reason: input.reason, sourceKeys, failureReason, recoveredCapability, content: `I couldn't complete the normal reasoning path, but I can use the conversation context to preserve continuity without claiming fresh verification.\n\n${recoveredContext.slice(0, 12000)}` }
  if (recoveredCapability === 'conversation' || recoveredCapability === 'context') return { evidenceState: 'PARTIAL_UNCONFIRMED', reason: input.reason, sourceKeys: [], failureReason, recoveredCapability, content: `I couldn't give you a reliable answer to that specific request from the available execution path, and I don't want to substitute an unrelated answer.` }
  return { evidenceState: 'UNAVAILABLE', reason: input.reason, sourceKeys: [], failureReason, recoveredCapability, content: `I wasn't able to verify the part of this answer that depends on the failed execution path, and I won't pretend that I did. I can still separate what is known from what remains unverified.` }
}
