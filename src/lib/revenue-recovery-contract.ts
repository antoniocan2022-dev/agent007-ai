/** Phase 2: Revenue Recovery business-unit contracts. */
export const REVENUE_RECOVERY_ID = 'revenue-recovery'
export const REVENUE_RECOVERY_VERSION = 1
export const REVENUE_RECOVERY_BUSINESS = 'revenue-recovery' as const

export const REVENUE_RECOVERY_TEAM = Object.freeze({
  leader: 'REVENUE_RECOVERY_LEADER',
  specialists: [
    'LOCAL_BUSINESS_INTELLIGENCE',
    'REVENUE_LEAKAGE_ANALYST',
    'LEAD_CRM_SPECIALIST',
    'CONVERSION_OFFER_SPECIALIST',
    'RECOVERY_OUTREACH_SPECIALIST',
    'REPUTATION_SPECIALIST',
    'CUSTOMER_SUCCESS_SPECIALIST',
    'ROI_ANALYST',
  ] as const,
})

export const REVENUE_RECOVERY_CAPABILITIES = Object.freeze([
  'local-business-intelligence',
  'revenue-leakage-analysis',
  'lead-pipeline-analysis',
  'recovery-prioritization',
  'recovery-workflow-orchestration',
  'roi-attribution',
  'customer-success',
  'delegated-outreach-control',
] as const)

export type RecoveryPriority = 'critical' | 'high' | 'medium' | 'low'
export type RecoveryOpportunityType = 'uncontacted-leads' | 'unbooked-leads' | 'no-show-recovery' | 'stalled-opportunities'
export type RecoveryAuthority = 'autonomous' | 'guardrailed' | 'human_approval' | 'forbidden'

export interface FunnelSnapshotInput {
  tenantId: string
  customerId: string
  observedAt: string
  periodStart: string
  periodEnd: string
  leadCount: number
  contactedCount: number
  bookedCount: number
  showCount: number
  noShowCount: number
  wonCount: number
  staleOpportunityCount: number
  missedCallCount: number
  averageResponseMinutes: number | null
  averageTransactionValue: number
  grossMarginPercent: number | null
  source: string
}

export interface FunnelSnapshot extends FunnelSnapshotInput {
  snapshotId: string
  contactRate: number
  bookingRateAmongContacted: number
  showRateAmongBooked: number
  closeRateAmongShows: number
  confidence: number
  createdAt: string
}

export interface RecoveryOpportunity {
  opportunityId: string
  tenantId: string
  customerId: string
  type: RecoveryOpportunityType
  priority: RecoveryPriority
  estimatedRevenue: number
  estimatedGrossProfit: number
  confidence: number
  evidenceIds: string[]
  rationale: string
  recommendedAction: string
  authorityLevel: RecoveryAuthority
  createdAt: string
}

export interface RecoveryPlan {
  planId: string
  tenantId: string
  customerId: string
  snapshotId: string
  opportunities: RecoveryOpportunity[]
  totalEstimatedRevenue: number
  totalEstimatedGrossProfit: number
  topPriority: RecoveryPriority
  blockedActions: string[]
  createdAt: string
}

export interface RecoveryOutcome {
  outcomeId: string
  tenantId: string
  customerId: string
  opportunityId: string
  expectedRevenue: number
  recoveredRevenue: number
  recoveryRate: number
  observedSource: string
  verified: boolean
  observedAt: string
  createdAt: string
}

export function getRevenueRecoverySnapshot() {
  return {
    id: REVENUE_RECOVERY_ID,
    version: REVENUE_RECOVERY_VERSION,
    team: REVENUE_RECOVERY_TEAM,
    capabilities: REVENUE_RECOVERY_CAPABILITIES,
    workflow: ['intake', 'measure', 'score', 'plan', 'authorize', 'execute', 'measure-outcome', 'learn'] as const,
  }
}

export function validateRevenueRecoveryContracts(): string[] {
  const errors: string[] = []
  if (REVENUE_RECOVERY_TEAM.specialists.length !== 8) errors.push('Revenue Recovery requires exactly 8 specialist roles.')
  if (REVENUE_RECOVERY_CAPABILITIES.length !== 8) errors.push('Revenue Recovery requires exactly 8 capabilities.')
  if (new Set(REVENUE_RECOVERY_TEAM.specialists).size !== REVENUE_RECOVERY_TEAM.specialists.length) errors.push('Revenue Recovery team contains duplicate specialists.')
  if (new Set(REVENUE_RECOVERY_CAPABILITIES).size !== REVENUE_RECOVERY_CAPABILITIES.length) errors.push('Revenue Recovery capabilities contain duplicates.')
  return errors
}
