import type { CeoIntent } from './ceo-cognitive-contract'
import type { SemanticIntentHint } from './ceo-cognitive-conversation'

export interface SoftPassPolicyInput {
  intent: CeoIntent
  authoritativeIntent?: SemanticIntentHint
  qualityDecision: 'PASS' | 'ESCALATE' | 'DEGRADED'
  failureReason?: string
  conversationScore?: number
  substantive: boolean
}

const FORBIDDEN_FAILURES = new Set(['evidence_unavailable', 'evidence_insufficient', 'claim_consistency_failure', 'continuity_failure'])
const ALLOWED_INTENTS = new Set(['conversation', 'opinion', 'decision', 'analysis'])

export function isGovernedSoftPassEligible(input: SoftPassPolicyInput): boolean {
  if (input.qualityDecision === 'PASS') return false
  // Prefer the canonical decision contract's intent when available -- this is the one Phase 1-3
  // was meant to make authoritative. Falling back to the older pre-router's intent only when no
  // canonical contract was supplied keeps existing callers working exactly as before.
  const effectiveIntent = input.authoritativeIntent ?? input.intent
  if (!ALLOWED_INTENTS.has(effectiveIntent)) return false
  if (input.failureReason && FORBIDDEN_FAILURES.has(input.failureReason)) return false
  if ((input.conversationScore ?? 0) < 75) return false
  return input.substantive === true
}

export const SOFT_PASS_POLICY = Object.freeze({
  allowedIntents: [...ALLOWED_INTENTS] as readonly string[],
  minimumConversationScore: 75,
  requiresSemanticSubstanceCheck: true,
  forbiddenFailureReasons: [...FORBIDDEN_FAILURES],
})
