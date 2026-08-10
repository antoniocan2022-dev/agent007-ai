/**
 * Agent007 Autonomy Governor — policy primitives.
 *
 * This module classifies an action request. It does not execute actions.
 * The server-side authorization boundary must never be inferred solely from
 * an LLM response or from a caller-provided boolean.
 */

import { isVerifiedOwnerAuthorization, type VerifiedOwnerAuthorization } from './owner-authorization'

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
  /** Server-created owner authorization; never a caller-supplied boolean. */
  ownerAuthorization?: VerifiedOwnerAuthorization | null
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
  /** Whether the action may proceed at the execution boundary right now. */
  authorizedForExecution: boolean
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
 * - deployment/security/production actions require explicit owner authorization;
 * - irreversible external effects require explicit owner authorization;
 * - forbidden actions remain blocked even when an owner is authenticated.
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
  const ownerVerified = isVerifiedOwnerAuthorization(request.ownerAuthorization)

  if (limits.forbiddenCategories.has(category) || category === 'data_destructive') {
    return {
      authority: 'FORBIDDEN',
      autonomous: false,
      authorizedForExecution: false,
      reason: 'Action category is forbidden for autonomous execution.',
      requiresOwnerApproval: false,
    }
  }

  if (!request.policyApproved && !ownerVerified) {
    return {
      authority: 'HUMAN_APPROVAL',
      autonomous: false,
      authorizedForExecution: false,
      reason: 'No applicable autonomous policy or verified owner authorization is present.',
      requiresOwnerApproval: true,
    }
  }

  if (category === 'deployment' || request.affectsSecurity || request.affectsProduction) {
    return {
      authority: 'HUMAN_APPROVAL',
      autonomous: false,
      authorizedForExecution: ownerVerified,
      reason: ownerVerified
        ? 'Sensitive deployment, security, or production action is authorized by the verified owner session.'
        : 'Deployment, security, or production state requires explicit owner authorization.',
      requiresOwnerApproval: !ownerVerified,
    }
  }

  if (category === 'external_irreversible' || (!request.reversible && request.externalSideEffect)) {
    return {
      authority: 'HUMAN_APPROVAL',
      autonomous: false,
      authorizedForExecution: ownerVerified,
      reason: ownerVerified
        ? 'Irreversible external side effect is authorized by the verified owner session.'
        : 'Irreversible external side effect requires explicit owner authorization.',
      requiresOwnerApproval: !ownerVerified,
    }
  }

  if (request.affectsFinancialState || category === 'financial') {
    if (!Number.isFinite(cost) || (cost ?? 0) < 0) {
      return {
        authority: 'HUMAN_APPROVAL',
        autonomous: false,
        authorizedForExecution: ownerVerified,
        reason: ownerVerified
          ? 'Financial action has no bounded cost estimate; execution is permitted only under verified owner authorization.'
          : 'Financial action has no valid bounded cost estimate.',
        requiresOwnerApproval: !ownerVerified,
      }
    }
    if ((cost ?? 0) > spendLimit) {
      return {
        authority: 'HUMAN_APPROVAL',
        autonomous: false,
        authorizedForExecution: ownerVerified,
        reason: ownerVerified
          ? `Financial action exceeds autonomous spend limit of ${spendLimit}; verified owner authorization is present.`
          : `Financial action exceeds autonomous spend limit of ${spendLimit}.`,
        requiresOwnerApproval: !ownerVerified,
      }
    }
  }

  if (request.containsPersonalData && request.externalSideEffect) {
    return {
      authority: 'HUMAN_APPROVAL',
      autonomous: false,
      authorizedForExecution: ownerVerified,
      reason: ownerVerified
        ? 'External action involving personal data is authorized by the verified owner session.'
        : 'External action involving personal data requires approval.',
      requiresOwnerApproval: !ownerVerified,
    }
  }

  if (category === 'communication' && !request.reversible) {
    return {
      authority: 'HUMAN_APPROVAL',
      autonomous: false,
      authorizedForExecution: ownerVerified,
      reason: ownerVerified
        ? 'Irreversible external communication is authorized by the verified owner session.'
        : 'Irreversible external communication requires explicit owner approval.',
      requiresOwnerApproval: !ownerVerified,
    }
  }

  if (confidence < minimumConfidence) {
    return {
      authority: 'HUMAN_APPROVAL',
      autonomous: false,
      authorizedForExecution: ownerVerified,
      reason: ownerVerified
        ? `Decision confidence ${confidence.toFixed(2)} is below autonomous threshold ${minimumConfidence.toFixed(2)}, but the verified owner session authorizes execution.`
        : `Decision confidence ${confidence.toFixed(2)} is below autonomous threshold ${minimumConfidence.toFixed(2)}.`,
      requiresOwnerApproval: !ownerVerified,
    }
  }

  if (request.reversible && !request.externalSideEffect) {
    return {
      authority: 'AUTONOMOUS_SAFE',
      autonomous: true,
      authorizedForExecution: true,
      reason: 'Policy-approved, reversible internal action with sufficient confidence.',
      requiresOwnerApproval: false,
    }
  }

  return {
    authority: 'AUTONOMOUS_BOUNDED',
    autonomous: true,
    authorizedForExecution: true,
    reason: 'Policy-approved action is within bounded autonomous authority.',
    requiresOwnerApproval: false,
  }
}