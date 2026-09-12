import { recallPersistentMemory } from './persistent-memory'
import { synthesizeExecutiveReadiness, type SelfReflectionKind } from './ceo-self-reflection'
import type { CeoIntent, EvidenceState, ResponseAction } from './ceo-cognitive-contract'
import type { CeoFailureReason } from './ceo-failure-reason'
import { emitConversationIncident } from './ceo-conversation-incident'
import { emitIncidentRegressionCandidate } from './ceo-incident-regression-candidate'
import { deriveCeoConversationState, safeConversationRows, type CeoConversationState, type ConversationReference, type PersistedConversationRow } from './ceo-conversation-state'
import { isCorrectionRequest, isCurrentTopicRequest, isContinuationOrRestatementRequest } from './ceo-conversational-signals'
import { riskClassForDomain } from './architecture-integrity-contract'
import { filterConversationalMemories } from './ceo-memory-visibility'
import { renderPartnerIntelligenceContext, type PartnerIntelligenceSummary } from './ceo-partner-intelligence'
import { renderExecutiveBusinessStateContext, type ExecutiveBusinessState } from './ceo-executive-state'
import { renderLeadershipPerformanceContext, type LeaderPerformanceRecord } from './ceo-leadership-performance'
import { renderStrategicHorizonContext, type StrategicHorizonView } from './ceo-strategic-horizon'

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
function sanitizeRecalledText(text: string): string { let cleaned = text; for (const pattern of INTERNAL_MARKER_PATTERNS) cleaned = cleaned.replace(pattern, ' '); return cleaned.replace(/\s{2,}/g, ' ').trim() }
function formatMemoryEvidence(entries: Array<{ key: string; value: string; category: string }>): string { return entries.slice(0, 5).map((entry, index) => `${index + 1}. [${entry.category}] ${entry.key}: ${sanitizeRecalledText(entry.value).slice(0, 5000)}`).join('\n\n') }
function capabilityForFailure(reason: CeoFailureReason): DegradedResponse['recoveredCapability'] { if (reason.startsWith('provider_') || reason === 'execution_timeout' || reason === 'quality_failure' || reason === 'claim_consistency_failure' || reason === 'false_completion_claim' || reason === 'internal_artifact_leak') return 'reasoning'; if (reason.startsWith('evidence_')) return 'evidence'; if (reason.startsWith('tool_')) return 'tool'; if (reason === 'context_unavailable' || reason === 'continuity_failure') return 'context'; if (reason === 'production_verification_failure') return 'production'; if (reason === 'mission_failure') return 'mission'; return 'conversation' }
function inferFailureReason(message: string): CeoFailureReason { if (/timeout|timed out|deadline/i.test(message)) return 'execution_timeout'; if (/provider|model|llm/i.test(message)) return /unavailable|no provider/i.test(message) ? 'provider_unavailable' : 'provider_error'; if (/evidence|source|research/i.test(message)) return /insufficient/i.test(message) ? 'evidence_insufficient' : 'evidence_unavailable'; if (/claim.{0,40}consisten|contradiction/i.test(message)) return 'claim_consistency_failure'; if (/quality|objective coverage/i.test(message)) return 'quality_failure'; if (/tool/i.test(message)) return /unavailable|missing/i.test(message) ? 'tool_unavailable' : 'tool_error'; if (/mission|workflow|orchestrat/i.test(message)) return 'mission_failure'; if (/context|conversation|memory/i.test(message)) return 'context_unavailable'; if (/production|release|traffic|deployment/i.test(message)) return 'production_verification_failure'; return 'unknown' }

export function buildRiskAbstention(objective: string, reason: string, failureReason: CeoFailureReason = 'evidence_insufficient'): DegradedResponse { void reason; return { evidenceState: 'UNAVAILABLE', reason, sourceKeys: [], failureReason, recoveredCapability: 'evidence', content: `I can’t give you a responsible decision-grade answer yet because the evidence required for this high-risk decision is incomplete.\n\nI won’t substitute memory, stale information, or an unverified execution result for the missing evidence.\n\nRequest: ${objective.slice(0, 800)}` } }
const DECISION_GRADE_EVIDENCE_FAILURES = new Set<CeoFailureReason>(['evidence_insufficient', 'evidence_unavailable', 'production_verification_failure'])
export function requiresDecisionGradeAbstention(input: { objective: string; failureReason: CeoFailureReason; domain?: string }): boolean { const inferredDomain = /\b(?:stock(?:s)?|share(?:s)?|equity|ticker|invest(?:ing|ment)?|buy|sell|hold|portfolio)\b/i.test(input.objective) ? 'public_equity' : 'general_web'; const domain = (input.domain?.trim() || inferredDomain).toLowerCase(); return riskClassForDomain(domain) === 'HIGH' && DECISION_GRADE_EVIDENCE_FAILURES.has(input.failureReason) }
interface DegradedSelfAssessmentSubsystems {
  partnerIntelligence?: PartnerIntelligenceSummary
  executiveState?: ExecutiveBusinessState
  leadershipLedger?: readonly LeaderPerformanceRecord[]
  strategicHorizon?: StrategicHorizonView
}
// Production incident 2026-09-12: this fallback used to be a fixed template plus a generic, query-driven
// recallPersistentMemory() search -- so a real self-assessment request ("give me a full self-assessment
// across partners, leadership, strategy, and decisions") got back the same boilerplate paragraphs every
// time, decorated with whichever unrelated memories happened to match the raw objective text. route.ts
// already fetches partner intelligence, executive state, the leadership ledger, and the strategic horizon
// for self-assessment turns (they feed the primary generation path in ceo-cognitive-lifecycle.ts) but
// never forwarded them into degraded mode, so a real quality-gate rejection of the primary answer still
// produced a fabricated-looking non-answer instead of the real subsystem state. Render the same subsystems
// the primary path renders, through the same render*Context functions, so a degraded self-assessment still
// tells the user what is actually true of the system rather than reciting a template.
function renderSelfAssessmentSubsystems(subsystems: DegradedSelfAssessmentSubsystems): string {
  const sections: string[] = []
  if (subsystems.partnerIntelligence) sections.push(`Partners: ${renderPartnerIntelligenceContext(subsystems.partnerIntelligence)}`)
  if (subsystems.leadershipLedger) sections.push(`Leadership: ${renderLeadershipPerformanceContext(subsystems.leadershipLedger)}`)
  if (subsystems.executiveState) sections.push(`Strategy & decisions: ${renderExecutiveBusinessStateContext(subsystems.executiveState)}`)
  if (subsystems.strategicHorizon) sections.push(`Strategic horizon: ${renderStrategicHorizonContext(subsystems.strategicHorizon)}`)
  return sections.join('\n\n')
}
function buildSelfAssessmentArchitectureFallback(objective: string, recoveredContext: string, selfReflectionKind?: SelfReflectionKind, subsystems: DegradedSelfAssessmentSubsystems = {}): string {
  void objective
  const subsystemState = renderSelfAssessmentSubsystems(subsystems)
  const subsystemBlock = subsystemState.trim() ? `\n\nHere's the actual current state across the subsystems that self-assessment depends on:\n${subsystemState.slice(0, 9000)}` : ''
  // Only fall back to the generic memory recall when no real subsystem data was supplied at all -- once
  // subsystem state is available it is strictly more accurate and specific than an untargeted memory
  // search keyed on the raw objective text, so it fully replaces the generic evidence block rather than
  // being appended alongside it.
  const evidenceBlock = !subsystemState.trim() && recoveredContext.trim() ? `\n\nHere's what I can ground that in internally:\n${recoveredContext.slice(0, 9000)}` : ''
  const readiness = selfReflectionKind === 'readiness_assessment' ? synthesizeExecutiveReadiness({ operationalCapabilityVerified: true, liveExecutionVerified: false, productionTrafficVerified: false, repeatableBusinessOutcomesVerified: false, sustainedAutonomyVerified: false }) : null
  const readinessBlock = readiness ? `\n\n${readiness.capability} ${readiness.verified} ${readiness.notProven} What would actually move this forward: ${readiness.nextEvidence}` : ''
  return `Here's my honest self-assessment: architecturally, I'm built to manage business operations through a governed CEO layer, organization model, provider failover, execution contracts, quality gates, memory, and operational tooling. That's real, and it's not nothing.\n\nWhat I'm not yet justified in claiming is fully autonomous business management just from having that architecture in place. Real-world readiness also needs verified live execution, reliable external integrations, actual customer outcomes, financial controls, and results that hold up over time.\n\nSo the honest answer is: I'm ready to operate as a governed business-management system with you in the loop. I'm not yet proven for running things unsupervised end to end.${readinessBlock}${subsystemBlock}${evidenceBlock}`
}
// Delegates to the canonical isContinuationOrRestatementRequest (ceo-conversational-signals.ts) --
// previously a local, independently-drifting regex; see that function's comment for the consolidation
// this replaced and the production incident (a "tell me in your words" restatement request landing here
// unrecognized) that motivated it.
function isContinuityRecoveryRequest(objective: string): boolean { return isContinuationOrRestatementRequest(objective) }
// The degraded/recovery path used to have no access to the conversational reference resolver's own
// output at all -- confirmed by tracing a real production transcript where "explain me more about the
// second one" and "what about the third one" both correctly resolved upstream (resolveOrdinalReference,
// 0.98 confidence, unambiguous) but degraded mode still fell back to a fully generic non-answer, because
// buildCeoDegradedResponse's input never carried the resolution forward. This reuses the exact same trust
// bar (!ambiguous, confidence>=0.7, resolvedText present) already established in the quality gate's own
// hasHighConfidenceResolvedReference, and only applies it when the resolved phrase actually appears in the
// CURRENT objective, so a stale reference from earlier in the conversation can't be used here.
function highConfidenceReferenceForObjective(objective: string, resolvedReferences?: readonly ConversationReference[]): ConversationReference | null {
  if (!resolvedReferences?.length) return null
  const lower = objective.toLowerCase()
  return resolvedReferences.find((reference) => !reference.ambiguous && reference.confidence >= 0.7 && Boolean(reference.resolvedText?.trim()) && lower.includes(reference.phrase.toLowerCase())) ?? null
}
function buildNaturalRecoveryResponse(input: { objective: string; action?: ResponseAction; priorConversation?: readonly PersistedConversationRow[]; recoveredContext?: string; isSuppliedByCaller?: boolean; intent?: CeoIntent; conversationState?: CeoConversationState; resolvedReferences?: readonly ConversationReference[] }): string | null {
  const objective = input.objective.trim(); if (!objective) return null
  const action = input.action ?? 'answer'; const intent = input.intent ?? 'conversation'
  const priorUsers = safeConversationRows(input.priorConversation ?? []).filter((row) => row.role === 'user').map((row) => row.content.trim()).filter(Boolean)
  const lower = objective.toLowerCase(); const grounding = (input.recoveredContext ?? '').trim()
  const conversationState = input.conversationState ?? (input.priorConversation?.length ? deriveCeoConversationState(input.priorConversation, objective) : undefined)
  const continuableThread = conversationState?.threads.filter((thread) => thread.status === 'active' || thread.status === 'paused').sort((a, b) => b.lastTouchedAt - a.lastTouchedAt)[0]
  if (intent === 'mission_action' && grounding) return `I couldn't complete the normal mission reasoning path, but I recovered relevant internal mission evidence. I won't present it as fresh external verification.\n\n${grounding.slice(0, 12000)}`
  if (isCurrentTopicRequest(objective) && continuableThread) return `We’re currently discussing ${[continuableThread.currentObjective, continuableThread.topic, continuableThread.title].filter(Boolean).join(' ').slice(0, 1000)}.`
  if (isCorrectionRequest(objective)) return `Got it. The correction is clear, and I’ll treat “${objective.replace(/^\s*(?:no|nah)[,\s]*/i, '').replace(/\s*$/,'').slice(0, 500)}” as the active direction from here.`
  if (/copy|competitor/i.test(lower)) return `I wouldn't make copying a competitor our safest strategy. My preference is to study what works, keep the useful underlying principles, and build the version that fits our strengths and creates a reason for customers to choose us.`
  if (action === 'challenge') return `I couldn't complete the challenge path reliably, so I don't want to manufacture an argument or pretend I evaluated the current question properly.${grounding && input.isSuppliedByCaller ? ' I can use the supplied context to continue once the reasoning path is available.' : ''}`
  if (action === 'recommend' || action === 'decide') { if (!grounding || !input.isSuppliedByCaller) return `I couldn't produce a reliable recommendation for this specific request, so I won't substitute a generic priority or repeat an earlier decision.`; return `I couldn't complete the recommendation path reliably. I can preserve the supplied evidence, but I won't turn it into a stronger recommendation than the failed path supports.` }
  if (action === 'verify') return `I couldn't complete the verification path for this specific request, so I won't claim that the requested fact or state was verified.`
  if (action === 'execute') return `I couldn't complete the execution path for this specific request, so I won't claim that the action occurred.`
  // Deliberately restricted to answer/explain: those are the exact response actions the live-transcript
  // bug affected, and both are pure conversational recall with no completion/verification claim at
  // stake. Placed after every higher-stakes action branch above (verify/execute/challenge/recommend/
  // decide) so a matching reference can never bypass their deliberately conservative, action-specific
  // denial language -- an earlier version of this branch fired unconditionally before those checks,
  // which would have let a resolved reference silently skip e.g. execute's explicit "I won't claim the
  // action occurred" guarantee.
  if (action === 'answer' || action === 'explain') {
    const resolvedReference = highConfidenceReferenceForObjective(objective, input.resolvedReferences)
    if (resolvedReference?.resolvedText) {
      const safeResolvedText = sanitizeRecalledText(resolvedReference.resolvedText)
      if (safeResolvedText) return `I couldn't complete a fresh, verified answer through the normal reasoning path, but I know exactly what you're referring to:\n\n${safeResolvedText.slice(0, 2000)}\n\nI don't want to expand on it without the verified reasoning path succeeding, so go ahead and ask again in a moment.`
    }
  }
  if (action === 'explain') return `I couldn't reliably complete the explanation you asked for, so I won't replace it with a generic explanation that may answer a different question.`
  if (/priorit|what should we (?:do|focus)|what comes first|before adding/i.test(lower)) { if (/compliance/i.test(lower) || /compliance/i.test(grounding) || /compliance/i.test(priorUsers.join(' '))) return `I'd put compliance first, then build the operations foundation around it, and add new integrations after that.`; if (/revenue/i.test(lower)) return `I'd treat revenue as the business outcome to optimize, but I would first make sure the operational foundation is strong enough to execute and measure it.` }
  if (action === 'answer' && !isContinuityRecoveryRequest(objective)) return `I couldn't reliably complete that specific request, so I don't want to give you a generic answer that could miss what you're actually asking.`
  if (grounding && input.isSuppliedByCaller) return `I couldn't complete the normal reasoning path, but I can safely preserve the supplied context without presenting it as a verified conclusion.\n\n${grounding.slice(0, 4000)}`
  if (isContinuityRecoveryRequest(objective)) {
    const latestCorrection = conversationState?.recentCorrections.at(-1)
    if (latestCorrection) return `The latest clear direction in this conversation is your correction: ${latestCorrection.slice(0, 800)} I will treat that as the active direction rather than reopening the earlier thread.`
    if (continuableThread) return `We’re continuing from the active conversation thread: ${continuableThread.title.slice(0, 800)}.`
  }
  return null
}
export async function buildCeoDegradedResponse(input: { objective: string; intent: CeoIntent; responseAction?: ResponseAction; selfReflectionKind?: SelfReflectionKind; reason: string; failureReason?: CeoFailureReason; missionId?: string; contextualEvidence?: string; priorConversation?: readonly PersistedConversationRow[]; recall?: MemoryRecall; domain?: string; conversationState?: CeoConversationState; resolvedReferences?: readonly ConversationReference[]; partnerIntelligence?: PartnerIntelligenceSummary; executiveState?: ExecutiveBusinessState; leadershipLedger?: readonly LeaderPerformanceRecord[]; strategicHorizon?: StrategicHorizonView }): Promise<DegradedResponse> {
  const failureReason = input.failureReason ?? inferFailureReason(input.reason); if (requiresDecisionGradeAbstention({ objective: input.objective, failureReason, domain: input.domain })) return buildRiskAbstention(input.objective, input.reason, failureReason); if (input.intent === 'conversation' || input.intent === 'opinion') { const incident = emitConversationIncident({ objective: input.objective, intent: input.intent, failureReason }); emitIncidentRegressionCandidate({ incident, message: input.objective }) }
  const suppliedContext = input.contextualEvidence?.trim(); const recall = input.recall ?? recallPersistentMemory; const query = [input.missionId, input.objective].filter(Boolean).join(' '); const memories = suppliedContext ? [] : filterConversationalMemories(await recall(query, 5)); const recoveredContext = suppliedContext || formatMemoryEvidence(memories); const sourceKeys = memories.map((entry) => entry.key); const recoveredCapability = capabilityForFailure(failureReason)
  const conversationState = input.conversationState ?? (input.priorConversation?.length ? deriveCeoConversationState(input.priorConversation, input.objective) : undefined)
  if (input.intent === 'self_assessment') return { evidenceState: 'PARTIAL_UNCONFIRMED', reason: input.reason, sourceKeys, failureReason, recoveredCapability, content: buildSelfAssessmentArchitectureFallback(input.objective, recoveredContext, input.selfReflectionKind, { partnerIntelligence: input.partnerIntelligence, executiveState: input.executiveState, leadershipLedger: input.leadershipLedger, strategicHorizon: input.strategicHorizon }) }
  if (input.missionId && recoveredContext.trim()) return { evidenceState: 'MEMORY_ONLY', reason: input.reason, sourceKeys, failureReason, recoveredCapability: 'mission', content: `I couldn't complete the normal mission reasoning path, but I recovered relevant internal mission evidence already established for ${input.missionId}. I won't present it as fresh external verification.\n\n${recoveredContext.slice(0, 12000)}` }
  const natural = buildNaturalRecoveryResponse({ objective: input.objective, action: input.responseAction, priorConversation: safeConversationRows(input.priorConversation ?? []), recoveredContext, isSuppliedByCaller: Boolean(suppliedContext), intent: input.intent, conversationState, resolvedReferences: input.resolvedReferences })
  if (natural) { const safeContent = natural.includes('continuous_loop_trace') ? `I couldn't complete that specific request reliably, so I won't expose internal execution records.` : natural; const missionRecovery = (input.intent === 'mission_action' || Boolean(input.missionId)) && sourceKeys.length > 0; return { evidenceState: missionRecovery ? 'MEMORY_ONLY' : (suppliedContext ? 'PARTIAL_UNCONFIRMED' : (sourceKeys.length > 0 ? 'MEMORY_ONLY' : 'PARTIAL_UNCONFIRMED')), reason: input.reason, sourceKeys: missionRecovery || sourceKeys.length > 0 ? sourceKeys : [], failureReason, recoveredCapability, content: safeContent } }
  if (isContinuityRecoveryRequest(input.objective) && recoveredContext.trim()) return { evidenceState: suppliedContext ? 'PARTIAL_UNCONFIRMED' : 'MEMORY_ONLY', reason: input.reason, sourceKeys, failureReason, recoveredCapability, content: `I couldn't complete the normal reasoning path, but I can use the conversation context to preserve continuity without claiming fresh verification.\n\n${recoveredContext.slice(0, 12000)}` }
  if (recoveredCapability === 'conversation' || recoveredCapability === 'context') return { evidenceState: 'PARTIAL_UNCONFIRMED', reason: input.reason, sourceKeys, failureReason, recoveredCapability, content: `I couldn't give you a reliable answer to that specific request from the available execution path, and I don't want to substitute an unrelated answer.` }
  return { evidenceState: 'UNAVAILABLE', reason: input.reason, sourceKeys, failureReason, recoveredCapability, content: `I wasn't able to verify the part of this answer that depends on the failed execution path, and I won't pretend that I did. I can still separate what is known from what remains unverified.` }
}
