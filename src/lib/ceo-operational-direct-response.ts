import { buildCeoDecisionPlan } from './ceo-cognitive-kernel'
import { buildCeoExecutionPlan } from './ceo-execution-plan'
import { evaluateCeoQuality } from './ceo-response-quality-gate'
import { composeCeoResponse, sanitizeCeoContentForQualityGate } from './ceo-response-composer'
import { isKnownActionTool } from './tool-action-verification'
import type { CognitiveLifecycleResult, DecisionPlan, PreRouteDecision, ResponseAction } from './ceo-cognitive-contract'
import type { TaskType } from './subagent-governance'
import type { PersistedConversationRow } from './ceo-context-composer'

// Stage 1b of the CEO Conversation Kernel migration (2026-09-18): route.ts's operational_orchestrator
// branch used to unconditionally run the full CEO pipeline a SECOND time -- compose context again,
// call runCeoCognitiveLifecycle again -- to "synthesize" a final answer on top of what
// runOrchestrator() already produced (and had already persisted to the database itself). That's a
// full extra decide+generate+quality-gate pass on every single action request, discarding an answer
// that may well have already been correct.
//
// This function is the safer alternative Stage 1a's investigation concluded route.ts needed: verify
// the orchestrator's own answer against the SAME quality gate every other CEO response path already
// goes through, using the SAME buildCeoDecisionPlan/buildCeoExecutionPlan/evaluateCeoQuality/
// composeCeoResponse building blocks runCeoCognitiveLifecycle itself uses internally -- so a PASS
// here returns a CognitiveLifecycleResult in the exact same shape every downstream consumer
// (persistence, the SSE payload, world-state tracking, recommendation capture) already expects,
// with no adapter object to get subtly wrong. Returns null on anything short of PASS, so the caller
// can fall back to the existing full-synthesis path exactly as before -- this function only ever
// SKIPS a redundant regeneration; it never removes the safety net.
//
// Deliberately does NOT touch ceo-cognitive-lifecycle.ts's own primary-generation code path (used
// by every intent, not just operational ones) -- that's the highest-blast-radius part of the
// pipeline, and Stage 1a's investigation specifically flagged it as needing its own careful,
// separately-reviewed change rather than a same-day addition alongside this one.
export function tryOperationalDirectResponse(input: {
  messages: readonly { role: 'system' | 'user' | 'assistant'; content: string }[]
  preRoute: PreRouteDecision
  missionId?: string
  taskType?: TaskType
  // Phase 2 fix (external audit, 2026-09-19), issues 1 and 8: optional so this function keeps building
  // its own decisionPlan for any caller/test that doesn't have one yet, but route.ts now builds
  // CeoTurnDecision exactly once per turn (ceo-turn-decision.ts) and passes its decisionPlan here --
  // guaranteeing buildCeoDecisionPlan runs at most once per turn structurally, not just because Stage
  // 1b's branching happens to make this function and runCeoCognitiveLifecycle mutually exclusive.
  decisionPlan?: DecisionPlan
  objective: string
  candidateContent: string
  responseMsBeforeCheck: number
  // Fresh-audit finding (2026-09-18): the ToolResult shape orchestrator.ts's own steps carry
  // already has an `ok: boolean` per tool call -- this function was unconditionally claiming
  // externalExecutionSucceeded: true regardless of it, so an orchestrator answer that confidently
  // narrates success despite a real tool failure underneath would sail through the direct-pass
  // gate instead of falling back to a full synthesis pass that could honestly account for the
  // failure. Required (not optional) so no call site can silently skip this check.
  //
  // Stage 4 addition: `toolName`/`verification` let this function distinguish a merely-successful
  // (ok: true) action-tool call from a genuinely CONFIRMED one -- see hasVerifiedActionEvidence below.
  toolSteps: readonly { toolName?: string; toolResult?: { ok: boolean }; verification?: { verified: boolean } }[]
  priorConversation?: readonly PersistedConversationRow[]
  relevantOlderConversation?: readonly PersistedConversationRow[]
  responseAction?: ResponseAction
}): CognitiveLifecycleResult | null {
  const candidate = input.candidateContent.trim()
  if (!candidate) return null

  const anyToolStepFailed = input.toolSteps.some((step) => step.toolResult && step.toolResult.ok === false)

  const decisionPlan = input.decisionPlan ?? buildCeoDecisionPlan({ messages: input.messages, preRoute: input.preRoute, missionId: input.missionId, taskType: input.taskType })
  const executionPlan = buildCeoExecutionPlan(decisionPlan)

  const sanitized = sanitizeCeoContentForQualityGate(candidate)
  const quality = evaluateCeoQuality({
    objective: input.objective,
    content: sanitized,
    path: decisionPlan.path,
    intent: decisionPlan.executionContract.intent,
    reviewed: false,
    externalExecutionSucceeded: !anyToolStepFailed,
    evidenceProvided: true,
    // 'live_system', not 'internal_state': orchestrator.ts's tool loop dispatches real actions
    // against live external systems (GitHub, Vercel, email, ...), not just internal-state reads.
    // Verified directly against evaluateCeoQuality's evidenceOk check: a candidate whose own
    // wording reads as a live-system claim (the common case for "I checked/fixed X") is correctly
    // rejected when the declared scope doesn't match what the claim asserts -- this scope is what
    // makes a genuine, accurately-described completed action pass that check instead of always
    // failing it on a scope mismatch.
    evidenceScope: 'live_system',
    evidenceFreshness: { observedAt: Date.now(), maxAgeMs: 300000 },
    priorTurns: input.priorConversation,
    relevantOlderMessages: input.relevantOlderConversation,
    responseAction: input.responseAction,
    externalAgencyAvailable: true,
  })
  if (quality.decision !== 'PASS') return null

  // Fresh-audit finding (2026-09-18, same day as Stage 1b shipped): evaluateCeoQuality derives
  // 'LIVE_VERIFIED' from nothing more than (passed && evidenceScope is live_system/mixed && fresh)
  // -- there's no separate signal distinguishing a genuinely independently-verified claim from one
  // that merely satisfied the scope-consistency check. 'live_system' was chosen above specifically
  // to make evidenceDiscipline pass for a candidate whose own wording asserts a live-system action
  // (the common, honest case for "I checked/fixed X") -- but by itself this function never
  // independently verifies anything; it only checks that the orchestrator's self-reported answer is
  // internally consistent and well-formed. Stage 1b downgraded every PASS to 'LIVE_EXECUTED'
  // unconditionally rather than overclaim.
  //
  // Stage 4 of the CEO Conversation Kernel migration (2026-09-18): closes that gap for real, using a
  // signal that already existed but was going nowhere -- UPGRADE #124's verifyToolAction runs on
  // every orchestrator tool call and checks the result for an actual artifact (a URL, transaction id,
  // message id, file path, or an explicit "REAL" marker), not just a bare `ok: true`; orchestrator.ts
  // now persists it onto each step (see OrchestratorRunResult.steps[].verification), but until this
  // change nothing outside the SSE UI badge ever read it.
  //
  // Phase 2 fix (external audit, 2026-09-19), issue 4: this used to be a bare `.some()` over all
  // toolSteps -- true the moment ONE action-tool call was verified, regardless of how many OTHER
  // action-tool calls the same turn made. For a multi-step execution objective ("post to WordPress and
  // notify the team on Slack") that meant a single confirmed step could carry a LIVE_VERIFIED label for
  // the whole turn even if a sibling action-tool call in the same turn never got confirmed. Real tool
  // FAILURES were already caught upstream (anyToolStepFailed above forces evidenceState to UNAVAILABLE
  // regardless of this flag -- see evaluateCeoQuality's own evidenceState derivation), but a step that
  // merely succeeded (`ok: true`) without ever producing a confirmable artifact was not a failure, so it
  // slipped past that check and was still silently ignored by `.some()`. actionSteps below is every step
  // that called a tool isKnownActionTool recognizes as outcome-producing (payment processors,
  // publishers, senders -- read/research tools like http_fetch/web_search never qualify, see issue 5's
  // fix in tool-action-verification.ts); hasVerifiedActionEvidence now requires ALL of them to be both
  // successful and independently verified, not just one. A turn with zero action-tool calls still
  // correctly evaluates to false (there is nothing to have verified), same as before.
  const actionSteps = input.toolSteps.filter((step) => step.toolName && isKnownActionTool(step.toolName))
  const hasVerifiedActionEvidence = actionSteps.length > 0 && actionSteps.every((step) => step.toolResult?.ok === true && step.verification?.verified === true)
  if (quality.evidenceState === 'LIVE_VERIFIED' && !hasVerifiedActionEvidence) quality.evidenceState = 'LIVE_EXECUTED'

  const finalContent = composeCeoResponse({ content: sanitized, evidenceState: quality.evidenceState, quality, degraded: false, responseAction: input.responseAction })

  return {
    content: finalContent,
    provider: 'operational_orchestrator',
    model: 'orchestrator-direct',
    responseMs: input.responseMsBeforeCheck,
    attempts: ['operational_orchestrator'],
    executionPlan,
    decisionPlan,
    quality,
    evidenceState: quality.evidenceState,
    degraded: false,
    failureReason: quality.failureReason,
    generation: { primaryOutputProduced: true, primaryQualityDecision: 'PASS', finalOutputProduced: true, finalStage: 'primary', escalationCount: 0 },
  }
}
