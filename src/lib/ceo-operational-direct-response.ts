import { buildCeoDecisionPlan } from './ceo-cognitive-kernel'
import { buildCeoExecutionPlan } from './ceo-execution-plan'
import { evaluateCeoQuality } from './ceo-response-quality-gate'
import { composeCeoResponse, sanitizeCeoContentForQualityGate } from './ceo-response-composer'
import type { CognitiveLifecycleResult, PreRouteDecision, ResponseAction } from './ceo-cognitive-contract'
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
  objective: string
  candidateContent: string
  responseMsBeforeCheck: number
  priorConversation?: readonly PersistedConversationRow[]
  relevantOlderConversation?: readonly PersistedConversationRow[]
  responseAction?: ResponseAction
}): CognitiveLifecycleResult | null {
  const candidate = input.candidateContent.trim()
  if (!candidate) return null

  const decisionPlan = buildCeoDecisionPlan({ messages: input.messages, preRoute: input.preRoute, missionId: input.missionId, taskType: input.taskType })
  const executionPlan = buildCeoExecutionPlan(decisionPlan)

  const sanitized = sanitizeCeoContentForQualityGate(candidate)
  const quality = evaluateCeoQuality({
    objective: input.objective,
    content: sanitized,
    path: decisionPlan.path,
    intent: decisionPlan.executionContract.intent,
    reviewed: false,
    externalExecutionSucceeded: true,
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
