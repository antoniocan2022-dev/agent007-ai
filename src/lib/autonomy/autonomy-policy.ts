/**
 * Agent007 Autonomy Governor — policy primitives.
 *
 * This module does not execute actions. It classifies an action request so the
 * orchestrator can make an explicit, auditable authority decision before
 * execution. The final authorization boundary must remain server-side and must
 * not be inferred solely from an LLM response.
 */

export const AUTONOMY_LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4'] as const
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number]

export const AUTHORITY_CLASSES = [
  'AUTONOMOUS_SAFE',
  'AUTONOMOUS_BOUNDED',
  'HUMAN_APPROVAL',
  'HUMAN_EXECUTION',
  'FORBIDDEN',
] as const
export type AuthorityClass = (typeof AUTHORITY_CLASSES)[number]

export type ActionCategory =
  | 'read'
  | 'write'
  | 'communication'
  | 'financial'
  | 'security'
  | 'deployment'
  | 'data_destructive'
  | 'external_irreversible'

export interface AutonomyActionRequest {
  category: ActionCategory
  estimatedCost?: number
  currency?: string
  reversible: boolean
  externalSideEffect: boolean
  affectsProduction: boolean
  affectsSecurity: boolean
  affectsFinancialState: boolean
  containsPersonalData: boolean
  policyApproved: boolean
  confidence: number
}

export interface AutonomyPolicyLimits {
  /** Maximum autonomous spend for a single action. */
  autonomousSpendLimit: number
  /** Confidence required for autonomous bounded actions. */
  minimumConfidence: number
  /** Actions that are always forbidden to autonomous execution. */
  forbiddenCategories: ReadonlySet<ActionCategory>
}

export interface AutonomyPolicyDecision {
  authority: AuthorityClass
  autonomous: boolean
  reason: string
  requiresOwnerApproval: boolean
}

const DEFAULT_LIMITS: AutonomyPolicyLimits = {
  autonomousSpendLimit: 25,
  minimumConfidence: 0.9,
  forbiddenCategories: new Set<ActionCategory>(['data_destructive']),
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))

/**
 * Resolve authority conservatively.
 *
 * Important design rule: uncertainty escalates authority requirements; it never
 * silently expands autonomy. An LLM cannot override this classification.
 */
export function classifyAutonomyAction(
  request: AutonomyActionRequest,
  limits: AutonomyPolicyLimits = DEFAULT_LIMITS,
): AutonomyPolicyDecision {
  const confidence = clamp01(request.confidence)

  if (limits.forbiddenCategories.has(request.category)) {
    return {
      authority: 'FORBIDDEN',
      autonomous: false,
      reason: 'Action category is forbidden for autonomous execution.',
      requiresOwnerApproval: false,
    }
  }

  if (!request.policyApproved) {
    return {
      authority: 'HUMAN_APPROVAL',
      autonomous: false,
      reason: 'No applicable policy has approved this action.',
      requiresOwnerApproval: true,
    }
  }

  if (request.affectsSecurity || request.affectsProduction) {
    return {
      authority: 'HUMAN_APPROVAL',
      autonomous: false,
      reason: 'Security or production state requires explicit owner authorization.',
      requiresOwnerApproval: true,
    }
  }

  if (request.category === 'external_irreversible' || (!request.reversible && request.externalSideEffect)) {
    return {
      authority: 'HUMAN_APPROVAL',
      autonomous: false,
      reason: 'Irreversible external side effect requires explicit approval.',
      requiresOwnerApproval: true,
    }
  }

  if (request.affectsFinancialState) {
    const cost = Math.max(0, request.estimatedCost ?? 0)
    if (cost > limits.autonomousSpendLimit) {
      return {
        authority: 'HUMAN_APPROVAL',
        autonomous: false,
        reason: `Financial action exceeds autonomous spend limit of ${limits.autonomousSpendLimit}.`,
        requiresOwnerApproval: true,
      }
    }
  }

  if (request.containsPersonalData && request.externalSideEffect) {
    return {
      authority: 'HUMAN_APPROVAL',
      autonomous: false,
      reason: 'External action involving personal data requires approval.',
      requiresOwnerApproval: true,
    }
  }

  if (confidence < limits.minimumConfidence) {
    return {
      authority: 'HUMAN_APPROVAL',
      autonomous: false,
      reason: `Decision confidence ${confidence.toFixed(2)} is below autonomous threshold ${limits.minimumConfidence.toFixed(2)}.`,
      requiresOwnerApproval: true,
    }
  }

  if (request.reversible && !request.externalSideEffect) {
    return {
      authority: 'AUTONOMOUS_SAFE',
      autonomous: true,
      reason: 'Policy-approved, reversible internal action with sufficient confidence.',
      requiresOwnerApproval: false,
    }
  }

  return {
    authority: 'AUTONOMOUS_BOUNDED',
    autonomous: true,
    reason: 'Policy-approved action is within bounded autonomous authority.',
    requiresOwnerApproval: false,
  }
}
