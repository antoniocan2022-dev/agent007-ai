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
import type { CognitiveLifecycleResult, DecisionPlan, EvidenceScope, EvidenceFreshness, EvidenceState, PreRouteDecision, CeoGenerationDiagnostics, CeoIntent, QualityResult, RequestedOperation, CeoClaimVerificationSummary } from './ceo-cognitive-contract'
import { inferComprehensionMode, extractInstructionWindow, extractInstructionWindowDetails, resolveCeoLane } from './ceo-cognitive-contract'
import { CEO_FAST_CHAT_PROVIDER_PRIORITY } from './provider-intelligence-policy'
import type { ConversationDecisionContract } from './ceo-conversation-decision-contract'
import { isDocumentOperation, renderConversationDecisionContract } from './ceo-conversation-decision-contract'
import { inferRequestedOperation, type CanonicalConversationContext } from './ceo-cognitive-conversation'
import type { EvidenceBundle } from './ceo-evidence-bundle'
import { buildCeoWorldModel } from './ceo-world-model'
import { renderPartnerIntelligenceContext, type PartnerIntelligenceSummary } from './ceo-partner-intelligence'
import { renderExecutiveBusinessStateContext, type ExecutiveBusinessState } from './ceo-executive-state'
import { synthesizeExecutiveDecision, renderExecutiveDecisionSynthesis } from './ceo-decision-synthesis'
import { renderLeadershipPerformanceContext, type LeaderPerformanceRecord } from './ceo-leadership-performance'
import { renderStrategicHorizonContext, type StrategicHorizonView } from './ceo-strategic-horizon'
import type { CeoFailureReason } from './ceo-failure-reason'
import { mapProviderErrorKindToCeoFailureReason } from './ceo-failure-reason'
import { ProviderControlPlaneError } from './provider-control-plane'
import type { PersistedConversationRow } from './ceo-context-composer'
import { getCeoCancellationSignal } from './ceo-cancellation-context'
import { isCeoRequestAborted, throwIfCeoRequestAborted } from './ceo-cancellation'
import { isGovernedSoftPassEligible } from './ceo-soft-pass-policy'
import { safeConversationRows } from './ceo-conversation-state'
import { isContinuationOrRestatementRequest } from './ceo-conversational-signals'
import { buildDocumentComprehensionTrace, buildHierarchicalComprehensionPlan } from './ceo-document-comprehension'
import { shouldExecuteHierarchicalComprehension, executeHierarchicalComprehension, MIN_VIABLE_TIME_BUDGET_MS as DOCUMENT_COMPREHENSION_MIN_VIABLE_TIME_BUDGET_MS } from './ceo-document-comprehension-executor'
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
  documentStructuralSourceModel?: StructuralSourceModel
  // Self-repair follow-up (2026-09-25): the requestedOperation used to build the ORIGINAL hierarchical
  // comprehension plan, threaded through so tryDegraded's resume path (see isFutileStructuralCoverageEscalation's
  // comment) can rebuild an identical plan -- same section split, same map/reduce prompt wording -- to
  // extract the sections Phase 3 didn't reach the first time, instead of re-inferring it and risking drift
  // from the plan that actually produced documentStructuralSourceModel.
  documentRequestedOperation?: RequestedOperation
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
export function replaceCurrentUserMessage(messages: CeoCognitiveRequest['messages'], content: string): CeoCognitiveRequest['messages'] {
  const next = messages.map((message) => ({ ...message }))
  for (let index = next.length - 1; index >= 0; index -= 1) {
    if (next[index]?.role === 'user') {
      next[index] = { ...next[index], content }
      return next
    }
  }
  return [...next, { role: 'user', content }]
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
  const phrasing = `SELF-ASSESSMENT PHRASING GUIDANCE (INTERNAL):\nYou have real internal system data available (architecture, deployment, partners, leadership, strategy). State those facts directly and plainly.\nDo NOT phrase live/production/operational performance claims as confirmed or verified (e.g. "is verified and serving production traffic", "is confirmed live") unless this turn's evidence is explicitly tagged as live-verified -- that overclaims what internal system data alone supports. Instead hedge those specific claims: describe what is architecturally/operationally in place, and separately state that live execution, production traffic handling, and sustained outcomes remain unproven unless verified this turn.\nDo NOT state a specific knowledge-cutoff date, training date, or model-version detail as a confirmed fact -- no system data supplies one, this system runs on multiple interchangeable LLM providers/models turn to turn, and inventing a specific date presents a guess as verified. If asked, say plainly that this isn't a fact the system tracks about itself rather than naming a date.\nSpeak the way a thoughtful human executive would talk to someone they work with -- plain, direct, conversational sentences, not a formatted report. Lead with the plain-English judgment (what you can and can't yet claim), and use the underlying facts to support it rather than opening with them.`
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
// Efficiency fix (2026-09-26): the probe budget (up to 2 candidate providers) used to be probed one at a
// time in a sequential for-await loop, so validating 2 candidates before a recovery attempt took roughly
// twice as long as necessary -- each probe is an independent network round-trip that doesn't depend on
// any other probe's result. Probed concurrently via Promise.allSettled instead; `validated` is still built
// by iterating `candidates` in the same fixed priority order (closed-circuit providers first, as chosen
// above), so which candidate is preferred when multiple pass is unchanged -- only the wall-clock cost of
// finding out is reduced.
async function attemptValidatedReasoningProvider(timeoutMs: number, taskType: TaskType = 'reasoning', verification: VerificationTier = 'standard'): Promise<ValidatedAvailability> {
  const configured = getConfiguredProviders()
  if (!configured.length) return []
  const governedConfigured = configured.filter((provider) => getGovernedCandidates(provider, taskType, verification).length > 0)
  if (!governedConfigured.length) return []
  const closed = governedConfigured.filter((provider) => !isCircuitOpen(provider))
  const halfOpen = closed.length ? null : pickHalfOpenCandidate(governedConfigured)
  const ordered = closed.length ? closed : (halfOpen ? [halfOpen] : [])
  const attemptBudget = Math.min(ordered.length, 2)
  const candidates = ordered.slice(0, attemptBudget)
  const settled = await Promise.allSettled(candidates.map((provider) => probeProvider(provider, { taskType, verification, timeoutMs: Math.max(2500, Math.min(10000, timeoutMs)), maxTokens: 128, allowHalfOpenProbe: true })))
  const aborted = settled.find((entry): entry is PromiseRejectedResult => entry.status === 'rejected' && isCeoRequestAborted(entry.reason))
  if (aborted) throw aborted.reason
  const validated: ValidatedCandidate[] = []
  settled.forEach((entry, index) => {
    if (entry.status !== 'fulfilled') return
    const probe = entry.value
    if (probe.success && probe.model && probe.responseMs !== null) validated.push({ provider: candidates[index]!, model: probe.model, responseMs: probe.responseMs })
  })
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
/**
 * Efficiency fix (2026-09-24, following the structural quality gate audit): the escalation loop below
 * asks the model to repair a rejected answer using the SAME source messages it already had. That works
 * for phrasing/consistency/continuity misses -- the model genuinely can do better on a second pass. It
 * cannot work when the ONLY reason the answer was rejected is that Phase 3's hierarchical comprehension
 * hit its time budget before processing the whole document (structuralQuality.sourceCoverageComplete ===
 * false): no escalation attempt adds newly-processed sections, so retrying spends a full LLM round-trip
 * (and its own timeout budget) on an attempt that is structurally guaranteed to fail the same check
 * again, before falling through to tryDegraded's already-correct, coverage-aware recovery response.
 * Deliberately narrow: only true when structural incomplete coverage is the SOLE blocker -- every other
 * check (including contradiction preservation, which an escalation CAN genuinely repair by adding
 * acknowledgment language) must already be passing, so a turn with a real, fixable defect alongside
 * incomplete coverage still gets its escalation attempt.
 */
export function isFutileStructuralCoverageEscalation(quality: QualityResult): boolean {
  return (
    quality.decision === 'ESCALATE' &&
    quality.structuralQuality?.applicable === true &&
    quality.structuralQuality.sourceCoverageComplete === false &&
    !quality.checks.objectiveCoverage &&
    quality.checks.nonEmpty &&
    quality.checks.contractValid &&
    quality.checks.internalConsistency &&
    quality.checks.evidenceDiscipline &&
    quality.checks.actionableStructure
  )
}
async function tryDegraded(request: CeoCognitiveRequest, reason: string, attempts: string[], responseMsBeforeDegraded: number, decisionPlan: ReturnType<typeof buildCeoDecisionPlan>, executionPlan: ReturnType<typeof buildCeoExecutionPlan>, availabilityAttempted = false, validatedAvailability: ValidatedAvailability = [], failureReason?: CeoFailureReason, generationOverride?: Partial<CeoGenerationDiagnostics>, ventureEvidence: { ventureId: string; evidence: string } | null = null, ventureEvidenceFreshness?: EvidenceFreshness, recoveryGenerationFutile = false, priorDraftContent?: string, claimVerification?: readonly CeoClaimVerificationSummary[]): Promise<CognitiveLifecycleResult> {
  throwIfCeoRequestAborted(getCeoCancellationSignal())
  const started = Date.now()
  const originalObjective = objectiveFrom(request.messages)
  const recoveryObjective = request.documentComprehensionSynthesis ? (request.canonicalContext?.turnEnvelope?.instruction.authoritativeText ?? request.canonicalContext?.instruction ?? extractInstructionWindow(originalObjective)) : originalObjective
  const recoverySourceMessages: readonly { role: 'system' | 'user' | 'assistant'; content: string }[] = request.documentComprehensionSynthesis ? replaceCurrentUserMessage(request.messages, recoveryObjective) : request.messages
  // Self-repair follow-up (2026-09-25), Option 3: when the pipeline degraded SOLELY because Phase 3's
  // hierarchical comprehension hit its time budget before covering the whole document
  // (recoveryGenerationFutile -- see isFutileStructuralCoverageEscalation's comment on the caller
  // side), a bare regeneration attempt below can never pass the quality gate no matter what it says:
  // claimCoverageOk is `sourceCoverageComplete && claimCoverage >= 0.25`
  // (ceo-structural-quality-gate.ts), and sourceCoverageComplete is a fixed property of the SOURCE
  // MODEL, not of any candidate answer -- no amount of regenerating changes it. Spend part of the
  // recovery budget actually finishing the document instead of a doomed regeneration: rebuild the
  // identical plan (same document text + same requestedOperation -> identical section split and
  // prompt wording as the original call) and resume from exactly the sections Phase 3 already
  // extracted, processing only what's still missing. If that reaches full coverage, the regeneration
  // loop below gets a genuine shot at PASSing on a complete synthesis; if it doesn't (still out of
  // time, or the remaining sections fail again), skipRecoveryGeneration below still protects against
  // wasting a doomed regeneration call, and the canned fallback renders whatever the best synthesis
  // turned out to be -- never worse than today's behavior, only better when it can be.
  let resumedDocumentComprehension: { synthesis: string; coverage: string; sourceModel?: StructuralSourceModel } | null = null
  if (recoveryGenerationFutile && request.documentStructuralSourceModel && request.documentStructuralSourceModel.coverageComplete === false) {
    const remainingBudgetMs = (request.timeoutMs ?? decisionPlan.latencyBudgetMs) - responseMsBeforeDegraded
    // Half the remaining budget, capped at 20s -- mirrors the primary path's own 40%-of-remaining/30s-cap
    // ratio (see the documentComprehension IIFE above) while leaving room afterward for either a real
    // regeneration call or the canned-template build, whichever this ends up needing.
    const resumeTimeBudgetMs = Math.min(20_000, Math.max(0, Math.floor(remainingBudgetMs * 0.5)))
    if (resumeTimeBudgetMs >= DOCUMENT_COMPREHENSION_MIN_VIABLE_TIME_BUDGET_MS) {
      try {
        const sourceMaterial = request.canonicalContext?.currentMessage ?? originalObjective
        const resumePlan = buildHierarchicalComprehensionPlan(recoveryObjective, sourceMaterial, undefined, request.documentRequestedOperation ?? 'document_comprehension')
        const priorExtracts = request.documentStructuralSourceModel.sectionExtracts
        const resumeResult = await executeHierarchicalComprehension(resumePlan, { signal: getCeoCancellationSignal(), timeBudgetMs: resumeTimeBudgetMs, priorExtracts })
        if (resumeResult.executed && resumeResult.synthesis) {
          const coverageComplete = resumeResult.complete
          const coverage = coverageComplete
            ? `Complete source coverage: ${resumeResult.sectionsProcessed}/${request.documentStructuralSourceModel.sectionCount} sections processed.`
            : `PARTIAL source coverage: ${resumeResult.sectionsProcessed}/${request.documentStructuralSourceModel.sectionCount} sections processed; ${resumeResult.sectionsFailed} section(s) failed or were not processed. Do not claim the entire source was comprehended.${resumeResult.failureNotes.length ? ' ' + resumeResult.failureNotes.join(' ') : ''}`
          resumedDocumentComprehension = {
            synthesis: resumeResult.synthesis,
            coverage,
            sourceModel: resumeResult.sectionExtracts?.length ? { sectionCount: request.documentStructuralSourceModel.sectionCount, sectionExtracts: resumeResult.sectionExtracts, synthesis: resumeResult.synthesis, coverageComplete } : undefined,
          }
          console.log('[ceo-hierarchical-comprehension-resume]', JSON.stringify({ priorSectionsCovered: priorExtracts.length, sectionsProcessedAfterResume: resumeResult.sectionsProcessed, coverageComplete, durationMs: resumeResult.durationMs }))
        }
      } catch (error) {
        if (isCeoRequestAborted(error)) throw error
        console.log('[ceo-hierarchical-comprehension-resume]', JSON.stringify({ attempted: true, failed: true, error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300) }))
      }
    }
  }
  const effectiveDocumentSynthesis = resumedDocumentComprehension?.synthesis ?? request.documentComprehensionSynthesis
  const effectiveDocumentCoverage = resumedDocumentComprehension?.coverage ?? request.documentComprehensionCoverage
  const effectiveStructuralSourceModel = resumedDocumentComprehension?.sourceModel ?? request.documentStructuralSourceModel
  // Only skip the recovery-generation loop below when it would STILL be futile after the resume
  // attempt above -- if resuming actually reached complete coverage, a regeneration is now genuinely
  // worth trying, since the gate that made it unwinnable no longer applies.
  const skipRecoveryGeneration = recoveryGenerationFutile && effectiveStructuralSourceModel?.coverageComplete !== true
  const { taskType: recoveryTaskType, verification: recoveryVerification } = recoveryTaskContext(request, decisionPlan)
  // Self-repair follow-up (2026-09-26): verifyClaimEvidence's own per-claim reasons (ceo-claim-evidence-
  // gate.ts, now surfaced as CeoClaimVerificationSummary) distinguish two very different evidence
  // failures that used to get IDENTICAL treatment below -- a full re-search via
  // buildExternalEvidencePlan/recoverExternalEvidencePlan regardless of cause. When EVERY unsupported
  // claim already has sourceCount > 0 (evidence was found, it just didn't satisfy freshness/topical/
  // quantitative/entity matching -- a mis-citation, not an absence), a fresh web search looks for
  // something that was never actually missing. Try one cheap, targeted citation-repair pass against the
  // evidence already retrieved (request.evidenceBundle) first; only the full re-search below runs when
  // this doesn't apply (a genuine absence among the unsupported claims) or doesn't produce a passing
  // answer.
  const unsupportedClaims = (claimVerification ?? []).filter((claim) => !claim.supported)
  const misattributionOnly = unsupportedClaims.length > 0 && unsupportedClaims.every((claim) => claim.sourceCount > 0)
  if (!skipRecoveryGeneration && misattributionOnly && priorDraftContent && request.evidenceBundle?.sources.length) {
    try {
      const { renderEvidenceBundleForPrompt } = await import('./ceo-evidence-bundle')
      const citationRepairPrompt = `The following claims in your previous answer were not properly linked to the evidence already retrieved -- the evidence exists, it just wasn't cited or aligned correctly:\n${unsupportedClaims.map((claim) => `- "${claim.claim}" (${claim.reason})`).join('\n')}\n\nEXISTING EVIDENCE (use this, do not invent new figures or search for new sources):\n${renderEvidenceBundleForPrompt(request.evidenceBundle)}\n\nPREVIOUS ANSWER:\n${priorDraftContent.slice(0, 20000)}\n\nRevise the previous answer so every claim above is either correctly aligned to the existing evidence (cite the matching figure/source) or removed/hedged if it genuinely isn't supported. Do not introduce any new claim. Return the corrected answer only.`
      const citationCandidates = validatedAvailability.length || availabilityAttempted ? validatedAvailability : await attemptValidatedReasoningProvider(Math.max(2500, (request.timeoutMs ?? decisionPlan.latencyBudgetMs) - responseMsBeforeDegraded), recoveryTaskType, recoveryVerification)
      for (const candidate of citationCandidates) {
        const repaired = await runCanonicalLlm({ messages: [{ role: 'user', content: citationRepairPrompt }], taskType: recoveryTaskType, verification: recoveryVerification, model: candidate.model, temperature: request.temperature ?? 0.2, maxTokens: request.maxTokens ?? 4000, timeoutMs: Math.max(1000, Math.min(20000, (request.timeoutMs ?? decisionPlan.latencyBudgetMs) - (Date.now() - started))), maxProviderAttempts: 1, excludeProviders: PROVIDER_ORDER.filter((provider) => provider !== candidate.provider) })
        const repairedQuality = evaluateCeoQuality({ objective: recoveryObjective, content: sanitizeCeoContentForQualityGate(repaired.content), path: decisionPlan.path, intent: decisionPlan.executionContract.intent, reviewed: false, externalExecutionSucceeded: request.externalExecutionSucceeded ?? true, evidenceProvided: true, evidenceScope: request.evidenceScope, evidenceFreshness: request.evidenceFreshness, evidenceBundle: request.evidenceBundle, priorTurns: request.priorConversation, relevantOlderMessages: request.relevantOlderConversation, resolvedReferences: request.canonicalContext?.references, responseAction: request.decisionContract?.responseAction, externalAgencyAvailable: decisionPlan.executionContract.orchestrationOwner === 'operational_orchestrator', comprehensionMode: request.decisionContract?.comprehensionMode ?? inferComprehensionMode({ responseAction: request.decisionContract?.responseAction, sourceLength: recoveryObjective.length }), structuralSourceModel: effectiveStructuralSourceModel })
        if (repaired.content.trim() && repairedQuality.decision === 'PASS') {
          console.log('[ceo-citation-repair]', JSON.stringify({ attempted: true, succeeded: true, unsupportedClaimCount: unsupportedClaims.length }))
          return { content: composeCeoResponse({ responseAction: request.decisionContract?.responseAction, content: repaired.content, evidenceState: repairedQuality.evidenceState, quality: repairedQuality, degraded: false }), provider: repaired.provider, model: repaired.model, responseMs: responseMsBeforeDegraded + (Date.now() - started), attempts: [...new Set([...attempts, candidate.provider, ...repaired.attempts])], executionPlan, decisionPlan, quality: repairedQuality, evidenceState: repairedQuality.evidenceState, degraded: false, failureReason: repairedQuality.failureReason, generation: { primaryOutputProduced: generationOverride?.primaryOutputProduced ?? false, primaryQualityDecision: generationOverride?.primaryQualityDecision ?? 'NOT_RUN', finalOutputProduced: true, finalStage: generationOverride?.finalStage ?? 'primary', escalationCount: generationOverride?.escalationCount ?? 0 } }
        }
      }
      console.log('[ceo-citation-repair]', JSON.stringify({ attempted: true, succeeded: false, unsupportedClaimCount: unsupportedClaims.length }))
    } catch (error) {
      if (isCeoRequestAborted(error)) throw error
      console.log('[ceo-citation-repair]', JSON.stringify({ attempted: true, failed: true, error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300) }))
    }
  }
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
  const availabilityCandidates = skipRecoveryGeneration
    ? []
    : (validatedAvailability.length || availabilityAttempted)
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
  // Efficiency fix (2026-09-26): when evidence recovery WAS attempted (shouldRecoverEvidenceBeforeProvider
  // fired) but found zero usable sources, the recovery generation call below used to get no signal that a
  // fresh search had already been tried and failed -- it just saw the same conversation that produced the
  // original evidence_insufficient/evidence_unavailable failure, so an unhedged answer failed evidenceOk
  // for the identical reason again, guaranteed. Explicitly telling the model no evidence is recoverable
  // and it must hedge gives this attempt a real chance to pass: evidenceOk only fails on a POSITIVE,
  // unhedged external/business-fact assertion (see externalWebAssertionExists/NEGATION_RE in
  // ceo-response-quality-gate.ts) -- a response that genuinely hedges every such claim can clear the gate
  // even with recoveredEvidenceContext still empty, where a bare regeneration attempt could not.
  const recoveryEvidenceMessages = recoveredEvidenceContext
    ? [{ role: 'system' as const, content: `RECOVERED EXTERNAL EVIDENCE (INTERNAL GROUNDING):\n${recoveredEvidenceContext}\nUse these freshly acquired sources to answer the user's objective. Do not invent claims beyond the evidence.` }]
    : evidenceRecoveryAttempted
      ? [{ role: 'system' as const, content: `NO RECOVERABLE EVIDENCE (INTERNAL): A fresh external search was just attempted for this objective and found no usable sources. Do not state or imply any external or business fact (market data, competitor activity, pricing, revenue, sales, stock/share data, or similar) as confirmed, current, or known -- explicitly say what you cannot confirm and why, rather than answering as if the fact were established.` }]
      : []
  // Production audit fix (2026-09-24): this recovery generation call is the genuine second real LLM
  // attempt for a document-comprehension turn (before the lifecycle falls all the way to the canned
  // buildCeoDegradedResponse template). recoverySourceMessages already strips the raw source document
  // via replaceCurrentUserMessage, but unlike primaryMessages (which includes documentComprehensionMessages),
  // nothing here ever carried the bounded hierarchical synthesis forward -- so this attempt ran with no
  // source content at all and was effectively guaranteed to fail its own quality gate, wasting the one
  // real recovery attempt before the canned fallback (which does render the synthesis, via
  // buildNaturalRecoveryResponse in ceo-degraded-mode.ts, but only after this loop is already exhausted).
  const recoveryDocumentComprehensionMessages: readonly { role: 'system'; content: string }[] = effectiveDocumentSynthesis
    ? [{ role: 'system' as const, content: (effectiveDocumentCoverage?.startsWith('Complete') ? 'AUTHORITATIVE HIERARCHICAL DOCUMENT COMPREHENSION' : 'PARTIAL HIERARCHICAL DOCUMENT COMPREHENSION') + ' (INTERNAL SOURCE MODEL):\nThe supplied source has been processed through bounded section analysis and reduction for ' + decisionPlan.executionContract.operation + '. The final answer path must use this bounded synthesis plus the authoritative user instruction; it must not retransmit or depend on the raw source document. Do not invent claims unsupported by the synthesis. If coverage is partial, explicitly preserve that limitation and do not state or imply that the entire source was reviewed.\n\n' + effectiveDocumentSynthesis + (effectiveDocumentCoverage ? '\n\nCoverage status: ' + effectiveDocumentCoverage : '') }]
    : []
  // Recommendation 1 (2026-09-20): reads the decision contract's own comprehensionMode (computed once
  // in buildConversationDecisionContract, alongside responseAction) when one is available, instead of
  // recomputing it here -- falls back to a local computation for the rare caller that supplies a
  // decisionContract without one (or none at all), matching this file's existing reuse-guard discipline.
  const recoveryComprehensionMode = request.decisionContract?.comprehensionMode ?? inferComprehensionMode({ responseAction: request.decisionContract?.responseAction, sourceLength: recoveryObjective.length })
  if (!skipRecoveryGeneration) for (const availability of availabilityCandidates) { try { const recovery = await runCanonicalLlm({ messages: [...recoveryLiveSystemMessages, ...recoveryEvidenceMessages, ...recoverySelfAssessmentFactsMessages, ...recoveryDocumentComprehensionMessages, ...selfAssessmentGuidanceMessages({ intent: decisionPlan.executionContract.intent, objective: recoveryObjective, priorConversation: request.priorConversation }), ...recoverySourceMessages], taskType: recoveryTaskType, verification: recoveryVerification, model: availability.model, temperature: request.temperature ?? 0.2, maxTokens: request.maxTokens ?? 4000, timeoutMs: Math.max(1000, Math.min(30000, (request.timeoutMs ?? decisionPlan.latencyBudgetMs) - (Date.now() - started))), maxProviderAttempts: 1, excludeProviders: PROVIDER_ORDER.filter((provider) => provider !== availability!.provider) }); const recoveryQuality = evaluateCeoQuality({ objective: recoveryObjective, content: sanitizeCeoContentForQualityGate(recovery.content), path: decisionPlan.path, intent: decisionPlan.executionContract.intent, reviewed: false, externalExecutionSucceeded: request.externalExecutionSucceeded ?? true, evidenceProvided: Boolean(request.contextualEvidence?.trim() || recoveredEvidenceContext?.trim() || ventureEvidence?.evidence), evidenceScope, evidenceFreshness, evidenceBundle: recoveredEvidenceBundle, priorTurns: request.priorConversation, relevantOlderMessages: request.relevantOlderConversation, resolvedReferences: request.canonicalContext?.references, responseAction: request.decisionContract?.responseAction, externalAgencyAvailable: decisionPlan.executionContract.orchestrationOwner === 'operational_orchestrator', comprehensionMode: recoveryComprehensionMode, structuralSourceModel: effectiveStructuralSourceModel }); const mergedAttempts = [...new Set([...attempts, availability.provider, ...recovery.attempts])]; if (!(recovery.content.trim() && recoveryQuality.decision === 'PASS')) console.log('[ceo-recovery-trace]', JSON.stringify({ recoveryAttempted: true, recoveryProvider: availability.provider, recoveryContentProduced: Boolean(recovery.content.trim()), recoveryQualityDecision: recoveryQuality.decision, recoveryFailureReason: recoveryQuality.failureReason })); if (recovery.content.trim() && recoveryQuality.decision === 'PASS') return { content: composeCeoResponse({ responseAction: request.decisionContract?.responseAction, content: recovery.content, evidenceState: recoveryQuality.evidenceState, quality: recoveryQuality, degraded: false }), provider: recovery.provider, model: recovery.model, responseMs: responseMsBeforeDegraded + (Date.now() - started), attempts: mergedAttempts, executionPlan, decisionPlan, quality: recoveryQuality, evidenceState: recoveryQuality.evidenceState, degraded: false, failureReason: recoveryQuality.failureReason, generation: { primaryOutputProduced: generationOverride?.primaryOutputProduced ?? false, primaryQualityDecision: generationOverride?.primaryQualityDecision ?? 'NOT_RUN', finalOutputProduced: Boolean(recovery.content.trim()), finalStage: generationOverride?.finalStage ?? 'primary', escalationCount: generationOverride?.escalationCount ?? 0 } } } catch (error) { if (isCeoRequestAborted(error)) throw error; console.log('[ceo-recovery-trace]', JSON.stringify({ recoveryAttemptFailed: true, provider: availability!.provider, error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300) })) } } throwIfCeoRequestAborted(getCeoCancellationSignal()); const degraded = await buildCeoDegradedResponse({ objective: recoveryObjective, intent: decisionPlan.executionContract.intent, responseAction: request.decisionContract?.responseAction, selfReflectionKind: decisionPlan.executionContract.selfReflectionKind, reason, failureReason, missionId: request.missionId, contextualEvidence: [request.contextualEvidence?.trim(), recoveredEvidenceContext?.trim()].filter(Boolean).join('\n\n') || undefined, recoveredExternalEvidence: Boolean(recoveredEvidenceContext), priorConversation: request.priorConversation, domain: decisionPlan.executionContract.domain, operation: decisionPlan.executionContract.operation, resolvedReferences: request.canonicalContext?.references, conversationState: request.canonicalContext?.state, partnerIntelligence: request.partnerIntelligence, executiveState: request.executiveState, leadershipLedger: request.leadershipLedger, strategicHorizon: request.strategicHorizon, documentComprehensionSynthesis: effectiveDocumentSynthesis, documentComprehensionCoverage: effectiveDocumentCoverage, unsupportedClaims: unsupportedClaims.length ? unsupportedClaims.map((claim) => ({ claim: claim.claim, reason: claim.reason })) : undefined }); throwIfCeoRequestAborted(getCeoCancellationSignal()); const responseMs = responseMsBeforeDegraded + (Date.now() - started); const quality = { decision: 'DEGRADED' as const, evidenceState: degraded.evidenceState, verificationStatus: 'NOT_PERFORMED' as const, checks: { nonEmpty: Boolean(degraded.content.trim()), contractValid: degraded.content.length <= 100_000, objectiveCoverage: false, internalConsistency: true, evidenceDiscipline: true, actionableStructure: true }, evidenceScope, evidenceFreshness, claimScopes: [], failureReason: degraded.failureReason, reasons: [reason, ...(degraded.sourceKeys.length ? [`Recovered ${degraded.sourceKeys.length} internal evidence item(s).`] : [])] }; return { content: composeCeoResponse({ responseAction: request.decisionContract?.responseAction, content: degraded.content, evidenceState: degraded.evidenceState, quality, degraded: true }), responseMs, attempts, executionPlan, decisionPlan, quality, evidenceState: degraded.evidenceState, degraded: true, failureReason: degraded.failureReason, generation: { primaryOutputProduced: generationOverride?.primaryOutputProduced ?? false, primaryQualityDecision: generationOverride?.primaryQualityDecision ?? 'NOT_RUN', finalOutputProduced: Boolean(degraded.content.trim()), finalStage: generationOverride?.finalStage ?? 'none', escalationCount: generationOverride?.escalationCount ?? 0 } } }

export async function runCeoCognitiveLifecycle(request: CeoCognitiveRequest): Promise<CognitiveLifecycleResult> {
  const preRoute = request.preRoute ?? preRouteCeoRequest(request.messages, request.attachmentsCount ?? 0); const resolved = resolvePreRoute(preRoute); const decisionPlan = request.decisionPlan ?? buildCeoDecisionPlan({ messages: request.messages, preRoute, missionId: request.missionId, taskType: request.taskType }); const executionPlan = buildCeoExecutionPlan(decisionPlan); const objective = preRoute.researchObjective?.currentObjective || decisionPlan.objective || objectiveFrom(request.messages); const startedAt = Date.now(); const externalExecutionSucceeded = request.externalExecutionSucceeded ?? true;
  // "Next architecture" program, Stage 2: same canonical lane route.ts already resolved from this
  // same preRoute (see resolveCeoLane's own comment) -- recomputed here rather than threaded as a
  // new request field, matching this function's existing pattern for `resolved` just above (also a
  // pure derivation of preRoute, recomputed locally instead of added to CeoCognitiveRequest).
  // Fresh-audit fix: must pass request.missionId, exactly like the decisionPlan build two lines
  // above already does -- otherwise this lane can disagree with decisionPlan's own lane-derived
  // reasoningStrategy override on a mission-tied call (mission-supervisor.ts's CEO-leader dispatch,
  // the mission-active owner-question route) whose message text doesn't happen to read as
  // mission_action, silently picking fast_chat's cheap/fast provider order for a 'critical' turn.
  const lane = resolveCeoLane(preRoute, request.missionId)
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
  const documentComprehension = await (async (): Promise<{ messages: { role: 'system'; content: string }[]; sourceModel?: StructuralSourceModel; synthesisAvailable: boolean; complete: boolean; synthesis?: string; coverage?: string; requestedOperation?: RequestedOperation }> => {
    try {
      const sourceMaterial = request.canonicalContext?.currentMessage ?? objective
      const fallbackInstruction = extractInstructionWindowDetails(sourceMaterial)
      const authoritativeInstruction = request.canonicalContext?.turnEnvelope?.instruction.authoritativeText ?? fallbackInstruction.authoritativeText ?? request.canonicalContext?.instruction ?? extractInstructionWindow(objective)
      const sourceMaterialPresent = request.canonicalContext?.turnEnvelope?.sourceMaterial.present ?? sourceMaterial.length > authoritativeInstruction.length
      const requestedOperation = request.canonicalContext?.turnEnvelope?.requestedOperation ?? inferRequestedOperation(authoritativeInstruction, false, sourceMaterialPresent)
      const trace = buildDocumentComprehensionTrace(sourceMaterial)
      if (!sourceMaterialPresent || !isDocumentOperation(requestedOperation) || !shouldExecuteHierarchicalComprehension(trace, requestedOperation)) return { messages: [], synthesisAvailable: false, complete: false }
      const remainingMs = deadline - Date.now()
      const timeBudgetMs = Math.min(30_000, Math.max(0, Math.floor(remainingMs * 0.4)))
      if (timeBudgetMs < 8_000) return { messages: [], synthesisAvailable: false, complete: false }
      const plan = buildHierarchicalComprehensionPlan(authoritativeInstruction, sourceMaterial, undefined, requestedOperation)
      const result = await executeHierarchicalComprehension(plan, { signal: getCeoCancellationSignal(), timeBudgetMs })
      if (!result.executed || !result.synthesis) return { messages: [], synthesisAvailable: false, complete: false }
      const coverageComplete = result.complete
      const coverage = coverageComplete
        ? `Complete source coverage: ${result.sectionsProcessed}/${trace.sectionCount} sections processed.`
        : `PARTIAL source coverage: ${result.sectionsProcessed}/${trace.sectionCount} sections processed; ${result.sectionsFailed} section(s) failed or were not processed. Do not claim the entire source was comprehended.${result.failureNotes.length ? ' ' + result.failureNotes.join(' ') : ''}`
      console.log('[ceo-hierarchical-comprehension]', JSON.stringify({ requestedOperation, sectionCount: trace.sectionCount, sectionsProcessed: result.sectionsProcessed, sectionsFailed: result.sectionsFailed, durationMs: result.durationMs, synthesisAvailable: true, coverageComplete }))
      const label = coverageComplete ? 'AUTHORITATIVE HIERARCHICAL DOCUMENT COMPREHENSION' : 'PARTIAL HIERARCHICAL DOCUMENT COMPREHENSION'
      const messages = [{ role: 'system' as const, content: label + ' (INTERNAL SOURCE MODEL):\nThe supplied source has been processed through bounded section analysis and reduction for ' + requestedOperation + '. The final answer path must use this bounded synthesis plus the authoritative user instruction; it must not retransmit or depend on the raw source document. Do not invent claims unsupported by the synthesis. If coverage is partial, explicitly preserve that limitation and do not state or imply that the entire source was reviewed.\n\n' + result.synthesis + '\n\nCoverage status: ' + coverage }]
      const sourceModel: StructuralSourceModel | undefined = result.sectionExtracts?.length ? { sectionCount: trace.sectionCount, sectionExtracts: result.sectionExtracts, synthesis: result.synthesis, coverageComplete } : undefined
      return { messages, sourceModel, synthesisAvailable: true, complete: coverageComplete, synthesis: result.synthesis, coverage, requestedOperation }
    } catch (error) {
      if (isCeoRequestAborted(error)) throw error
      return { messages: [], synthesisAvailable: false, complete: false }
    }
  })()
  const documentComprehensionMessages = documentComprehension.messages
  const structuralSourceModel = documentComprehension.sourceModel
  const fallbackInstruction = extractInstructionWindowDetails(request.canonicalContext?.currentMessage ?? objective)
  const authoritativeDocumentInstruction = request.canonicalContext?.turnEnvelope?.instruction.authoritativeText ?? fallbackInstruction.authoritativeText ?? request.canonicalContext?.instruction ?? extractInstructionWindow(objective)
  const degradedRequest: CeoCognitiveRequest = documentComprehension.synthesis
    ? { ...request, documentComprehensionSynthesis: documentComprehension.synthesis, documentComprehensionCoverage: documentComprehension.coverage, documentStructuralSourceModel: structuralSourceModel, documentRequestedOperation: documentComprehension.requestedOperation }
    : request
  const generationObjective = documentComprehension.synthesisAvailable ? authoritativeDocumentInstruction : objective
  const sourceForGeneration: readonly { role: 'system' | 'user' | 'assistant'; content: string }[] = documentComprehension.synthesisAvailable
    ? replaceCurrentUserMessage(request.messages, authoritativeDocumentInstruction)
    : request.messages
  // Self-repair follow-up (2026-09-26): assessDomainPredictionDrift/persistDomainConfidenceSignal
  // (ceo-outcome-learning.ts) aggregate this domain's own recommendation track record on a slow,
  // heartbeat-driven cadence (venture-operation-loop.ts) -- this is the hot-path read side, a single
  // keyed lookup (not the aggregation itself), gated to only the turns where a domain track record is
  // actually meaningful: a real, specific domain with a non-'none' evidence requirement (i.e. the same
  // population recordCeoRecommendation writes for). Purely advisory phrasing injected into the prompt,
  // never a pass/fail gate -- a domain with no signal yet (the common case, until real drift
  // accumulates) adds nothing here.
  const domainConfidenceMessages = await (async (): Promise<{ role: 'system'; content: string }[]> => {
    const domain = decisionPlan.executionContract.domain
    if (domain === 'none' || domain === 'unknown' || decisionPlan.executionContract.evidenceRequirement === 'none') return []
    try {
      const { getDomainConfidenceSignal } = await import('./ceo-outcome-learning')
      const signal = await getDomainConfidenceSignal(domain)
      if (!signal || signal.recommendedAdjustment === 'none') return []
      const missPercent = Math.round(signal.missRate * 100)
      const guidance = signal.recommendedAdjustment === 'force_escalation'
        ? `Recent recommendations in the '${domain}' domain have missed their predicted outcome ${missPercent}% of the time (${signal.sampleSize} sample(s)). Treat this domain with elevated scrutiny: require stronger evidence before a confident recommendation, and explicitly flag remaining uncertainty rather than presenting a confident call.`
        : `Recent recommendations in the '${domain}' domain have missed their predicted outcome ${missPercent}% of the time (${signal.sampleSize} sample(s)). Hedge confidence accordingly and avoid overstating certainty.`
      return [{ role: 'system' as const, content: `DOMAIN TRACK-RECORD SIGNAL (INTERNAL): ${guidance}` }]
    } catch {
      return []
    }
  })()
  const primaryMessages = [...worldModelMessages, ...guardianMessages, ...executiveStateMessages, ...liveSystemMessages, ...readinessMessages, ...documentComprehensionMessages, ...domainConfidenceMessages, ...selfAssessmentGuidanceMessages({ intent: decisionPlan.executionContract.intent, objective: generationObjective, priorConversation: request.priorConversation }), ...decisionMessages, ...sourceForGeneration]
  // Stage 2: every runCanonicalLlm call in this turn (primary, and the bounded in-place
  // escalation/repair calls a fast_chat turn can still make) prefers the fast_chat provider order
  // when this lane applies -- lane is resolved once above and stays true for the whole turn.
  const stageOptions = (overrides: Record<string, unknown> = {}) => ({ taskType: decisionPlan.executionContract.intent === 'self_assessment' ? 'reasoning' : (request.taskType ?? decisionPlan.taskClass ?? 'reasoning'), verification: selectedVerification, model: request.model, temperature: request.temperature, maxTokens: request.maxTokens, maxProviderAttempts: decisionPlan.maxProviderAttempts, timeoutMs: Math.max(1000, Math.min(60000, deadline - Date.now())), executionClass: resolved === 'fast' ? 'fast' as const : decisionPlan.path === 'critical' ? 'mission' as const : decisionPlan.path === 'full' ? 'deep' as const : 'standard' as const, ...(lane === 'fast_chat' ? { providerOrder: CEO_FAST_CHAT_PROVIDER_PRIORITY } : {}), ...overrides })
  let primary: CanonicalLlmResult | undefined; let review: CanonicalLlmResult | undefined; let final: CanonicalLlmResult | undefined; let escalation = 0; let primaryQuality: CognitiveLifecycleResult['quality'] | undefined; let finalStage: CeoGenerationDiagnostics['finalStage'] = 'primary'
  // Efficiency fix (2026-09-26): tryDegraded's resume-hierarchical-comprehension recovery step (see
  // isFutileStructuralCoverageEscalation's comment) only gets whatever wall-clock time is left AFTER
  // primary generation's own timeout -- computed fresh from `deadline - Date.now()`, capped at 60s -- has
  // already been spent, so a slow primary attempt routinely left less than resumeTimeBudgetMs's own
  // MIN_VIABLE_TIME_BUDGET_MS (8s) floor for the one recovery mechanism most likely to actually fix an
  // incomplete-coverage failure. Reserved only for the specific case that recovery step exists to handle
  // (Phase 3 document coverage genuinely incomplete): the primary generation call's own timeout is capped
  // to leave this floor available afterward, rather than letting it claim the entire remaining deadline
  // up front. Every other stage (escalation, semantic repair, refinement/review/synthesis) is unaffected --
  // this only shortens the one call that would otherwise be first in line to spend the whole budget.
  const documentCoverageIncomplete = structuralSourceModel !== undefined && structuralSourceModel.coverageComplete === false
  const RESERVED_RECOVERY_FLOOR_MS = 20_000
  try {
    const action = request.decisionContract?.responseAction
    if (action === 'clarify') { const clarificationMessages = request.canonicalContext?.turnEnvelope?.sourceMaterial.present ? [{ role: 'system' as const, content: 'SOURCE MATERIAL PRESENT: approximately ' + request.canonicalContext.turnEnvelope.sourceMaterial.length + ' characters were supplied. Do not reproduce or analyze the source in this clarification call.' }, { role: 'user' as const, content: 'AUTHORITATIVE USER INSTRUCTION:\n' + authoritativeDocumentInstruction }] : request.messages; primary = await runCanonicalLlm({ ...stageOptions({ maxProviderAttempts: 1, maxTokens: Math.min(request.maxTokens ?? 600, 600), executionClass: 'fast' as const }), messages: [...guardianMessages, ...decisionMessages, ...clarificationMessages, { role: 'user', content: 'Ask the minimum necessary natural clarification needed to resolve the user’s task requirements. Return only the clarification question.' }] }) }
    else { const primaryTimeoutOverride = documentCoverageIncomplete ? { timeoutMs: Math.max(1000, Math.min(60000, (deadline - RESERVED_RECOVERY_FLOOR_MS) - Date.now())) } : {}; primary = await runCanonicalLlm({ ...stageOptions(primaryTimeoutOverride), messages: primaryMessages }); if (executionPlan.reasoningStrategy === 'multi_pass') { try { const refinement = await runCanonicalLlm({ ...stageOptions({ maxProviderAttempts: 2 }), messages: [...primaryMessages, { role: 'assistant', content: primary.content }, buildRefinementPrompt(generationObjective, primary.content)], excludeProviders: stageExclusions(primary.provider) }); review = refinement; final = refinement; finalStage = 'refinement' } catch (error) { if (isCeoRequestAborted(error)) throw error } } else if (executionPlan.reasoningStrategy === 'independent_review') { try { review = await runCanonicalLlm({ ...stageOptions({ maxProviderAttempts: 2 }), messages: [...worldModelMessages, ...guardianMessages, ...executiveStateMessages, ...liveSystemMessages, ...readinessMessages, ...decisionMessages, { role: 'system', content: 'You are an independent verification reviewer for Agent007. Be skeptical, precise, and concise.' }, buildReviewPrompt(generationObjective, primary.content)], excludeProviders: stageExclusions(primary.provider) }); final = await runCanonicalLlm({ ...stageOptions({ maxProviderAttempts: 2 }), messages: [...worldModelMessages, ...guardianMessages, ...executiveStateMessages, ...liveSystemMessages, ...readinessMessages, ...decisionMessages, { role: 'system', content: 'You are the final executive synthesizer for Agent007. Use the draft and independent review to produce the strongest justified answer.' }, buildSynthesisPrompt(generationObjective, primary.content, review.content, ventureEvidence?.evidence, readinessSynthesis ? `Level ${readinessSynthesis.level} — ${readinessSynthesis.label}. ${readinessSynthesis.verified} ${readinessSynthesis.notProven}` : undefined)], excludeProviders: stageExclusions(review.provider) }); finalStage = 'synthesis' } catch (error) { if (isCeoRequestAborted(error)) throw error; review = undefined; final = undefined; finalStage = 'primary' } } }
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
    // Efficiency fix (2026-09-24): isFutileStructuralCoverageEscalation stops the loop immediately (rather
    // than spending an attempt) when incomplete Phase 3 document coverage is the SOLE reason for ESCALATE
    // -- see that function's own comment. quality is re-evaluated each iteration below, so this condition
    // is re-checked every pass, not just on entry.
    // Self-repair follow-up (2026-09-26): `escalation` used to increment unconditionally BEFORE the try,
    // so a transient provider-side error (rate limit, timeout, malformed output) during the escalation
    // call consumed a maxEscalations slot exactly like a genuine content-quality repair attempt would --
    // for a path with maxEscalations:1 (most "deep" turns), one provider hiccup permanently exhausted the
    // entire repair budget, guaranteeing fallthrough to tryDegraded even though the actual quality finding
    // was never once attempted. `escalation` now only increments after a call actually completes (whether
    // or not its content then passes the gate) so the budget tracks real repair attempts, not provider
    // flakiness. Provider-side errors instead consume their own small, separately-bounded retry allowance
    // (providerErrorAttempts) so a wall of provider failures still can't loop until the deadline.
    let providerErrorAttempts = 0
    const MAX_ESCALATION_PROVIDER_ERROR_RETRIES = 2
    while (quality.decision === 'ESCALATE' && escalation < decisionPlan.maxEscalations && Date.now() < deadline && !isFutileStructuralCoverageEscalation(quality)) { const lastProvider = final?.provider ?? review?.provider ?? primary?.provider; try { const escalated = await runCanonicalLlm({ ...stageOptions({ maxProviderAttempts: 2 }), messages: [...worldModelMessages, ...guardianMessages, ...executiveStateMessages, ...liveSystemMessages, ...readinessMessages, ...decisionMessages, { role: 'system', content: 'You are an escalation reviewer. Repair the response only where the quality gate found material issues. Do not invent evidence.' }, { role: 'user', content: `Objective:\n${generationObjective}\n\nCandidate:\n${output.content}\n\nQuality findings:\n${quality.reasons.join(' | ')}` }], excludeProviders: stageExclusions(lastProvider) }); escalation += 1; final = escalated; output = escalated; finalStage = 'escalation'; quality = evaluateCeoQuality({ objective: generationObjective, content: sanitizeCeoContentForQualityGate(escalated.content), path: decisionPlan.path, intent: decisionPlan.executionContract.intent, reviewed: true, externalExecutionSucceeded, evidenceProvided, evidenceScope, evidenceFreshness, evidenceBundle: request.evidenceBundle, priorTurns: request.priorConversation, relevantOlderMessages: request.relevantOlderConversation, resolvedReferences: request.canonicalContext?.references, responseAction: request.decisionContract?.responseAction, externalAgencyAvailable, comprehensionMode, structuralSourceModel }); if (quality.decision === 'PASS') break } catch (error) { if (isCeoRequestAborted(error)) throw error; providerErrorAttempts += 1; if (providerErrorAttempts >= MAX_ESCALATION_PROVIDER_ERROR_RETRIES) break } }
    const result0 = final ?? primary
    if (!result0) return tryDegraded(degradedRequest, 'Provider execution exhausted before a final answer was available.', mergeAttempts(primary, review, final), Date.now() - startedAt, decisionPlan, executionPlan, false, [], 'provider_unavailable', { primaryOutputProduced: Boolean(primary?.content.trim()), primaryQualityDecision: primaryQuality?.decision ?? 'NOT_RUN', finalOutputProduced: false, finalStage: 'none', escalationCount: escalation }, ventureEvidence, ventureEvidenceFreshness)
    let result = result0; let semanticRepairApplied = false
    // Self-repair follow-up (2026-09-26): request.decisionContract.intent is typed
    // CanonicalConversationContext['intentHint'] (ceo-conversation-decision-contract.ts), whose real
    // values are 'conversation' | 'self_assessment' | 'analysis' | 'decision' | 'research' | 'action' |
    // 'unknown' -- 'opinion' is a CeoIntent-only value from a different code path (ceo-pre-router.ts) that
    // this specific field can never carry, so it was always dead here. Meanwhile 'research' -- a real,
    // common value for exactly the kind of turn most likely to trip a source-contradiction finding
    // ("research this filing and verify the numbers") -- was missing, so those turns skipped the
    // structured semantic-repair mechanism entirely (including the contradiction-repair routing above)
    // and fell back to the escalation loop's unstructured raw-reason-dump prompt instead. Do not confuse
    // this with the DIFFERENT `isConversational` array a few lines below, which tests
    // `authoritativeIntent ?? decisionPlan.executionContract.intent` -- that fallback value IS of type
    // CeoIntent and genuinely can be 'opinion', so that array is correct as-is and must not be merged with
    // this one.
    if (request.decisionContract && quality.decision !== 'PASS' && ['conversation', 'decision', 'analysis', 'research'].includes(request.decisionContract.intent) && Date.now() < deadline) { const report = buildSemanticQualityReport({ quality, conversationQuality: quality.conversationQuality, contract: request.decisionContract, content: result.content }); if (report.decision === 'REPAIR') { const plan = buildSemanticRepairPlan(report); try { const repaired = await runCanonicalLlm({ ...stageOptions({ maxProviderAttempts: 2 }), messages: [...primaryMessages, { role: 'assistant', content: result.content }, renderSemanticRepairPrompt(generationObjective, result.content, plan)], excludeProviders: stageExclusions(result.provider) }); const repairedQuality = evaluateCeoQuality({ objective: generationObjective, content: sanitizeCeoContentForQualityGate(repaired.content), path: decisionPlan.path, intent: decisionPlan.executionContract.intent, reviewed: true, externalExecutionSucceeded, evidenceProvided, evidenceScope, evidenceFreshness, evidenceBundle: request.evidenceBundle, priorTurns: request.priorConversation, relevantOlderMessages: request.relevantOlderConversation, resolvedReferences: request.canonicalContext?.references, responseAction: request.decisionContract?.responseAction, externalAgencyAvailable, comprehensionMode, structuralSourceModel }); const repairedReport = buildSemanticQualityReport({ quality: repairedQuality, conversationQuality: repairedQuality.conversationQuality, contract: request.decisionContract, content: repaired.content }); console.log('[ceo-semantic-repair]', JSON.stringify({ failedDimensions: report.failedDimensions, repairPriority: report.repairPriority, beforeDecision: report.decision, afterDecision: repairedReport.decision })); if (repairedReport.decision !== 'DEGRADE' && (repairedReport.failedDimensions.length < report.failedDimensions.length || repairedReport.contractSatisfied)) { result = repaired; final = repaired; quality = repairedQuality; semanticRepairApplied = true; finalStage = 'semantic_repair' } } catch (error) { if (isCeoRequestAborted(error)) throw error } } }
    const authoritativeIntent = request.decisionContract?.intent; const isConversational = ['conversation', 'opinion', 'decision', 'analysis'].includes(authoritativeIntent ?? decisionPlan.executionContract.intent); const isGenuineOverclaim = quality.failureReason === 'evidence_unavailable' || quality.failureReason === 'evidence_insufficient' || quality.failureReason === 'claim_consistency_failure' || quality.failureReason === 'false_completion_claim' || quality.failureReason === 'internal_artifact_leak'; const conversationQuality = quality.conversationQuality; const softPassCandidate = isConversational && !isGenuineOverclaim && (conversationQuality?.score ?? 0) >= 60;
    // Efficiency fix (2026-09-26): semanticSubstanceCheck and semanticContinuityCheck are two independent
    // judge round-trips -- neither reads the other's result, both only depend on values already known
    // above -- but used to run as two sequential `await`s, paying two full provider round-trips back to
    // back on the (fairly common) soft-pass-candidate-with-continuity_failure path. Promise.all runs them
    // concurrently instead; each branch's own condition (and its safe default when the condition is
    // false) is preserved exactly, so this changes latency only, not which check runs or what it decides.
    const [semanticCheck, semanticContinuity] = await Promise.all([
      (quality.decision !== 'PASS' && softPassCandidate) ? semanticSubstanceCheck(generationObjective, result.content) : Promise.resolve({ substantive: true, checked: false }),
      (quality.decision !== 'PASS' && softPassCandidate && quality.failureReason === 'continuity_failure') ? semanticContinuityCheck(generationObjective, request.priorConversation ?? [], result.content, request.relevantOlderConversation ?? []) : Promise.resolve({ coherent: false, checked: false }),
    ]); const softPassEligible = isGovernedSoftPassEligible({ intent: decisionPlan.executionContract.intent, authoritativeIntent, qualityDecision: quality.decision, failureReason: quality.failureReason, conversationScore: conversationQuality?.score, substantive: semanticCheck.checked && semanticCheck.substantive, semanticContinuityConfirmed: semanticContinuity.coherent }); // Self-repair follow-up (2026-09-25): the same futile-coverage condition that stops the escalation
// loop above from wasting an attempt also tells tryDegraded whether its own recovery-generation loop
// would be equally futile -- see isFutileStructuralCoverageEscalation's comment and tryDegraded's own
// recoveryGenerationFutile handling for why a bare regeneration can never pass this specific gate.
if (quality.decision !== 'PASS' && !softPassEligible) return tryDegraded(degradedRequest, `Quality gate did not pass after the allowed escalation depth: ${quality.reasons.join(' | ')}`, mergeAttempts(primary, review, final), Date.now() - startedAt, decisionPlan, executionPlan, false, [], quality.failureReason, { primaryOutputProduced: Boolean(primary?.content.trim()), primaryQualityDecision: primaryQuality?.decision ?? 'NOT_RUN', finalOutputProduced: Boolean(result.content.trim()), finalStage, escalationCount: escalation }, ventureEvidence, ventureEvidenceFreshness, isFutileStructuralCoverageEscalation(quality), result.content, quality.claimVerification); if (quality.decision !== 'PASS' && softPassEligible) console.log('[ceo-soft-pass]', JSON.stringify({ intent: decisionPlan.executionContract.intent, failureReason: quality.failureReason, contentLength: result.content.length, conversationQualityScore: conversationQuality?.score, semanticChecked: semanticCheck.checked, semanticContinuityChecked: semanticContinuity.checked, semanticContinuityConfirmed: semanticContinuity.coherent })); const evidenceState: EvidenceState = quality.evidenceState; console.log('[ceo-runtime-trace]', JSON.stringify({ intent: decisionPlan.executionContract.intent, path: decisionPlan.path, responseAction: request.decisionContract?.responseAction ?? null, provider: result.provider, model: result.model, contentLength: result.content.length, qualityDecision: quality.decision, evidenceState, responseMs: Date.now() - startedAt, degraded: false })); return { content: composeCeoResponse({ responseAction: request.decisionContract?.responseAction, content: result.content, evidenceState, quality, degraded: false }), provider: result.provider, model: result.model, responseMs: Date.now() - startedAt, attempts: mergeAttempts(primary, review, final), executionPlan, decisionPlan, quality, evidenceState, degraded: false, failureReason: quality.failureReason, generation: { primaryOutputProduced: Boolean(primary?.content.trim()), primaryQualityDecision: primaryQuality?.decision ?? 'NOT_RUN', finalOutputProduced: Boolean(result.content.trim()), finalStage: semanticRepairApplied ? 'semantic_repair' : finalStage, escalationCount: escalation } }
  } catch (error) { if (isCeoRequestAborted(error)) throw error; const { taskType: recoveryTaskType, verification: recoveryVerification } = recoveryTaskContext(request, decisionPlan); const availability = await attemptValidatedReasoningProvider(Math.max(2500, deadline - Date.now()), recoveryTaskType, recoveryVerification); // "Next architecture" program, Stage 4: prefer the provider layer's own precise classification
        // (attached to runGovernedProviderChat's final aggregate throw -- see its own comment) over
        // regex-guessing on the message; the timeout-phrasing check stays as the fallback for any
        // other error shape (an abort, a non-provider throw) that never carried a structured kind.
        const failureReason: CeoFailureReason = error instanceof ProviderControlPlaneError ? mapProviderErrorKindToCeoFailureReason(error.kind) : (error instanceof Error && /timeout|timed out/i.test(error.message) ? 'execution_timeout' : 'provider_error'); logCeoDegradedTrace({ objective, intent: decisionPlan.executionContract.intent, path: decisionPlan.path, failureReason, attempts: mergeAttempts(primary, review, final), rawContentLength: (final ?? primary)?.content.length }); return tryDegraded(degradedRequest, error instanceof Error ? error.message.slice(0, 500) : 'All governed external execution paths failed.', mergeAttempts(primary, review, final), Date.now() - startedAt, decisionPlan, executionPlan, true, availability, failureReason, { primaryOutputProduced: Boolean(primary?.content.trim()), primaryQualityDecision: primaryQuality?.decision ?? 'NOT_RUN', finalOutputProduced: Boolean((final ?? primary)?.content?.trim()), finalStage, escalationCount: escalation }, ventureEvidence, ventureEvidenceFreshness) }
}