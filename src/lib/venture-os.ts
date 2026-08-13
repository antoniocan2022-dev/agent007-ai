/**
 * Venture OS — canonical integration boundary for Agent007's venture system.
 *
 * This module deliberately does NOT create a second portfolio, flywheel, or
 * VID registry. It composes the existing sources of truth:
 *   - VID contract: src/lib/vid-data.ts
 *   - portfolio/flywheel/dual missions: src/lib/business-portfolio.ts
 *
 * Venture OS exists to provide one deterministic, read-only executive view
 * over those systems and to expose integrity checks that prevent drift.
 */

import {
  computeEnterpriseValue,
  getDualMissions,
  getPortfolio,
  type Business,
  type BusinessLifecycle,
} from './business-portfolio'
import {
  VID_MISSION,
  VID_WORKFLOW_STAGES,
  VENTURE_SCORE_THRESHOLD,
} from './vid-data'

export const VENTURE_OS_ID = 'venture-os'
export const VENTURE_OS_VERSION = 1

export interface VentureOSIntegrityIssue {
  code: string
  severity: 'error' | 'warning'
  message: string
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

/**
 * Validate cross-system invariants without mutating state.
 */
export function validateVentureOSContracts(): VentureOSIntegrityIssue[] {
  const issues: VentureOSIntegrityIssue[] = []
  const stages = VID_WORKFLOW_STAGES
  const stageNumbers = stages.map((stage) => stage.step)
  const stageNames = stages.map((stage) => stage.name.trim().toLowerCase())

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
