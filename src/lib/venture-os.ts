/**
 * Venture OS — canonical integration boundary for Agent007's venture system.
 *
 * This module deliberately does NOT create a second portfolio, flywheel, or
 * VID registry. It composes the existing sources of truth:
 *   - VID contract: src/lib/vid-data.ts
 *   - portfolio/flywheel/dual missions: src/lib/business-portfolio.ts
 *
 * Venture OS exists to provide one deterministic executive view over those
 * systems, enforce cross-system invariants, and gate new venture creation.
 */

import {
  computeEnterpriseValue,
  createBusiness,
  getDualMissions,
  getPortfolio,
  type Business,
  type BusinessLifecycle,
  type BusinessType,
} from './business-portfolio'
import { db } from './db'
import {
  VID_MISSION,
  VID_WORKFLOW_STAGES,
  VENTURE_SCORE_CATEGORIES,
  VENTURE_SCORE_THRESHOLD,
} from './vid-data'

export const VENTURE_OS_ID = 'venture-os'
export const VENTURE_OS_VERSION = 1

export interface VentureOSIntegrityIssue {
  code: string
  severity: 'error' | 'warning'
  message: string
}

export interface VentureCreationInput {
  name: string
  type: BusinessType
  description: string
  targetMarket?: string
  pricingModel?: string
}

export interface VentureCreationResult {
  created: boolean
  duplicate: boolean
  business: Business | null
  reason?: string
}

export interface VentureOSSnapshot {
  id: typeof VENTURE_OS_ID
  version: typeof VENTURE_OS_VERSION
  mission: string
  ventureScoreThreshold: number
  workflow: {
    stages: number
    first: string
    last: string
    names: string[]
  }
  portfolio: {
    total: number
    active: number
    retired: number
    proposed: number
    validated: number
    launched: number
    scaling: number
    automated: number
  }
  enterpriseValue: Awaited<ReturnType<typeof computeEnterpriseValue>>
  dualMissions: {
    leaders: number
    leaderIds: string[]
  }
  integrity: {
    ok: boolean
    issues: VentureOSIntegrityIssue[]
  }
}

const TERMINAL_LIFECYCLES = new Set<BusinessLifecycle>(['retired'])

function countLifecycle(businesses: Business[], lifecycle: BusinessLifecycle): number {
  return businesses.filter((business) => business.lifecycle === lifecycle).length
}

function normalizeVentureName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

function identityKey(name: string): string {
  return `venture_identity:${normalizeVentureName(name)}`
}

/**
 * Validate cross-system invariants without mutating state.
 */
export function validateVentureOSContracts(): VentureOSIntegrityIssue[] {
  const issues: VentureOSIntegrityIssue[] = []
  const stages = VID_WORKFLOW_STAGES
  const stageNumbers = stages.map((stage) => stage.step)
  const stageNames = stages.map((stage) => stage.name.trim().toLowerCase())
  const weightsTotal = VENTURE_SCORE_CATEGORIES.reduce((total, item) => total + item.weight, 0)

  if (VID_MISSION.trim().length < 80) {
    issues.push({
      code: 'VID_MISSION_TOO_SHORT',
      severity: 'error',
      message: 'VID mission contract is unexpectedly short.',
    })
  }

  if (VENTURE_SCORE_THRESHOLD < 0 || VENTURE_SCORE_THRESHOLD > 100) {
    issues.push({
      code: 'VENTURE_SCORE_THRESHOLD_RANGE',
      severity: 'error',
      message: `Venture Score threshold ${VENTURE_SCORE_THRESHOLD} is outside 0-100.`,
    })
  }

  if (weightsTotal !== 100) {
    issues.push({
      code: 'VENTURE_SCORE_WEIGHTS',
      severity: 'error',
      message: `Venture Score category weights total ${weightsTotal}; expected 100.`,
    })
  }

  const expectedSequence = stages.map((_, index) => index + 1)
  if (stageNumbers.length === 0 || stageNumbers.some((step, index) => step !== expectedSequence[index])) {
    issues.push({
      code: 'VID_WORKFLOW_SEQUENCE',
      severity: 'error',
      message: 'VID workflow steps must be contiguous and start at 1.',
    })
  }

  if (new Set(stageNames).size !== stageNames.length) {
    issues.push({
      code: 'VID_WORKFLOW_DUPLICATE',
      severity: 'error',
      message: 'VID workflow contains duplicate stage names.',
    })
  }

  const dualMissions = getDualMissions()
  const leaderIds = dualMissions.map((mission) => mission.leaderId.trim().toLowerCase())
  if (leaderIds.some((id) => id.length === 0)) {
    issues.push({
      code: 'DUAL_MISSION_EMPTY_LEADER',
      severity: 'error',
      message: 'Every dual mission must have a non-empty leader id.',
    })
  }

  if (new Set(leaderIds).size !== leaderIds.length) {
    issues.push({
      code: 'DUAL_MISSION_DUPLICATE_LEADER',
      severity: 'error',
      message: 'Dual missions must have unique leader ids.',
    })
  }

  return issues
}

/**
 * Canonical venture creation gate.
 *
 * Existing portfolio data remains authoritative. A unique identity row in
 * Memory prevents two concurrent requests from registering the same normalized
 * venture name through the Venture OS boundary.
 */
export async function createVenture(input: VentureCreationInput): Promise<VentureCreationResult> {
  const normalizedName = normalizeVentureName(input.name)
  if (!normalizedName) {
    return { created: false, duplicate: false, business: null, reason: 'Venture name is required.' }
  }

  const key = identityKey(input.name)

  try {
    const existingIdentity = await db.memory.findUnique({ where: { key } })
    if (existingIdentity) {
      const identity = JSON.parse(existingIdentity.value) as { businessId?: string; status?: string }
      if (identity.businessId) {
        const business = (await getPortfolio()).find((item) => item.businessId === identity.businessId) ?? null
        if (business) {
          return {
            created: false,
            duplicate: true,
            business,
            reason: `Venture name already exists: ${business.name}`,
          }
        }
      }
      return {
        created: false,
        duplicate: true,
        business: null,
        reason: identity.status === 'creating'
          ? 'Venture creation is already in progress for this name.'
          : 'Venture identity is already reserved.',
      }
    }

    await db.memory.create({
      data: {
        key,
        value: JSON.stringify({ status: 'creating', name: input.name, createdAt: new Date().toISOString() }),
        category: 'venture_identity',
      },
    })

    const business = await createBusiness(input)

    await db.memory.update({
      where: { key },
      data: {
        value: JSON.stringify({
          status: 'created',
          businessId: business.businessId,
          name: business.name,
          createdAt: business.createdAt,
        }),
      },
    })

    return { created: true, duplicate: false, business }
  } catch (error) {
    // A unique-key race means another caller won the identity reservation.
    try {
      const identity = await db.memory.findUnique({ where: { key } })
      if (identity) {
        const parsed = JSON.parse(identity.value) as { businessId?: string }
        if (parsed.businessId) {
          const business = (await getPortfolio()).find((item) => item.businessId === parsed.businessId) ?? null
          return {
            created: false,
            duplicate: true,
            business,
            reason: business ? `Venture name already exists: ${business.name}` : 'Venture identity is already reserved.',
          }
        }
      }
    } catch {
      // Preserve the original failure when the reconciliation lookup also fails.
    }

    try {
      await db.memory.delete({ where: { key } })
    } catch {
      // Best effort cleanup of an abandoned reservation.
    }

    const message = error instanceof Error ? error.message : 'Venture creation failed.'
    return { created: false, duplicate: false, business: null, reason: message }
  }
}

export async function getVentureOSSnapshot(): Promise<VentureOSSnapshot> {
  const businesses = await getPortfolio()
  const enterpriseValue = await computeEnterpriseValue()
  const dualMissions = getDualMissions()
  const issues = validateVentureOSContracts()

  const lifecycleCounts = {
    total: businesses.length,
    active: businesses.filter((business) => !TERMINAL_LIFECYCLES.has(business.lifecycle)).length,
    retired: countLifecycle(businesses, 'retired'),
    proposed: countLifecycle(businesses, 'proposed'),
    validated: countLifecycle(businesses, 'validated'),
    launched: countLifecycle(businesses, 'launched'),
    scaling: countLifecycle(businesses, 'scaling'),
    automated: countLifecycle(businesses, 'automated'),
  }

  return {
    id: VENTURE_OS_ID,
    version: VENTURE_OS_VERSION,
    mission: VID_MISSION,
    ventureScoreThreshold: VENTURE_SCORE_THRESHOLD,
    workflow: {
      stages: VID_WORKFLOW_STAGES.length,
      first: VID_WORKFLOW_STAGES[0]?.name ?? '',
      last: VID_WORKFLOW_STAGES[VID_WORKFLOW_STAGES.length - 1]?.name ?? '',
      names: VID_WORKFLOW_STAGES.map((stage) => stage.name),
    },
    portfolio: lifecycleCounts,
    enterpriseValue,
    dualMissions: {
      leaders: dualMissions.length,
      leaderIds: dualMissions.map((mission) => mission.leaderId),
    },
    integrity: {
      ok: issues.every((issue) => issue.severity !== 'error'),
      issues,
    },
  }
}
