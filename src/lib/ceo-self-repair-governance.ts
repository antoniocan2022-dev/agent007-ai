/**
 * Risk tiering for the governed self-repair pipeline (ceo-self-repair-engine.ts).
 *
 * Full autonomy (auto-approve, no human review) is safe only for a narrow class of corrections:
 * conversational-understanding classification with zero financial/security/regulatory content and no
 * side-effecting action. Everything else -- any CRITICAL_HIGH_RISK_DOMAINS content
 * (architecture-integrity-contract.ts: public_equity, security, regulatory, business_due_diligence,
 * internal_finance), any side-effecting or research/analysis/decision category, or anything this
 * module has never classified before -- defaults to requiring human approval before it can take effect.
 * This mirrors the exact "fail closed when uncertain" principle already enforced in
 * ceo-decision-grade-evidence.ts, ceo-claim-evidence-gate.ts, and ceo-degraded-mode.ts: research is an
 * earned exemption for a positively-identified safe category, never the default for an unrecognized one.
 */
import { CRITICAL_HIGH_RISK_DOMAINS } from './architecture-integrity-contract'
import type { IncidentCandidateInputClass } from './ceo-incident-regression-candidate'

export type SelfRepairRiskTier = 'low' | 'high'

// Deliberately an allowlist, not a denylist. 'strategic_question', 'explanation_request', and
// 'action_request' are excluded on purpose: a strategic or explanatory question can carry business/
// financial substance the classifier alone cannot rule out, and an action request is by definition
// side-effecting -- none of the three belong in a fully-autonomous correction path.
const LOW_RISK_INPUT_CLASSES: ReadonlySet<IncidentCandidateInputClass> = new Set([
  'confusion',
  'typo_tolerance',
  'incomplete_message',
  'reference',
  'continuation',
  'self_assessment',
])

export function classifySelfRepairRiskTier(input: { domain?: string; inputClass: IncidentCandidateInputClass }): SelfRepairRiskTier {
  const domain = input.domain?.trim().toLowerCase()
  if (domain && CRITICAL_HIGH_RISK_DOMAINS.has(domain)) return 'high'
  if (!LOW_RISK_INPUT_CLASSES.has(input.inputClass)) return 'high'
  return 'low'
}
