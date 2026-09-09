import type { CeoIntent } from './ceo-cognitive-contract'
import type { SemanticIntentHint } from './ceo-cognitive-conversation'

export interface SoftPassPolicyInput {
  intent: CeoIntent
  authoritativeIntent?: SemanticIntentHint
  qualityDecision: 'PASS' | 'ESCALATE' | 'DEGRADED'
  failureReason?: string
  conversationScore?: number
  substantive: boolean
  // A real LLM judgment (see semanticContinuityCheck in ceo-cognitive-lifecycle.ts) that the response
  // genuinely stays coherent with the conversation, not another lexical proxy. Only ever consulted for
  // the one forbidden reason it can rescue -- see OVERRIDABLE_FORBIDDEN_FAILURE below.
  semanticContinuityConfirmed?: boolean
}

// Deep-audit finding: false_completion_claim and internal_artifact_leak used to be indistinguishable from
// an ordinary phrasing miss (both collapsed into the generic 'quality_failure' reason, which was never on
// this list) -- verified directly with a real probe that isGovernedSoftPassEligible returned true for a
// confident false completion claim and for a leaked internal artifact, given a high enough
// conversationScore and a semanticSubstanceCheck verdict of SUBSTANTIVE (a confident false claim reads as
// specific, not shallow). Their own distinct reasons (ceo-response-quality-gate.ts) let them be named here
// and permanently forbidden, like the factual/evidentiary reasons below -- never overridable, not even by
// the continuity tie-breaker.
const FORBIDDEN_FAILURES = new Set(['evidence_unavailable', 'evidence_insufficient', 'claim_consistency_failure', 'continuity_failure', 'false_completion_claim', 'internal_artifact_leak'])
const ALLOWED_INTENTS = new Set(['conversation', 'opinion', 'decision', 'analysis'])
// continuity_failure is the one forbidden reason that can be overridden, and only by a real semantic
// judgment call, not another heuristic. The lexical continuity signals that produce it
// (staleResponseLikelihood/scoreContextContinuity in ceo-response-quality-gate.ts) are bag-of-words
// token-overlap scores -- proven, via a real production incident, to false-positive on a response that is
// actually coherent (a restatement request scored "stale" because a correct paraphrase necessarily
// overlaps with what it's paraphrasing; fixed at the lexical layer separately, but the heuristic class
// remains structurally limited to that one shape of false positive, not every shape). The other three
// forbidden reasons -- evidence_unavailable/evidence_insufficient/claim_consistency_failure -- are about
// factual/evidentiary integrity, not conversational coherence, and must never be overridable this way: a
// semantically fluent, internally coherent response can still be confidently wrong or unverified.
const OVERRIDABLE_FORBIDDEN_FAILURE = 'continuity_failure'

export function isGovernedSoftPassEligible(input: SoftPassPolicyInput): boolean {
  if (input.qualityDecision === 'PASS') return false
  // Prefer the canonical decision contract's intent when available -- this is the one Phase 1-3
  // was meant to make authoritative. Falling back to the older pre-router's intent only when no
  // canonical contract was supplied keeps existing callers working exactly as before.
  const effectiveIntent = input.authoritativeIntent ?? input.intent
  if (!ALLOWED_INTENTS.has(effectiveIntent)) return false
  const failureOverridden = input.failureReason === OVERRIDABLE_FORBIDDEN_FAILURE && input.semanticContinuityConfirmed === true
  if (input.failureReason && FORBIDDEN_FAILURES.has(input.failureReason) && !failureOverridden) return false
  if ((input.conversationScore ?? 0) < 75) return false
  return input.substantive === true
}

export const SOFT_PASS_POLICY = Object.freeze({
  allowedIntents: [...ALLOWED_INTENTS] as readonly string[],
  minimumConversationScore: 75,
  requiresSemanticSubstanceCheck: true,
  forbiddenFailureReasons: [...FORBIDDEN_FAILURES],
})
