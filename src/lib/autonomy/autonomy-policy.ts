/**
 * Agent007 Autonomy Governor — policy primitives.
 *
 * This module classifies an action request. It does not execute actions.
 * The server-side authorization boundary must never be inferred solely from
 * an LLM response.
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
 * Safety invariants:
 * - uncertainty escalates authority; it never expands autonomy;
 * - category-level hazards cannot be hidden by inconsistent boolean flags;
 * - unknown financial cost is never treated as zero;
 * - deployment/security/production actions require explicit approval;
 * - irreversible external effects require explicit approval.
 */
export function classifyAutonomyAction(
  request: AutonomyActionRequest,
  limits: AutonomyPolicyLimits = DEFAULT_LIMITS,
): AutonomyPolicyDecision {
  const confidence = clamp01(request.confidence)
  const category = request.category
  const cost = request.estimatedCost
  const spendLimit = Math.max(0, Number.isFinite(limits.autonomousSpendLimit) ? limits.autonomousSpendLimit : 0)
  const minimumConfidence = clamp01(limits.minimumConfidence)

  if (limits.forbiddenCategories.has(category) || category === 'data_destructive') {
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

  if (category === 'deployment' || request.affectsSecurity || request.affectsProduction) {
    return {
      authority: 'HUMAN_APPROVAL',
      autonomous: false,
      reason: 'Deployment, security, or production state requires explicit owner authorization.',
      requiresOwnerApproval: true,
    }
  }

  if (category === 'external_irreversible' || (!request.reversible && request.externalSideEffect)) {
    return {
      authority: 'HUMAN_APPROVAL',
      autonomous: false,
      reason: 'Irreversible external side effect requires explicit approval.',
      requiresOwnerApproval: true,
    }
  }

  if (request.affectsFinancialState || category === 'financial') {
    if (!Number.isFinite(cost) || (cost ?? 0) < 0) {
      return {
        authority: 'HUMAN_APPROVAL',
        autonomous: false,
        reason: 'Financial action has no valid bounded cost estimate.',
        requiresOwnerApproval: true,
      }
    }
    if ((cost ?? 0) > spendLimit) {
      return {
        authority: 'HUMAN_APPROVAL',
        autonomous: false,
        reason: `Financial action exceeds autonomous spend limit of ${spendLimit}.`,
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

  if (category === 'communication' && !request.reversible) {
    return {
      authority: 'HUMAN_APPROVAL',
      autonomous: false,
      reason: 'Irreversible external communication requires explicit approval.',
      requiresOwnerApproval: true,
    }
  }

  if (confidence < minimumConfidence) {
    return {
      authority: 'HUMAN_APPROVAL',
      autonomous: false,
      reason: `Decision confidence ${confidence.toFixed(2)} is below autonomous threshold ${minimumConfidence.toFixed(2)}.`,
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
