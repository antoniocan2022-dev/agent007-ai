import { buildCeoOperatorPlan, canClaimExecution } from './ceo-operator-intelligence'
import { assessCeoCuriosity } from './ceo-curiosity'
import { assessGuardianRisk, renderGuardianConstraint } from './ceo-guardian'
import { buildSemanticQualityReport, buildSemanticRepairPlan, renderSemanticRepairPrompt } from './ceo-semantic-quality-report'
import { runCanonicalLlm, type CanonicalLlmResult } from './canonical-llm-router'
import { buildCeoDecisionPlan } from './ceo-cognitive-kernel'
import { preRouteCeoRequest, resolvePreRoute } from './ceo-pre-router'
import { buildExternalEvidencePlan } from './ceo-evidence-planner'
import { buildCeoExecutionPlan } from './ceo-execution-plan'
import { evaluateCeoQuality } from './ceo-response-quality-gate'
import { buildCeoDegradedResponse, renderSelfAssessmentSubsystems, type DegradedSelfAssessmentSubsystems } from './ceo-degraded-mode'
import { composeCeoResponse, sanitizeCeoContentForQualityGate } from './ceo-response-composer'
import { getCeoVentureEvidenceForObjective } from './ceo-venture-state'
import { synthesizeExecutiveReadiness } from './ceo-self-reflection'
import { getConfiguredProviders, getGovernedCandidates, PROVIDER_ORDER } from './provider-control-plane'
import { isCircuitOpen, pickHalfOpenCandidate } from './provider-intelligence'
import { probeProvider } from './provider-runtime-v2'
import type { ActiveProviderId } from './provider-control-plane'
import type { TaskType, VerificationTier } from './subagent-governance'
import type { CognitiveLifecycleResult, DecisionPlan, EvidenceScope, EvidenceFreshness, EvidenceState, PreRouteDecision, CeoGenerationDiagnostics, CeoIntent } from './ceo-cognitive-contract'
import { inferComprehensionMode, extractInstructionWindow } from './ceo-cognitive-contract'
import type { ConversationDecisionContract } from './ceo-conversation-decision-contract'
import { isDocumentOperation, renderConversationDecisionContract } from './ceo-conversation-decision-contract'
import type { CanonicalConversationContext } from './ceo-cognitive-conversation'
import type { EvidenceBundle } from './ceo-evidence-bundle'
import { buildCeoWorldModel } from './ceo-world-model'
import { renderPartnerIntelligenceContext, type PartnerIntelligenceSummary } from './ceo-partner-intelligence'
import { renderExecutiveBusinessStateContext, type ExecutiveBusinessState } from './ceo-executive-state'
import { synthesizeExecutiveDecision, renderExecutiveDecisionSynthesis } from './ceo-decision-synthesis'
import { renderLeadershipPerformanceContext, type LeaderPerformanceRecord } from './ceo-leadership-performance'
import { renderStrategicHorizonContext, type StrategicHorizonView } from './ceo-strategic-horizon'
import type { CeoFailureReason } from './ceo-failure-reason'
import type { PersistedConversationRow } from './ceo-context-composer'
import { getCeoCancellationSignal } from './ceo-cancellation-context'
import { isCeoRequestAborted, throwIfCeoRequestAborted } from './ceo-cancellation'
import { isGovernedSoftPassEligible } from './ceo-soft-pass-policy'
import { safeConversationRows } from './ceo-conversation-state'
import { isContinuationOrRestatementRequest } from './ceo-conversational-signals'
import { buildDocumentComprehensionTrace, buildHierarchicalComprehensionPlan } from './ceo-document-comprehension'
import { shouldExecuteHierarchicalComprehension, executeHierarchicalComprehension } from './ceo-document-comprehension-executor'
import type { StructuralSourceModel } from './ceo-structural-quality-gate'

export interface CeoCognitiveRequest {
  messages: readonly { role: 'system' | 'user' | 'assistant'; content: string }[]
  attachmentsCount?: number
  missionId?: string
  contextualEvidence?: string
  evidenceScope?: EvidenceScope
  evidenceFreshness?: EvidenceFreshness
  evidenceBundle?: EvidenceBundle
  productionTrafficVerified?: boolean
  taskType?: TaskType
  verification?: VerificationTier
  model?: string
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
  priorConversation?: readonly PersistedConversationRow[]
  relevantOlderConversation?: readonly PersistedConversationRow[]
  preRoute?: PreRouteDecision
  decisionContract?: ConversationDecisionContract
  // Phase 2 fix (external audit, 2026-09-19), issues 1 and 8: optional so this function keeps building
  // its own decisionPlan for any caller/test that doesn't supply one, but route.ts now builds
  // CeoTurnDecision exactly once per turn (ceo-turn-decision.ts) and threads its decisionPlan through
  // here -- see tryOperationalDirectResponse's identical addition for the mirror-image half of the same
  // single-build guarantee on the operational_orchestrator branch's direct-response path.
  decisionPlan?: DecisionPlan
  // Phase 2 fix (external audit, 2026-09-19), issue 6: every evaluateCeoQuality call inside this
  // function used to hardcode externalExecutionSucceeded: true unconditionally -- correct for the
  // ceo_lifecycle branch (which never executes anything itself), but silently wrong for the
  // operational_orchestrator branch's full-synthesis fallback (route.ts's `else` branch when
  // tryOperationalDirectResponse returns null), which calls this function AFTER runOrchestrator() has
  // already run real tool calls that may have failed. Defaults to true so every existing caller that
  // never had a real execution outcome to report is unaffected; route.ts's fallback branch is the one
  // caller that now passes the real, computed value.
  externalExecutionSucceeded?: boolean
  canonicalContext?: CanonicalConversationContext
  partnerIntelligence?: PartnerIntelligenceSummary
  executiveState?: ExecutiveBusinessState
  leadershipLedger?: readonly LeaderPerformanceRecord[]
  strategicHorizon?: StrategicHorizonView
  documentComprehensionSynthesis?: string
  documentComprehensionCoverage?: string
}

type ValidatedCandidate = { provider: ActiveProviderId; model: string; responseMs: number }
// Production incident (2026-09-17): attemptValidatedReasoningProvider used to probe up to 2 candidates
// but return only the FIRST one that passed its cheap 128-token probe, discarding the second even when
// it was also validated. tryDegraded then locked its one real recovery generation call to that single
// provider (excludeProviders excludes every other configured provider) with maxProviderAttempts:1 --
// so when the probe-validated provider's probe succeeded but its real, full-size generation call then
// failed for a reason the tiny probe never exercised (live trace: Groq's request/billing-size limit,
// classified BILLING:413, hit only once the recovery call carried the real conversation + maxTokens:4000),
// recovery had nowhere left to go and fell straight to the canned degraded template -- even though a
// second, genuinely healthy provider (OpenRouter, confirmed serving the fast path on the same deployment
// in the same window) was sitting right there, already probed and validated, and simply thrown away.
// Now a list of ALL validated candidates (still bounded to the same attemptBudget of 2), so tryDegraded
// can fall through to the next one instead of giving up after the first candidate's real call fails.
type ValidatedAvailability = readonly ValidatedCandidate[]

// Deep-audit fix (2026-09-13): 'verify' carries evidenceRequirement 'required' -- the strongest tier
// in ceo-conversation-decision-contract.ts's own scale, the same tier that motivates operatorConstraint
// (built just below runCeoCognitiveLifecycle's tryPrimary for 'execute') -- but had no equivalent
// anti-overclaim guardrail: nothing stopped the model from affirming a verification claim on LLM
// knowledge alone when no real evidence/execution scope was ever supplied. Symmetric with
// operatorConstraint's own gating (evidenceProvided or a real evidenceScope). Extracted as its own pure
// function so it's directly unit-testable without mocking the full provider/quality-gate chain.
export function buildVerifyOverclaimConstraint(responseAction: string | undefined, evidenceProvided: boolean, evidenceScope: EvidenceScope | undefined): string {
  if (responseAction !== 'verify') return ''
  const verifyEvidenceAvailable = evidenceProvided || (evidenceScope !== undefined && evidenceScope !== 'none')
  if (verifyEvidenceAvailable) return ''
  return ' No governed evidence, execution result, or live-system scope is available to verify this claim. Do not say or imply that something has been verified, confirmed, or checked -- state clearly that it is unverified or unknown, and describe what evidence would be needed to verify it.'
}
function objectiveFrom(messages: CeoCognitiveRequest['messages']): string {
  return [...messages].reverse().find((message) => message.role === 'user')?.content?.trim() ?? ''
}
function mergeAttempts(...results: Array<CanonicalLlmResult | undefined>): string[] { return [...new Set(results.flatMap((result) => result?.attempts ?? []))] }
function buildRefinementPrompt(objective: string, draft: string): { role: 'user'; content: string } { return { role: 'user', content: `Produce a revised final answer for the original objective. Preserve correct information from the draft, repair omissions and unsupported claims, improve precision and completeness, and do not invent facts. Return the revised answer only.\n\nORIGINAL OBJECTIVE:\n${objective}\n\nDRAFT:\n${draft.slice(0, 30000)}` } }
function buildReviewPrompt(objective: string, draft: string): { role: 'user'; content: string } { return { role: 'user', content: `Review the draft answer below against the original objective. Identify material omissions, unsupported claims, contradictions, and incorrect assumptions. Do not write a new answer; return a concise review that a synthesis step can act on.\n\nORIGINAL OBJECTIVE:\n${objective}\n\nDRAFT:\n${draft.slice(0, 30000)}` } }
function buildSynthesisPrompt(objective: string, draft: string, review: string, ventureEvidence?: string, readinessEvidence?: string): { role: 'user'; content: string } { return { role: 'user', content: `Produce the final executive answer. Preserve correct information from the draft, fix every material issue identified by the review, and do not invent facts. The answer must directly satisfy the original objective and clearly distinguish verified facts from assumptions when relevant.${ventureEvidence ? `\n\nLIVE VENTURE EVIDENCE:\n${ventureEvidence}` : ''}${readinessEvidence ? `\n\nGOVERNED EXECUTIVE READINESS SYNTHESIS (INTERNAL EVIDENCE; DO NOT UPGRADE UNPROVEN LEVELS):\n${readinessEvidence}` : ''}\n\nORIGINAL OBJECTIVE:\n${objective}\n\nDRAFT:\n${draft.slice(0, 30000)}\n\nINDEPENDENT REVIEW:\n${review.slice(0, 20000)}` } }
function stageExclusions(previous?: ActiveProviderId): ActiveProviderId[] { const operational = getConfiguredProviders().filter((provider) => !isCircuitOpen(provider)); return previous && operational.length >= 3 ? [previous] : [] }
// Production incident 2026-09-12 (part 1): self-assessment answers are deliberately given evidenceScope
// 'internal_state' only (never 'live_system'/'mixed' with a freshness timestamp -- see the "mixed
// internal and live claims require mixed fresh evidence" guard in ceo-response-quality-gate.ts, which
// intentionally stays strict). An unhedged sentence like "Agent007 is currently deployed and serving
// production traffic" reads as a claim that would need genuine live verification, so it correctly fails
// the quality gate -- but nothing told the model to avoid that phrasing, so a natural self-assessment
// kept tripping it on both the primary attempt and the degraded-mode recovery attempt.
//
// Production incident 2026-09-12 (part 2): even after that fix, a genuine follow-up ("but tell me that in
// your own words") got back text that opened with the same fixed paragraph as the answer it was asking to
// be rephrased -- because nothing told the model this was a restatement request, so it had no reason to
// compress or rephrase rather than restate its prior structure. A template can't fix this: the model
// needs to actually know it's being asked to say the same true thing differently, and to have the prior
// answer in front of it so it can paraphrase rather than reconstruct from scratch. Shared by both the
// primary and degraded-mode recovery call sites so this guidance can't drift out of sync between them the
// way two independently-maintained copies would.
function selfAssessmentGuidanceMessages(input: { intent: CeoIntent; objective: string; priorConversation?: readonly PersistedConversationRow[] }): Array<{ role: 'system'; content: string }> {
  if (input.intent !== 'self_assessment') return []
  const phrasing = `SELF-ASSESSMENT PHRASING GUIDANCE (INTERNAL):\nYou have real internal system data available (architecture, deployment, partners, leadership, strategy). State those facts directly and plainly.\nDo NOT phrase live/production/operational performance claims as confirmed or verified (e.g. "is verified and serving production traffic", "is confirmed live") unless this turn's evidence is explicitly tagged as live-verified -- that overclaims what internal system data alone supports. Instead hedge those specific claims: describe what is architecturally/operationally in place, and separately state that live execution, production traffic handling, and sustained outcomes remain unproven unless verified this turn.\nSpeak the way a thoughtful human executive would talk to someone they work with -- plain, direct, conversational sentences, not a formatted report. Lead with the plain-English judgment (what you can and can't yet claim), and use the underlying facts to support it rather than opening with them.`
  const priorAssistant = safeConversationRows(input.priorConversation ?? []).filter((row) => row.role === 'assistant').at(-1)?.content?.trim()
  const isContinuation = isContinuationOrRestatementRequest(input.objective)
  const continuation = isContinuation ? `\n\nThis turn is a follow-up asking you to restate, explain, or rephrase your own prior answer${priorAssistant ? ' (quoted below)' : ''} -- not to produce a fresh full report. Say the same true thing in different, shorter, more natural words. Do not reopen with the same opening sentence or reproduce the same structure or subsystem-by-subsystem listing again.${priorAssistant ? `\n\nYour prior answer was:\n${priorAssistant.slice(0, 3000)}` : ''}` : ''
  return [{ role: 'system', content: `${phrasing}${continuation}` }]
}
function responseActionInstruction(action?: ConversationDecisionContract['responseAction']): string | null { if (!action) return null; const instructions: Record<ConversationDecisionContract['responseAction'], string> = { answer: 'Response action: answer the user directly and naturally.', clarify: 'Response action: ask one concise, natural clarification question only when necessary to safely resolve the missing meaning. Do not repeat questions already answered by context.', explain: 'Response action: explain the requested concept or reasoning clearly, using the relevant context and avoiding unnecessary procedural structure.', challenge: 'Response action: respectfully challenge the user’s assumption or proposed conclusion when warranted, explain why, and offer the stronger alternative.', recommend: 'Response action: make a clear recommendation, choose a preferred option when the evidence supports one, and explain the decision criteria.', decide: 'Response action: give a decisive executive judgment, distinguish facts from assumptions, and state the chosen direction clearly.', execute: 'Response action: report the governed execution result accurately. Never claim an action occurred unless the execution path actually completed it and any externally consequential action has independent verification evidence.', verify: 'Response action: verify the requested claim or state using the governed evidence/execution path, and clearly distinguish verified, unverified, and unknown.' }; return instructions[action] }
// Deep-audit finding: this last-resort recovery check used to take the first 2 configured providers in
// raw config order, never once consulting circuit-breaker state before choosing -- so if those first 2
// both happened to be circuit-open (fully plausible with a small provider pool during a burst of real
// transient failures), it exhausted its entire attempt budget on providers already known to be down,
// while a genuinely closed-circuit provider further down the list went untried. Rebuilt to prefer
// circuit-closed providers first; only when every configured provider is circuit-open does it fall back
// to the one bounded half-open probe (see pickHalfOpenCandidate), rather than refusing outright.
//
// Live-production finding, caught via runtime-log trace on a real "affiliate content vs. SaaS" request
// (taskType 'creative', since inferTaskType matches the word "content"): primary generation correctly
// narrowed to [mistral, openrouter] -- the only two providers governed for 'creative' -- per #115's fix.
// Both happened to fail for real reasons that request (mistral:RATE_LIMIT:429, openrouter:UNKNOWN), so
// recovery correctly kicked in. But this function validated availability using a HARDCODED taskType
// 'reasoning' -- universally governed, so it always succeeds -- and returned whichever provider passed
// that probe (groq) with no regard for whether groq is governed for the REQUEST's actual taskType.
// tryDegraded's recovery branch then generated with taskType 'creative' but excludeProviders locked to
// every provider except the validated one (groq) -- and groq has zero governed models for 'creative', so
// the recovery attempt was GUARANTEED to fail with "No governed providers configured and healthy after
// exclusions", not a flake. This is the same taskType-governance-must-be-known-before-selection bug
// #115/#116 already fixed in runGovernedProviderChat and the half-open path, present a third time here.
// Fixed by validating against the real taskType/verification the recovery call will actually use, and
// filtering candidates by that governance before spending the bounded probe budget -- so this function
// can never return a provider recovery is structurally unable to use.
async function attemptValidatedReasoningProvider(timeoutMs: number, taskType: TaskType = 'reasoning', verification: VerificationTier = 'standard'): Promise<ValidatedAvailability> {
  const configured = getConfiguredProviders()
  if (!configured.length) return []
  const governedConfigured = configured.filter((provider) => getGovernedCandidates(provider, taskType, verification).length > 0)
  if (!governedConfigured.length) return []
  const closed = governedConfigured.filter((provider) => !isCircuitOpen(provider))
  const halfOpen = closed.length ? null : pickHalfOpenCandidate(governedConfigured)
  const ordered = closed.length ? closed : (halfOpen ? [halfOpen] : [])
  const attemptBudget = Math.min(ordered.length, 2)
  const validated: ValidatedCandidate[] = []
  for (const provider of ordered.slice(0, attemptBudget)) {
    try {
      const probe = await probeProvider(provider, { taskType, verification, timeoutMs: Math.max(2500, Math.min(10000, timeoutMs)), maxTokens: 128, allowHalfOpenProbe: true })
      if (probe.success && probe.model && probe.responseMs !== null) validated.push({ provider, model: probe.model, responseMs: probe.responseMs })
    } catch (error) { if (isCeoRequestAborted(error)) throw error }
  }
  return validated
}
function logCeoDegradedTrace(context: { objective: string; intent: string; path: string; failureReason?: CeoFailureReason; attempts: string[]; rawContentLength?: number; qualityChecks?: Record<string, boolean>; priorTurnCount?: number }): void { console.log('[ceo-degraded-trace]', JSON.stringify({ objectiveLength: context.objective.length, intent: context.intent, path: context.path, failureReason: context.failureReason, attempts: context.attempts, rawContentLength: context.rawContentLength ?? 0, qualityChecks: context.qualityChecks, priorTurnCount: context.priorTurnCount ?? 0 })) }
// Exported alongside runCeoCognitiveLifecycle so tests can exercise the judge directly -- the same
// established pattern as resetProviderHealthForTests in provider-intelligence.ts -- rather than only
// reachable through a fully engineered end-to-end quality-gate scenario.
export async function semanticSubstanceCheck(objective: string, content: string): Promise<{ substantive: boolean; checked: boolean }> { try { const judge = await runCanonicalLlm({ messages: [{ role: 'system', content: 'You judge whether a conversational answer is substantive (specific, engages genuinely with the question, gives real reasoning or detail) or shallow (generic, hand-wavy, could apply to almost any question). Respond with exactly one word: SUBSTANTIVE or SHALLOW. No other text.' }, { role: 'user', content: `Question: ${objective.slice(0, 500)}\n\nAnswer: ${content.slice(0, 1500)}` }], taskType: 'reasoning', executionClass: 'fast', temperature: 0, maxTokens: 10, timeoutMs: 6000, maxProviderAttempts: 1 }); const verdict = judge.content.trim().toUpperCase(); if (verdict.includes('SHALLOW')) return { substantive: false, checked: true }; if (verdict.includes('SUBSTANTIVE')) return { substantive: true, checked: true }; return { substantive: true, checked: false } } catch (error) { if (isCeoRequestAborted(error)) throw error; return { substantive: true, checked: false } } }
// The lexical continuity heuristics (staleResponseLikelihood/scoreContextContinuity in
// ceo-response-quality-gate.ts) are bag-of-words token-overlap scores -- proven, via a real production
// incident, to false-positive on a response that is actually coherent (fixed at the lexical layer
// separately, but the heuristic class remains structurally limited). This is a genuine semantic
// tie-breaker, not another lexical proxy, used only to decide whether a continuity_failure rejection can
// be soft-passed -- see OVERRIDABLE_FORBIDDEN_FAILURE in ceo-soft-pass-policy.ts. Deliberately fails
// CLOSED (coherent: false) on any error, timeout, or inconclusive verdict: unlike semanticSubstanceCheck
// (an additional gate layered on top of an already-likely-good candidate), this check is the ONLY thing
// standing between a forbidden failure reason and soft-pass, so a network hiccup must never silently grant
// the override -- it must be positively confirmed, not merely not-denied.
export async function semanticContinuityCheck(objective: string, priorTurns: readonly PersistedConversationRow[], content: string, olderTurns: readonly PersistedConversationRow[] = []): Promise<{ coherent: boolean; checked: boolean }> {
  try {
    const recentTurns = [...priorTurns].slice(-6).map((row) => `${row.role}: ${row.content}`).join('\n')
    // Deep-audit finding: this judge previously saw only request.priorConversation, while
    // evaluateCeoQuality (the gate that produced the continuity_failure this judge exists to rescue) also
    // considers relevantOlderMessages -- retrieved older history the lexical heuristic can legitimately
    // rely on. Without it, the one judge meant to rescue a genuinely coherent response was denied exactly
    // the context most likely to prove coherence, making the override weaker than the failure it overrides.
    const olderSummary = [...olderTurns].slice(-6).map((row) => `${row.role}: ${row.content}`).join('\n')
    const judge = await runCanonicalLlm({
      messages: [
        { role: 'system', content: 'You judge whether a candidate response genuinely stays coherent with the conversation so far -- addressing what the user actually meant, grounded in what was actually said, not ignoring or contradicting it. A response that restates or paraphrases an earlier assistant answer because the user explicitly asked for that is coherent, not stale. Older relevant conversation history may also legitimately ground the response even if it is not in the most recent turns. Respond with exactly one word: COHERENT or INCOHERENT. No other text.' },
        { role: 'user', content: `${olderSummary ? `Relevant older conversation:\n${olderSummary.slice(0, 2000)}\n\n` : ''}Recent conversation:\n${recentTurns.slice(0, 3000)}\n\nLatest user message: ${objective.slice(0, 500)}\n\nCandidate response: ${content.slice(0, 1500)}` },
      ],
      taskType: 'reasoning', executionClass: 'fast', temperature: 0, maxTokens: 10, timeoutMs: 6000, maxProviderAttempts: 1,
    })
    const verdict = judge.content.trim().toUpperCase()
    if (verdict.includes('INCOHERENT')) return { coherent: false, checked: true }
    if (verdict.includes('COHERENT')) return { coherent: true, checked: true }
    return { coherent: false, checked: false }
  } catch (error) {
    if (isCeoRequestAborted(error)) throw error
    return { coherent: false, checked: false }
  }
}
// Deep-audit finding, root-caused directly against a real failing production trace: two of this
// function's five call sites hardcoded availabilityAttempted:true without ever actually calling
// attemptValidatedReasoningProvider first -- a false claim that skipped the one real, provider-level
// last-resort recovery chance and went straight to the canned degraded template, even when a genuinely
// available provider (now more likely to be found at all thanks to attemptValidatedReasoningProvider's
// own circuit-breaker rebuild) could have produced a real answer. Contract for every caller: pass
// validatedAvailability (and availabilityAttempted:true) ONLY when you already called
// attemptValidatedReasoningProvider yourself and are handing the result forward; otherwise leave
// availabilityAttempted false (the default) so this function makes that attempt honestly.
//
// Sibling-call-site audit, same day: this function's own recovery branch diffed against the primary/
// escalation/semantic-repair evaluateCeoQuality calls in runCeoCognitiveLifecycle below turned up two
// more drifts, both now fixed. (1) recoveryQuality's evaluateCeoQuality call was missing
// resolvedReferences and responseAction, which every sibling call passes -- meaning the one response
// this function is the LAST chance to save could be unfairly marked a continuity or requested-action
// failure that a fully-informed evaluation would have recognized as satisfied, precisely undermining
// the value of a recovery path. (2) the recovery runCanonicalLlm call used verification:'standard'
// unconditionally instead of respecting decisionPlan.qualityTier the way selectedVerification does for
// every other stage, so a critical-tier request's last-resort recovery ran at a lower quality bar than
// every stage that came before it. Both now derive the same values their siblings already use.
//
// Second-pass audit (re-auditing the above fix itself): evidenceProvided and evidenceScope were still
// computed from request-level evidence only, never from ventureEvidence -- the live Venture-state lookup
// runCeoCognitiveLifecycle performs once up front and which every sibling evaluateCeoQuality call DOES
// see (directly, via the evidenceScope/evidenceProvided it computes at its own top). Because tryDegraded
// is a standalone function with no closure over that lookup, this recovery branch could mark a critical-
// tier response as having no live evidence -- and fail it on that basis alone -- even when real venture
// evidence was sitting in scope in the caller the entire time, one parameter away from being handed down.
// Worse, the recovery generation call never received that evidence either, so even a "PASS" here could
// have been ungrounded. Both are fixed by threading ventureEvidence/ventureEvidenceFreshness through as
// two more parameters, mirroring runCeoCognitiveLifecycle's own liveSystemMessages/evidenceScope/
// evidenceProvided derivation exactly: the recovery prompt now gets the same live venture context every
// other stage gets, and the fields fed to evaluateCeoQuality reflect what the recovery model actually saw.
// Single source of truth for the taskType/verification the recovery path validates availability
// against AND actually generates with -- they must always be the same pair. Computing this once and
// sharing it everywhere (instead of re-deriving it at each call site, as the live-production bug above
// was caused by) is what prevents a fourth instance of this exact drift from appearing later.
function recoveryTaskContext(request: CeoCognitiveRequest, decisionPlan: ReturnType<typeof buildCeoDecisionPlan>): { taskType: TaskType; verification: VerificationTier } {
  return {
    taskType: decisionPlan.executionContract.intent === 'self_assessment' ? 'reasoning' : (request.taskType ?? (decisionPlan.taskClass ?? 'reasoning')),
    verification: request.verification ?? (decisionPlan.qualityTier === 'critical' ? 'strict' : decisionPlan.qualityTier === 'high' ? 'enhanced' : 'standard'),
  }
}

/** Evidence failures are repaired with fresh evidence before any provider-only prose recovery is attempted. */
export function shouldRecoverEvidenceBeforeProvider(
  failureReason: CeoFailureReason | undefined,
  contract: DecisionPlan['executionContract'],
): boolean {
  return (
    (failureReason === 'evidence_insufficient' || failureReason === 'evidence_unavailable') &&
    contract.evidenceClass === 'external_web' &&
    contract.domain !== 'none' &&
    contract.domain !== 'unknown' &&
    contract.toolRequired
  )
}
async function tryDegraded(request: CeoCognitiveRequest, reason: string, attempts: string[], responseMsBeforeDegraded: number, decisionPlan: ReturnType<typeof buildCeoDecisionPlan>, executionPlan: ReturnType<typeof buildCeoExecutionPlan>, availabilityAttempted = false, validatedAvailability: ValidatedAvailability = [], failureReason?: CeoFailureReason, generationOverride?: Partial<CeoGenerationDiagnostics>, ventureEvidence: { ventureId: string; evidence: string } | null = null, ventureEvidenceFreshness?: EvidenceFreshness): Promise<CognitiveLifecycleResult> {
  throwIfCeoRequestAborted(getCeoCancellationSignal())
  const started = Date.now()
  const originalObjective = objectiveFrom(request.messages)
  const recoveryObjective = request.documentComprehensionSynthesis ? (request.canonicalContext?.turnEnvelope?.instruction.authoritativeText ?? request.canonicalContext?.instruction ?? extractInstructionWindow(originalObjective)) : originalObjective
  const recoverySourceMessages: readonly { role: 'system' | 'user' | 'assistant'; content: string }[] = request.documentComprehensionSynthesis ? [{ role: 'user', content: recoveryObjective }] : request.messages
  const { taskType: recoveryTaskType, verification: recoveryVerification } = recoveryTaskContext(request, decisionPlan)
  let recoveredEvidenceBundle = request.evidenceBundle
  let recoveredEvidenceContext: string | undefined
  let recoveredEvidenceScope = request.evidenceScope
  let recoveredEvidenceFreshness = request.evidenceFreshness
  let evidenceRecoveryAttempted = false
  if (shouldRecoverEvidenceBeforeProvider(failureReason, decisionPlan.executionContract)) {
    evidenceRecoveryAttempted = true
    try {
      const evidencePlan = buildExternalEvidencePlan({
        objective: recoveryObjective,
        evidenceClass: decisionPlan.executionContract.evidenceClass,
        domain: decisionPlan.executionContract.domain,
        operation: decisionPlan.executionContract.operation,
        temporalScope: decisionPlan.executionContract.temporalScope,
        evidenceProfile: decisionPlan.executionContract.evidenceProfile,
      })
      // Keep the heavy tool/auth graph out of ordinary CEO module initialization. Evidence recovery
      // is a rare degraded-path capability, so load it only after the evidence-failure condition is met.
      const [{ recoverExternalEvidencePlan }, { buildEvidenceBundle, renderEvidenceBundleForPrompt }] = await Promise.all([
        import('./ceo-evidence-executor'),
        import('./ceo-evidence-bundle'),
      ])
      const recovered = await recoverExternalEvidencePlan(evidencePlan, getCeoCancellationSignal())
      if (recovered.bundle.sources.length > 0) {
        const existingSources = request.evidenceBundle?.sources ?? []
        const mergedBundle = buildEvidenceBundle({
          profile: recovered.bundle.profile,
          operation: decisionPlan.executionContract.operation,
          scope: request.evidenceBundle?.scope === 'mixed' || recovered.bundle.scope === 'mixed' ? 'mixed' : 'external_web',
          sources: [...existingSources, ...recovered.bundle.sources],
        })
        recoveredEvidenceBundle = mergedBundle
        recoveredEvidenceContext = renderEvidenceBundleForPrompt(mergedBundle)
        recoveredEvidenceScope = mergedBundle.scope
        recoveredEvidenceFreshness = mergedBundle.freshness
      }
      console.log('[ceo-evidence-recovery]', JSON.stringify({ attempted: true, profile: recovered.bundle.profile, sources: recovered.bundle.sources.length, sufficient: recovered.bundle.sufficient, selected: Boolean(recoveredEvidenceContext), failures: recovered.failures.slice(0, 5) }))
    } catch (error) {
      if (isCeoRequestAborted(error)) throw error
      console.log('[ceo-evidence-recovery]', JSON.stringify({ attempted: true, failed: true, error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300) }))
    }
  }
  const availabilityCandidates = (validatedAvailability.length || availabilityAttempted)
    ? validatedAvailability
    : await attemptValidatedReasoningProvider(Math.max(2500, (request.timeoutMs ?? decisionPlan.latencyBudgetMs) - responseMsBeforeDegraded), recoveryTaskType, recoveryVerification)
  console.log('[ceo-recovery-trace]', JSON.stringify({ availabilityAttemptedByCaller: availabilityAttempted, recoveryAvailable: availabilityCandidates.length > 0, recoveryProviders: availabilityCandidates.map((candidate) => candidate.provider), evidenceRecoveryAttempted, evidenceRecoverySelected: Boolean(recoveredEvidenceContext), reason: reason.slice(0, 200) }))
  const evidenceScope = recoveredEvidenceScope ?? (ventureEvidence ? 'live_system' : decisionPlan.executionContract.intent === 'self_assessment' ? 'internal_state' : undefined)
  const evidenceFreshness = recoveredEvidenceFreshness ?? ventureEvidenceFreshness
  const recoveryLiveSystemMessages = ventureEvidence ? [{ role: 'system' as const, content: `LIVE VENTURE STATE (READ ONLY):\n${ventureEvidence.evidence}\nUse these values as system evidence. Do not invent missing values, readiness, revenue, customer success, or authorization.` }] : [];
  // Production incident 2026-09-12 (part 3): unlike the primary generation call, this recovery call's
  // `request.messages` never carried the worldModel/executive-state context blocks that
  // runCeoCognitiveLifecycle builds only for its own primaryMessages -- so a self-assessment recovery
  // attempt had no real subsystem facts to answer from at all, just the raw conversation. Rebuild the
  // same facts block from the subsystem data already threaded onto `request` (route.ts fetches it) so
  // this second real generation attempt is grounded exactly like the first one was.
  const recoverySelfAssessmentFactsMessages = decisionPlan.executionContract.intent === 'self_assessment' ? (() => { const facts = renderSelfAssessmentSubsystems({ partnerIntelligence: request.partnerIntelligence, executiveState: request.executiveState, leadershipLedger: request.leadershipLedger, strategicHorizon: request.strategicHorizon } satisfies DegradedSelfAssessmentSubsystems); return facts.trim() ? [{ role: 'system' as const, content: `REAL INTERNAL SYSTEM STATE (INTERNAL, ground your answer in this):\n${facts.slice(0, 9000)}` }] : [] })() : []
  const recoveryEvidenceMessages = recoveredEvidenceContext ? [{ role: 'system' as const, content: `RECOVERED EXTERNAL EVIDENCE (INTERNAL GROUNDING):\n${recoveredEvidenceContext}\nUse these freshly acquired sources to answer the user's objective. Do not invent claims beyond the evidence.` }] : []
  // Recommendation 1 (2026-09-20): reads the decision contract's own comprehensionMode (computed once
  // in buildConversationDecisionContract, alongside responseAction) when one is available, instead of
  // recomputing it here -- falls back to a local computation for the rare caller that supplies a
  // decisionContract without one (or none at all), matching this file's existing reuse-guard discipline.
  const recoveryComprehensionMode = request.decisionContract?.comprehensionMode ?? inferComprehensionMode({ responseAction: request.decisionContract?.responseAction, sourceLength: recoveryObjective.length })
  for (const availability of availabilityCandidates) { try { const recovery = await runCanonicalLlm({ messages: [...recoveryLiveSystemMessages, ...recoveryEvidenceMessages, ...recoverySelfAssessmentFactsMessages, ...selfAssessmentGuidanceMessages({ intent: decisionPlan.executionContract.intent, objective: recoveryObjective, priorConversation: request.priorConversation }), ...recoverySourceMessages], taskType: recoveryTaskType, verification: recoveryVerification, model: availability.model, temperature: request.temperature ?? 0.2, maxTokens: request.maxTokens ?? 4000, timeoutMs: Math.max(1000, Math.min(30000, (request.timeoutMs ?? decisionPlan.latencyBudgetMs) - (Date.now() - started))), maxProviderAttempts: 1, excludeProviders: PROVIDER_ORDER.filter((provider) => provider !== availability!.provider) }); const recoveryQuality = evaluateCeoQuality({ objective: recoveryObjective, content: sanitizeCeoContentForQualityGate(recovery.content), path: decisionPlan.path, intent: decisionPlan.executionContract.intent, reviewed: false, externalExecutionSucceeded: request.externalExecutionSucceeded ?? true, evidenceProvided: Boolean(request.contextualEvidence?.trim() || recoveredEvidenceContext?.trim() || ventureEvidence?.evidence), evidenceScope, evidenceFreshness, evidenceBundle: recoveredEvidenceBundle, priorTurns: request.priorConversation, relevantOlderMessages: request.relevantOlderConversation, resolvedReferences: request.canonicalContext?.references, responseAction: request.decisionContract?.responseAction, externalAgencyAvailable: decisionPlan.executionContract.orchestrationOwner === 'operational_orchestrator', comprehensionMode: recoveryComprehensionMode }); const mergedAttempts = [...new Set([...attempts, availability.provider, ...recovery.attempts])]; if (!(recovery.content.trim() && recoveryQuality.decision === 'PASS')) console.log('[ceo-recovery-trace]', JSON.stringify({ recoveryAttempted: true, recoveryProvider: availability.provider, recoveryContentProduced: Boolean(recovery.content.trim()), recoveryQualityDecision: recoveryQuality.decision, recoveryFailureReason: recoveryQuality.failureReason })); if (recovery.content.trim() && recoveryQuality.decision === 'PASS') return { content: composeCeoResponse({ responseAction: request.decisionContract?.responseAction, content: recovery.content, evidenceState: recoveryQuality.evidenceState, quality: recoveryQuality, degraded: false }), provider: recovery.provider, model: recovery.model, responseMs: responseMsBeforeDegraded + (Date.now() - started), attempts: mergedAttempts, executionPlan, decisionPlan, quality: recoveryQuality, evidenceState: recoveryQuality.evidenceState, degraded: false, failureReason: recoveryQuality.failureReason, generation: { primaryOutputProduced: generationOverride?.primaryOutputProduced ?? false, primaryQualityDecision: generationOverride?.primaryQualityDecision ?? 'NOT_RUN', finalOutputProduced: Boolean(recovery.content.trim()), finalStage: generationOverride?.finalStage ?? 'primary', escalationCount: generationOverride?.escalationCount ?? 0 } } } catch (error) { if (isCeoRequestAborted(error)) throw error; console.log('[ceo-recovery-trace]', JSON.stringify({ recoveryAttemptFailed: true, provider: availability!.provider, error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300) })) } } throwIfCeoRequestAborted(getCeoCancellationSignal()); const degraded = await buildCeoDegradedResponse({ objective: recoveryObjective, intent: decisionPlan.executionContract.intent, responseAction: request.decisionContract?.responseAction, selfReflectionKind: decisionPlan.executionContract.selfReflectionKind, reason, failureReason, missionId: request.missionId, contextualEvidence: [request.contextualEvidence?.trim(), recoveredEvidenceContext?.trim()].filter(Boolean).join('\n\n') || undefined, recoveredExternalEvidence: Boolean(recoveredEvidenceContext), priorConversation: request.priorConversation, domain: decisionPlan.executionContract.domain, operation: decisionPlan.executionContract.operation, resolvedReferences: request.canonicalContext?.references, conversationState: request.canonicalContext?.state, partnerIntelligence: request.partnerIntelligence, executiveState: request.executiveState, leadershipLedger: request.leadershipLedger, strategicHorizon: request.strategicHorizon, documentComprehensionSynthesis: request.documentComprehensionSynthesis, documentComprehensionCoverage: request.documentComprehensionCoverage }); throwIfCeoRequestAborted(getCeoCancellationSignal()); const responseMs = responseMsBeforeDegraded + (Date.now() - started); const quality = { decision: 'DEGRADED' as const, evidenceState: degraded.evidenceState, verificationStatus: 'NOT_PERFORMED' as const, checks: { nonEmpty: Boolean(degraded.content.trim()), contractValid: degraded.content.length <= 100_000, objectiveCoverage: false, internalConsistency: true, evidenceDiscipline: true, actionableStructure: true }, evidenceScope, evidenceFreshness, claimScopes: [], failureReason: degraded.failureReason, reasons: [reason, ...(degraded.sourceKeys.length ? [`Recovered ${degraded.sourceKeys.length} internal evidence item(s).`] : [])] }; return { content: composeCeoResponse({ responseAction: request.decisionContract?.responseAction, content: degraded.content, evidenceState: degraded.evidenceState, quality, degraded: true }), responseMs, attempts, executionPlan, decisionPlan, quality, evidenceState: degraded.evidenceState, degraded: true, failureReason: degraded.failureReason, generation: { primaryOutputProduced: generationOverride?.primaryOutputProduced ?? false, primaryQualityDecision: generationOverride?.primaryQualityDecision ?? 'NOT_RUN', finalOutputProduced: Boolean(degraded.content.trim()), finalStage: generationOverride?.finalStage ?? 'none', escalationCount: generationOverride?.escalationCount ?? 0 } } }

export async function runCeoCognitiveLifecycle(request: CeoCognitiveRequest): Promise<CognitiveLifecycleResult> {
  const preRoute = request.preRoute ?? preRouteCeoRequest(request.messages, request.attachmentsCount ?? 0); const resolved = resolvePreRoute(preRoute); const decisionPlan = request.decisionPlan ?? buildCeoDecisionPlan({ messages: request.messages, preRoute, missionId: request.missionId, taskType: request.taskType }); const executionPlan = buildCeoExecutionPlan(decisionPlan); const objective = objectiveFrom(request.messages); const startedAt = Date.now(); const externalExecutionSucceeded = request.externalExecutionSucceeded ?? true;
  // Phase 2 (2026-09-20): computed once from the same canonical `objective` every evaluateCeoQuality
  // call site below already shares, instead of each call (and objectiveCoverage internally) re-deriving
  // "is this a long document" from a bare length check independently.
  // Recommendation 1 (2026-09-20): prefers the decision contract's own comprehensionMode (computed once
  // in buildConversationDecisionContract) over recomputing it here -- see recoveryComprehensionMode's
  // identical comment above for why the fallback stays for callers without one.
  const comprehensionMode = request.decisionContract?.comprehensionMode ?? inferComprehensionMode({ responseAction: request.decisionContract?.responseAction, sourceLength: objective.length })
  const deadline = startedAt + Math.max(request.timeoutMs ?? decisionPlan.latencyBudgetMs, decisionPlan.latencyBudgetMs); const selectedVerification: VerificationTier = request.verification ?? (decisionPlan.qualityTier === 'critical' ? 'strict' : decisionPlan.qualityTier === 'high' ? 'enhanced' : 'standard')
  // Recommendation 1: this lane (ceo_lifecycle) never performs a real external action itself -- only the
  // operational_orchestrator lane's tool-execution phase does, and it re-enters this same function afterward
  // to synthesize the result. So a first-person completion claim is only ever legitimate on that re-entry.
  const externalAgencyAvailable = decisionPlan.executionContract.orchestrationOwner === 'operational_orchestrator'
  let ventureEvidence: Awaited<ReturnType<typeof getCeoVentureEvidenceForObjective>> = null; let ventureEvidenceFreshness: EvidenceFreshness | undefined
  try { ventureEvidence = await getCeoVentureEvidenceForObjective(objective); if (ventureEvidence) ventureEvidenceFreshness = { observedAt: Date.now(), maxAgeMs: 300000 } } catch (error) { if (/\bventure_\d{3}\b/i.test(objective)) { if (isCeoRequestAborted(error)) throw error; const { taskType: recoveryTaskType, verification: recoveryVerification } = recoveryTaskContext(request, decisionPlan); const availability = await attemptValidatedReasoningProvider(Math.max(2500, deadline - Date.now()), recoveryTaskType, recoveryVerification); logCeoDegradedTrace({ objective, intent: decisionPlan.executionContract.intent, path: decisionPlan.path, failureReason: 'context_unavailable', attempts: [] }); return tryDegraded(request, `Live Venture state could not be read: ${error instanceof Error ? error.message : String(error)}`.slice(0, 700), [], Date.now() - startedAt, decisionPlan, executionPlan, true, availability, 'context_unavailable') } }
  const evidenceProvided = Boolean(request.contextualEvidence?.trim() || ventureEvidence?.evidence); const evidenceScope: EvidenceScope | undefined = request.evidenceScope ?? (ventureEvidence ? 'live_system' : decisionPlan.executionContract.intent === 'self_assessment' ? 'internal_state' : undefined); const evidenceFreshness = request.evidenceFreshness ?? ventureEvidenceFreshness
  const readinessSynthesis = decisionPlan.executionContract.selfReflectionKind === 'readiness_assessment' ? synthesizeExecutiveReadiness({ operationalCapabilityVerified: true, liveExecutionVerified: evidenceScope === 'live_system' && Boolean(evidenceFreshness), productionTrafficVerified: request.productionTrafficVerified === true, repeatableBusinessOutcomesVerified: false, sustainedAutonomyVerified: false, observedAt: evidenceFreshness?.observedAt, maxEvidenceAgeMs: evidenceFreshness?.maxAgeMs }) : null
  const worldModel = request.canonicalContext ? buildCeoWorldModel({ context: request.canonicalContext, priorConversation: request.priorConversation, olderConversation: request.relevantOlderConversation, partners: request.partnerIntelligence, executive: request.executiveState, leadership: request.leadershipLedger }) : null; const worldModelMessages = worldModel ? [{ role: 'system' as const, content: `SYSTEM/EXTERNAL AWARENESS (INTERNAL, do not quote verbatim to the user):\nArchitecture: ${worldModel.system.data.architecture.join('; ')}\nDeployment: ${worldModel.system.data.deploymentState.join('; ')}\nExternal evidence available: ${worldModel.external.data.evidenceState === 'available' ? 'yes' : 'no'}\nPartners: ${renderPartnerIntelligenceContext(worldModel.partners.data)}` }] : []
  // Only rendered when the caller actually fetched executive state this turn (route.ts gates this
  // behind self-assessment intent, since it's backed by the heavier operational-KPI computation) --
  // never rendered as "not fetched" filler on every ordinary turn.
  // CEO executive-core integration (2026-09-13): a fetched ventureDecision now feeds directly into
  // decisionSynthesis's risk domain (see riskSignal in ceo-decision-synthesis.ts) -- an
  // irreversible-action-blocked or reject/kill portfolio gate must be able to make this block render
  // even when none of the other executive-state facets happened to have data this turn, or the finding
  // is computed but never reaches the model.
  const executiveStateAvailable = Boolean(worldModel && (worldModel.executive.data.strategy.dataAvailable || worldModel.executive.data.risk.dataAvailable || worldModel.executive.data.customers.dataAvailable || worldModel.executive.data.resources.dataAvailable || request.strategicHorizon || request.leadershipLedger?.length || ventureEvidence?.decision))
  const decisionSynthesis = worldModel ? synthesizeExecutiveDecision({ executive: worldModel.executive.data, partners: worldModel.partners.data, leadership: worldModel.leadership.data, systemIncidents: worldModel.system.data.incidents, ventureDecision: ventureEvidence?.decision, strategicHorizonDecisions: request.strategicHorizon?.openDecisions }) : null
  const executiveStateMessages = executiveStateAvailable ? [{ role: 'system' as const, content: `EXECUTIVE STATE (INTERNAL, do not quote verbatim to the user):\n${renderExecutiveBusinessStateContext(worldModel!.executive.data)}\nCommitments: ${worldModel!.business.data.commitments.join('; ') || 'none open.'}\nLEADERSHIP LEDGER:\n${renderLeadershipPerformanceContext(request.leadershipLedger ?? [])}\nCROSS-DOMAIN SYNTHESIS: ${renderExecutiveDecisionSynthesis(decisionSynthesis!)}${request.strategicHorizon ? `\nSTRATEGIC HORIZON:\n${renderStrategicHorizonContext(request.strategicHorizon)}` : ''}` }] : []
  const liveSystemMessages = ventureEvidence ? [{ role: 'system' as const, content: `LIVE VENTURE STATE (READ ONLY):\n${ventureEvidence.evidence}\nUse these values as system evidence. Do not invent missing values, readiness, revenue, customer success, or authorization.` }] : []; const readinessMessages = readinessSynthesis ? [{ role: 'system' as const, content: `GOVERNED EXECUTIVE READINESS BASELINE (INTERNAL):\nLevel ${readinessSynthesis.level} — ${readinessSynthesis.label}.\n${readinessSynthesis.capability}\n${readinessSynthesis.verified}\n${readinessSynthesis.notProven}\nNext evidence: ${readinessSynthesis.nextEvidence}` }] : []; const actionInstruction = responseActionInstruction(request.decisionContract?.responseAction); const decisionContractMessage = request.decisionContract ? renderConversationDecisionContract(request.decisionContract) : null
  const operatorPlan = request.decisionContract?.responseAction === 'execute' ? buildCeoOperatorPlan({ contract: decisionPlan.executionContract, responseAction: request.decisionContract.responseAction, objective, world: worldModel ?? undefined, curiosity: request.canonicalContext && request.decisionContract ? assessCeoCuriosity(request.canonicalContext, request.decisionContract, worldModel ?? undefined) : undefined, approved: true, executionEvidence: evidenceProvided, verificationState: evidenceScope === 'live_system' && evidenceFreshness ? 'LIVE_VERIFIED' : undefined }) : null; const operatorConstraint = operatorPlan && !canClaimExecution(operatorPlan) ? ` No execution has actually occurred for this request (status: ${operatorPlan.status}). Do not say or imply that you performed, deployed, executed, or completed anything. Describe what you would do and what is still required (${operatorPlan.tasks[0]?.dependencies.join(', ') || 'approval and verification'}) instead.` : ''
  const verifyConstraint = buildVerifyOverclaimConstraint(request.decisionContract?.responseAction, evidenceProvided, evidenceScope)
  const guardianAssessment = request.decisionContract ? assessGuardianRisk({ objective, contract: request.decisionContract, world: worldModel ?? undefined }) : null; const guardianConstraint = guardianAssessment ? renderGuardianConstraint(guardianAssessment) : null; const guardianMessages = guardianConstraint ? [{ role: 'system' as const, content: `GUARDIAN RISK NOTICE:\n${guardianConstraint}` }] : []; const decisionMessages = [ ...(decisionContractMessage ? [{ role: 'system' as const, content: decisionContractMessage }] : []), ...(actionInstruction ? [{ role: 'system' as const, content: `CANONICAL RESPONSE POLICY:\n${actionInstruction}${operatorConstraint}${verifyConstraint}` }] : []) ]
  // Staged long-document architecture (2026-09-22): explicit document operations use the
  // map-reduce executor as an authoritative source-understanding stage. When it succeeds, the final
  // provider generation receives the bounded hierarchical synthesis plus the authoritative instruction,
  // not the raw source document. When it cannot produce a usable synthesis, the lifecycle fails closed
  // to its existing recovery/degraded paths instead of pretending the source was fully understood.
  // The per-section extraction outputs also feed Phase 3's structural source model so the quality gate
  // can check claim coverage and contradiction preservation against the document's real structure.
  const documentComprehension = await (async (): Promise<{ messages: { role: 'system'; content: string }[]; sourceModel?: StructuralSourceModel; authoritative: boolean; synthesis?: string; coverage?: string }> => {
    try {
      const sourceMaterial = request.canonicalContext?.currentMessage ?? objective
      const requestedOperation = request.canonicalContext?.turnEnvelope?.requestedOperation
      const sourceMaterialPresent = request.canonicalContext?.turnEnvelope?.sourceMaterial.present ?? false
      const trace = buildDocumentComprehensionTrace(sourceMaterial)
      if (!sourceMaterialPresent || !isDocumentOperation(requestedOperation) || !shouldExecuteHierarchicalComprehension(trace, requestedOperation)) return { messages: [], authoritative: false }
      const remainingMs = deadline - Date.now()
      const timeBudgetMs = Math.min(30_000, Math.max(0, Math.floor(remainingMs * 0.4)))
      if (timeBudgetMs < 8_000) return { messages: [], authoritative: false }
      const authoritativeInstruction = request.canonicalContext?.turnEnvelope?.instruction.authoritativeText ?? request.canonicalContext?.instruction ?? extractInstructionWindow(objective)
      const plan = buildHierarchicalComprehensionPlan(authoritativeInstruction, sourceMaterial, undefined, requestedOperation)
      const result = await executeHierarchicalComprehension(plan, { signal: getCeoCancellationSignal(), timeBudgetMs })
      if (!result.executed || !result.synthesis) return { messages: [], authoritative: false }
      const coverage = result.failureNotes.length ? 'Section coverage note: ' + result.failureNotes.join(' ') : 'Complete section coverage: ' + result.sectionsProcessed + '/' + trace.sectionCount + ' sections processed.'
      console.log('[ceo-hierarchical-comprehension]', JSON.stringify({ requestedOperation, sectionCount: trace.sectionCount, sectionsProcessed: result.sectionsProcessed, sectionsFailed: result.sectionsFailed, durationMs: result.durationMs, authoritative: true }))
      const messages = [{ role: 'system' as const, content: 'AUTHORITATIVE HIERARCHICAL DOCUMENT COMPREHENSION (INTERNAL SOURCE MODEL):\nThe supplied source has been processed through bounded section analysis and reduction for ' + requestedOperation + '. The final answer path must use this bounded synthesis plus the authoritative user instruction; it must not retransmit or depend on the raw source document. Do not invent claims unsupported by the synthesis.\n\n' + result.synthesis + (result.failureNotes.length ? '\n\nCoverage note (internal): ' + coverage : '') }]
      const sourceModel: StructuralSourceModel | undefined = result.sectionExtracts?.length ? { sectionCount: trace.sectionCount, sectionExtracts: result.sectionExtracts, synthesis: result.synthesis } : undefined
      return { messages, sourceModel, authoritative: true, synthesis: result.synthesis, coverage }
    } catch (error) {
      if (isCeoRequestAborted(error)) throw error
      return { messages: [], authoritative: false }
    }
  })()
  const documentComprehensionMessages = documentComprehension.messages
  const structuralSourceModel = documentComprehension.sourceModel
  const authoritativeDocumentInstruction = request.canonicalContext?.turnEnvelope?.instruction.authoritativeText ?? request.canonicalContext?.instruction ?? extractInstructionWindow(objective)
  const degradedRequest: CeoCognitiveRequest = documentComprehension.synthesis ? { ...request, documentComprehensionSynthesis: documentComprehension.synthesis, documentComprehensionCoverage: documentComprehension.coverage } : request
  const generationObjective = documentComprehension.authoritative ? authoritativeDocumentInstruction : objective
  const sourceForGeneration: readonly { role: 'system' | 'user' | 'assistant'; content: string }[] = documentComprehension.authoritative ? [{ role: 'user', content: authoritativeDocumentInstruction }] : request.messages
  const primaryMessages = [...worldModelMessages, ...guardianMessages, ...executiveStateMessages, ...liveSystemMessages, ...readinessMessages, ...documentComprehensionMessages, ...selfAssessmentGuidanceMessages({ intent: decisionPlan.executionContract.intent, objective: generationObjective, priorConversation: request.priorConversation }), ...decisionMessages, ...sourceForGeneration]
  const stageOptions = (overrides: Record<string, unknown> = {}) => ({ taskType: decisionPlan.executionContract.intent === 'self_assessment' ? 'reasoning' : (request.taskType ?? decisionPlan.taskClass ?? 'reasoning'), verification: selectedVerification, model: request.model, temperature: request.temperature, maxTokens: request.maxTokens, maxProviderAttempts: decisionPlan.maxProviderAttempts, timeoutMs: Math.max(1000, Math.min(60000, deadline - Date.now())), executionClass: resolved === 'fast' ? 'fast' as const : decisionPlan.path === 'critical' ? 'mission' as const : decisionPlan.path === 'full' ? 'deep' as const : 'standard' as const, ...overrides })
  let primary: CanonicalLlmResult | undefined; let review: CanonicalLlmResult | undefined; let final: CanonicalLlmResult | undefined; let escalation = 0; let primaryQuality: CognitiveLifecycleResult['quality'] | undefined; let finalStage: CeoGenerationDiagnostics['finalStage'] = 'primary'
  try {
    const action = request.decisionContract?.responseAction
    if (action === 'clarify') { const clarificationMessages = request.canonicalContext?.turnEnvelope?.sourceMaterial.present ? [{ role: 'system' as const, content: 'SOURCE MATERIAL PRESENT: approximately ' + request.canonicalContext.turnEnvelope.sourceMaterial.length + ' characters were supplied. Do not reproduce or analyze the source in this clarification call.' }, { role: 'user' as const, content: 'AUTHORITATIVE USER INSTRUCTION:\n' + authoritativeDocumentInstruction }] : request.messages; primary = await runCanonicalLlm({ ...stageOptions({ maxProviderAttempts: 1, maxTokens: Math.min(request.maxTokens ?? 600, 600), executionClass: 'fast' as const }), messages: [...guardianMessages, ...decisionMessages, ...clarificationMessages, { role: 'user', content: 'Ask the minimum necessary natural clarification needed to resolve the user’s task requirements. Return only the clarification question.' }] }) }
    else { primary = await runCanonicalLlm({ ...stageOptions(), messages: primaryMessages }); if (executionPlan.reasoningStrategy === 'multi_pass') { try { const refinement = await runCanonicalLlm({ ...stageOptions({ maxProviderAttempts: 2 }), messages: [...primaryMessages, { role: 'assistant', content: primary.content }, buildRefinementPrompt(generationObjective, primary.content)], excludeProviders: stageExclusions(primary.provider) }); review = refinement; final = refinement; finalStage = 'refinement' } catch (error) { if (isCeoRequestAborted(error)) throw error } } else if (executionPlan.reasoningStrategy === 'independent_review') { try { review = await runCanonicalLlm({ ...stageOptions({ maxProviderAttempts: 2 }), messages: [...worldModelMessages, ...guardianMessages, ...executiveStateMessages, ...liveSystemMessages, ...readinessMessages, ...decisionMessages, { role: 'system', content: 'You are an independent verification reviewer for Agent007. Be skeptical, precise, and concise.' }, buildReviewPrompt(generationObjective, primary.content)], excludeProviders: stageExclusions(primary.provider) }); final = await runCanonicalLlm({ ...stageOptions({ maxProviderAttempts: 2 }), messages: [...worldModelMessages, ...guardianMessages, ...executiveStateMessages, ...liveSystemMessages, ...readinessMessages, ...decisionMessages, { role: 'system', content: 'You are the final executive synthesizer for Agent007. Use the draft and independent review to produce the strongest justified answer.' }, buildSynthesisPrompt(generationObjective, primary.content, review.content, ventureEvidence?.evidence, readinessSynthesis ? `Level ${readinessSynthesis.level} — ${readinessSynthesis.label}. ${readinessSynthesis.verified} ${readinessSynthesis.notProven}` : undefined)], excludeProviders: stageExclusions(review.provider) }); finalStage = 'synthesis' } catch (error) { if (isCeoRequestAborted(error)) throw error; review = undefined; final = undefined; finalStage = 'primary' } } }
    if (primary) primaryQuality = evaluateCeoQuality({ objective: generationObjective, content: sanitizeCeoContentForQualityGate(primary.content), path: decisionPlan.path, intent: decisionPlan.executionContract.intent, reviewed: false, externalExecutionSucceeded, evidenceProvided, evidenceScope, evidenceFreshness, evidenceBundle: request.evidenceBundle, priorTurns: request.priorConversation, relevantOlderMessages: request.relevantOlderConversation, resolvedReferences: request.canonicalContext?.references, responseAction: request.decisionContract?.responseAction, externalAgencyAvailable, comprehensionMode, structuralSourceModel })
    let output = final ?? primary
    if (!output) return tryDegraded(degradedRequest, 'No usable provider output was produced.', [], Date.now() - startedAt, decisionPlan, executionPlan, false, [], 'provider_unavailable', { primaryOutputProduced: false, primaryQualityDecision: 'NOT_RUN', finalOutputProduced: false, finalStage: 'none', escalationCount: 0 }, ventureEvidence, ventureEvidenceFreshness)
    let quality = evaluateCeoQuality({ objective: generationObjective, content: sanitizeCeoContentForQualityGate(output.content), path: decisionPlan.path, intent: decisionPlan.executionContract.intent, reviewed: Boolean(review && executionPlan.reasoningStrategy === 'independent_review'), externalExecutionSucceeded, evidenceProvided, evidenceScope, evidenceFreshness, evidenceBundle: request.evidenceBundle, priorTurns: request.priorConversation, relevantOlderMessages: request.relevantOlderConversation, resolvedReferences: request.canonicalContext?.references, responseAction: request.decisionContract?.responseAction, externalAgencyAvailable, comprehensionMode, structuralSourceModel })
    // A real production incident (traced via live runtime logs, request 99a00917) showed the escalation
    // call itself failing on a transient provider error (providerAvailable:false) -- and the old catch
    // here unconditionally broke out of the whole loop on ANY error, permanently abandoning the rest of
    // the escalation budget even when decisionPlan.maxEscalations allowed another attempt (2 for critical
    // paths). That meant a fixable, one-off provider hiccup fell straight through to degraded mode's
    // canned template instead of getting the retry the budget already allowed for. Only a request
    // cancellation now stops the loop early; any other error just lets the while condition's own
    // escalation/deadline bounds decide whether another attempt is tried -- quality/output/final are left
    // exactly as they were before the failed attempt, so a subsequent iteration (or the fall-through to
    // tryDegraded after the loop exits) sees consistent state either way.
    while (quality.decision === 'ESCALATE' && escalation < decisionPlan.maxEscalations && Date.now() < deadline) { escalation += 1; const lastProvider = final?.provider ?? review?.provider ?? primary?.provider; try { const escalated = await runCanonicalLlm({ ...stageOptions({ maxProviderAttempts: 2 }), messages: [...worldModelMessages, ...guardianMessages, ...executiveStateMessages, ...liveSystemMessages, ...readinessMessages, ...decisionMessages, { role: 'system', content: 'You are an escalation reviewer. Repair the response only where the quality gate found material issues. Do not invent evidence.' }, { role: 'user', content: `Objective:\n${generationObjective}\n\nCandidate:\n${output.content}\n\nQuality findings:\n${quality.reasons.join(' | ')}` }], excludeProviders: stageExclusions(lastProvider) }); final = escalated; output = escalated; finalStage = 'escalation'; quality = evaluateCeoQuality({ objective: generationObjective, content: sanitizeCeoContentForQualityGate(escalated.content), path: decisionPlan.path, intent: decisionPlan.executionContract.intent, reviewed: true, externalExecutionSucceeded, evidenceProvided, evidenceScope, evidenceFreshness, evidenceBundle: request.evidenceBundle, priorTurns: request.priorConversation, relevantOlderMessages: request.relevantOlderConversation, resolvedReferences: request.canonicalContext?.references, responseAction: request.decisionContract?.responseAction, externalAgencyAvailable, comprehensionMode, structuralSourceModel }); if (quality.decision === 'PASS') break } catch (error) { if (isCeoRequestAborted(error)) throw error } }
    const result0 = final ?? primary
    if (!result0) return tryDegraded(degradedRequest, 'Provider execution exhausted before a final answer was available.', mergeAttempts(primary, review, final), Date.now() - startedAt, decisionPlan, executionPlan, false, [], 'provider_unavailable', { primaryOutputProduced: Boolean(primary?.content.trim()), primaryQualityDecision: primaryQuality?.decision ?? 'NOT_RUN', finalOutputProduced: false, finalStage: 'none', escalationCount: escalation }, ventureEvidence, ventureEvidenceFreshness)
    let result = result0; let semanticRepairApplied = false
    if (request.decisionContract && quality.decision !== 'PASS' && ['conversation', 'opinion', 'decision', 'analysis'].includes(request.decisionContract.intent) && Date.now() < deadline) { const report = buildSemanticQualityReport({ quality, conversationQuality: quality.conversationQuality, contract: request.decisionContract, content: result.content }); if (report.decision === 'REPAIR') { const plan = buildSemanticRepairPlan(report); try { const repaired = await runCanonicalLlm({ ...stageOptions({ maxProviderAttempts: 2 }), messages: [...primaryMessages, { role: 'assistant', content: result.content }, renderSemanticRepairPrompt(generationObjective, result.content, plan)], excludeProviders: stageExclusions(result.provider) }); const repairedQuality = evaluateCeoQuality({ objective: generationObjective, content: sanitizeCeoContentForQualityGate(repaired.content), path: decisionPlan.path, intent: decisionPlan.executionContract.intent, reviewed: true, externalExecutionSucceeded, evidenceProvided, evidenceScope, evidenceFreshness, evidenceBundle: request.evidenceBundle, priorTurns: request.priorConversation, relevantOlderMessages: request.relevantOlderConversation, resolvedReferences: request.canonicalContext?.references, responseAction: request.decisionContract?.responseAction, externalAgencyAvailable, comprehensionMode, structuralSourceModel }); const repairedReport = buildSemanticQualityReport({ quality: repairedQuality, conversationQuality: repairedQuality.conversationQuality, contract: request.decisionContract, content: repaired.content }); console.log('[ceo-semantic-repair]', JSON.stringify({ failedDimensions: report.failedDimensions, repairPriority: report.repairPriority, beforeDecision: report.decision, afterDecision: repairedReport.decision })); if (repairedReport.decision !== 'DEGRADE' && (repairedReport.failedDimensions.length < report.failedDimensions.length || repairedReport.contractSatisfied)) { result = repaired; final = repaired; quality = repairedQuality; semanticRepairApplied = true; finalStage = 'semantic_repair' } } catch (error) { if (isCeoRequestAborted(error)) throw error } } }
    const authoritativeIntent = request.decisionContract?.intent; const isConversational = ['conversation', 'opinion', 'decision', 'analysis'].includes(authoritativeIntent ?? decisionPlan.executionContract.intent); const isGenuineOverclaim = quality.failureReason === 'evidence_unavailable' || quality.failureReason === 'evidence_insufficient' || quality.failureReason === 'claim_consistency_failure' || quality.failureReason === 'false_completion_claim' || quality.failureReason === 'internal_artifact_leak'; const conversationQuality = quality.conversationQuality; const softPassCandidate = isConversational && !isGenuineOverclaim && (conversationQuality?.score ?? 0) >= 60; const semanticCheck = (quality.decision !== 'PASS' && softPassCandidate) ? await semanticSubstanceCheck(generationObjective, result.content) : { substantive: true, checked: false }; const semanticContinuity = (quality.decision !== 'PASS' && softPassCandidate && quality.failureReason === 'continuity_failure') ? await semanticContinuityCheck(generationObjective, request.priorConversation ?? [], result.content, request.relevantOlderConversation ?? []) : { coherent: false, checked: false }; const softPassEligible = isGovernedSoftPassEligible({ intent: decisionPlan.executionContract.intent, authoritativeIntent, qualityDecision: quality.decision, failureReason: quality.failureReason, conversationScore: conversationQuality?.score, substantive: semanticCheck.checked && semanticCheck.substantive, semanticContinuityConfirmed: semanticContinuity.coherent }); if (quality.decision !== 'PASS' && !softPassEligible) return tryDegraded(degradedRequest, `Quality gate did not pass after the allowed escalation depth: ${quality.reasons.join(' | ')}`, mergeAttempts(primary, review, final), Date.now() - startedAt, decisionPlan, executionPlan, false, [], quality.failureReason, { primaryOutputProduced: Boolean(primary?.content.trim()), primaryQualityDecision: primaryQuality?.decision ?? 'NOT_RUN', finalOutputProduced: Boolean(result.content.trim()), finalStage, escalationCount: escalation }, ventureEvidence, ventureEvidenceFreshness); if (quality.decision !== 'PASS' && softPassEligible) console.log('[ceo-soft-pass]', JSON.stringify({ intent: decisionPlan.executionContract.intent, failureReason: quality.failureReason, contentLength: result.content.length, conversationQualityScore: conversationQuality?.score, semanticChecked: semanticCheck.checked, semanticContinuityChecked: semanticContinuity.checked, semanticContinuityConfirmed: semanticContinuity.coherent })); const evidenceState: EvidenceState = quality.evidenceState; console.log('[ceo-runtime-trace]', JSON.stringify({ intent: decisionPlan.executionContract.intent, path: decisionPlan.path, responseAction: request.decisionContract?.responseAction ?? null, provider: result.provider, model: result.model, contentLength: result.content.length, qualityDecision: quality.decision, evidenceState, responseMs: Date.now() - startedAt, degraded: false })); return { content: composeCeoResponse({ responseAction: request.decisionContract?.responseAction, content: result.content, evidenceState, quality, degraded: false }), provider: result.provider, model: result.model, responseMs: Date.now() - startedAt, attempts: mergeAttempts(primary, review, final), executionPlan, decisionPlan, quality, evidenceState, degraded: false, failureReason: quality.failureReason, generation: { primaryOutputProduced: Boolean(primary?.content.trim()), primaryQualityDecision: primaryQuality?.decision ?? 'NOT_RUN', finalOutputProduced: Boolean(result.content.trim()), finalStage: semanticRepairApplied ? 'semantic_repair' : finalStage, escalationCount: escalation } }
  } catch (error) { if (isCeoRequestAborted(error)) throw error; const { taskType: recoveryTaskType, verification: recoveryVerification } = recoveryTaskContext(request, decisionPlan); const availability = await attemptValidatedReasoningProvider(Math.max(2500, deadline - Date.now()), recoveryTaskType, recoveryVerification); const failureReason: CeoFailureReason = error instanceof Error && /timeout|timed out/i.test(error.message) ? 'execution_timeout' : 'provider_error'; logCeoDegradedTrace({ objective, intent: decisionPlan.executionContract.intent, path: decisionPlan.path, failureReason, attempts: mergeAttempts(primary, review, final), rawContentLength: (final ?? primary)?.content.length }); return tryDegraded(degradedRequest, error instanceof Error ? error.message.slice(0, 500) : 'All governed external execution paths failed.', mergeAttempts(primary, review, final), Date.now() - startedAt, decisionPlan, executionPlan, true, availability, failureReason, { primaryOutputProduced: Boolean(primary?.content.trim()), primaryQualityDecision: primaryQuality?.decision ?? 'NOT_RUN', finalOutputProduced: Boolean((final ?? primary)?.content?.trim()), finalStage, escalationCount: escalation }, ventureEvidence, ventureEvidenceFreshness) }
}
