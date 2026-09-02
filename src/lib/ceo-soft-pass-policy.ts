import type { CeoIntent } from './ceo-cognitive-contract'

export interface SoftPassPolicyInput {
  intent: CeoIntent
  qualityDecision: 'PASS' | 'ESCALATE' | 'DEGRADED'
  failureReason?: string
  conversationScore?: number
  substantive: boolean
}

const FORBIDDEN_FAILURES = new Set(['evidence_unavailable', 'evidence_insufficient', 'claim_consistency_failure', 'continuity_failure'])

export function isGovernedSoftPassEligible(input: SoftPassPolicyInput): boolean {
  if (input.qualityDecision === 'PASS') return false
  if (input.intent !== 'conversation' && input.intent !== 'opinion') return false
  if (input.failureReason && FORBIDDEN_FAILURES.has(input.failureReason)) return false
  if ((input.conversationScore ?? 0) < 75) return false
  return input.substantive === true
}

export const SOFT_PASS_POLICY = Object.freeze({
  allowedIntents: ['conversation', 'opinion'] as readonly CeoIntent[],
  minimumConversationScore: 75,
  requiresSemanticSubstanceCheck: true,
  forbiddenFailureReasons: [...FORBIDDEN_FAILURES],
})
