/**
 * CEO Venture Mandate — the executive constitution for venture decisions.
 *
 * This module is the canonical machine-readable authority boundary for venture
 * actions. It does not create a second portfolio or execution runtime.
 */

export const CEO_VENTURE_MANDATE_VERSION = 2

export type VentureAuthorityLevel = 'autonomous' | 'guardrailed' | 'human_approval'
export type VentureRiskClass = 'low' | 'medium' | 'high' | 'critical'
export type VentureSpendClass = 'none' | 'guardrail' | 'owner_approval'

export interface VentureActionEnvelope {
  action: string
  authority: VentureAuthorityLevel
  riskClass: VentureRiskClass
  spendClass: VentureSpendClass
  maxSingleSpend: number | null
  maxMonthlySpend: number | null
  maxDailyCount: number | null
  irreversible: boolean
}

export interface VentureActionEvaluation {
  allowed: boolean
  requiresHumanApproval: boolean
  reason: string | null
  envelope: VentureActionEnvelope
}

export interface VentureMandate {
  id: 'ceo-venture-mandate'
  version: number
  mission: string
  targetPortfolioSize: number
  maximumInitialCapital: number
  preferredInitialCapital: number
  opportunityScoreMinimum: number
  validationConfidenceMinimum: number
  scaleHealthMinimum: number
  optimizeHealthMinimum: number
  experimentHealthMinimum: number
  killHealthMaximum: number
  maximumMonthlyBurnWithoutApproval: number
  maximumSingleSpendWithoutApproval: number
  maximumDiscountPercentWithoutApproval: number
  maximumRefundWithoutApproval: number
  maximumDailyOutreachWithoutApproval: number
  authorities: Record<VentureAuthorityLevel, string[]>
  hardStops: string[]
}

export const CEO_VENTURE_MANDATE: VentureMandate = {
  id: 'ceo-venture-mandate',
  version: CEO_VENTURE_MANDATE_VERSION,
  mission: 'Create and operate a small portfolio of evidence-driven digital businesses that increase long-term enterprise value while preserving capital discipline, learning velocity, and human control over irreversible external actions.',
  targetPortfolioSize: 3,
  maximumInitialCapital: 100,
  preferredInitialCapital: 50,
  opportunityScoreMinimum: 87,
  validationConfidenceMinimum: 0.75,
  scaleHealthMinimum: 80,
  optimizeHealthMinimum: 65,
  experimentHealthMinimum: 50,
  killHealthMaximum: 49,
  maximumMonthlyBurnWithoutApproval: 100,
  maximumSingleSpendWithoutApproval: 10,
  maximumDiscountPercentWithoutApproval: 20,
  maximumRefundWithoutApproval: 25,
  maximumDailyOutreachWithoutApproval: 50,
  authorities: {
    autonomous: ['research', 'analysis', 'content_generation', 'digital_asset_generation', 'internal_experiments', 'analytics', 'monitoring', 'reporting', 'non_destructive_optimization'],
    guardrailed: ['publish_content', 'website_updates', 'small_operating_spend', 'discounts_within_limit', 'refunds_within_limit', 'outreach_within_limit', 'routine_product_changes'],
    human_approval: ['banking', 'identity_verification', 'kyc', 'legal_contracts', 'ownership_changes', 'borrowing', 'tax_filings', 'major_expenditure', 'payment_credential_changes', 'irreversible_financial_actions'],
  },
  hardStops: [
    'Never treat generated output as proof of market demand.',
    'Never treat a forecast as realized revenue.',
    'Never exceed the portfolio capital ceiling without human approval.',
    'Never create duplicate ventures when an existing venture identity matches.',
    'Never sign legal agreements or complete regulated identity steps autonomously.',
    'Never fabricate customer, revenue, conversion, or profitability evidence.',
    'Never convert a low-confidence recommendation directly into irreversible external action.',
  ],
}

const LIFECYCLE_ACTION_AUTHORITY: Record<string, VentureAuthorityLevel> = {
  reject: 'autonomous', validate: 'autonomous', build: 'guardrailed', launch_ready: 'human_approval',
  scale: 'human_approval', optimize: 'autonomous', experiment: 'autonomous', pivot: 'human_approval',
  kill: 'human_approval', hold: 'autonomous',
}
const HIGH_RISK_ACTIONS = new Set(['build', 'launch_ready', 'scale', 'pivot', 'kill', 'refunds_within_limit', 'major_expenditure', 'payment_credential_changes'])
const CRITICAL_RISK_ACTIONS = new Set(['launch_ready', 'scale', 'pivot', 'kill', 'banking', 'ownership_changes', 'borrowing', 'tax_filings', 'legal_contracts', 'identity_verification', 'kyc', 'irreversible_financial_actions'])
const MEDIUM_RISK_ACTIONS = new Set(['internal_experiments', 'publish_content', 'website_updates', 'small_operating_spend', 'discounts_within_limit', 'outreach_within_limit', 'routine_product_changes'])
const IRREVERSIBLE_ACTIONS = new Set(['launch_ready', 'scale', 'pivot', 'kill', 'ownership_changes', 'borrowing', 'tax_filings', 'legal_contracts', 'banking', 'payment_credential_changes', 'irreversible_financial_actions'])

function authorityForAction(action: string): VentureAuthorityLevel {
  if (LIFECYCLE_ACTION_AUTHORITY[action]) return LIFECYCLE_ACTION_AUTHORITY[action]
  if (CEO_VENTURE_MANDATE.authorities.autonomous.includes(action)) return 'autonomous'
  if (CEO_VENTURE_MANDATE.authorities.guardrailed.includes(action)) return 'guardrailed'
  if (CEO_VENTURE_MANDATE.authorities.human_approval.includes(action)) return 'human_approval'
  return 'human_approval'
}
function riskClassForAction(action: string): VentureRiskClass {
  if (CRITICAL_RISK_ACTIONS.has(action)) return 'critical'
  if (HIGH_RISK_ACTIONS.has(action)) return 'high'
  if (MEDIUM_RISK_ACTIONS.has(action)) return 'medium'
  return 'low'
}
function spendClassForAction(action: string, authority: VentureAuthorityLevel): VentureSpendClass {
  if (authority === 'human_approval') return 'owner_approval'
  if (['internal_experiments', 'small_operating_spend', 'refunds_within_limit', 'build'].includes(action)) return 'guardrail'
  return 'none'
}

export function resolveVentureActionEnvelope(action: string): VentureActionEnvelope {
  const normalized = action.trim()
  const authority = authorityForAction(normalized)
  const spendClass = spendClassForAction(normalized, authority)
  const maxSingleSpend = normalized === 'refunds_within_limit' ? CEO_VENTURE_MANDATE.maximumRefundWithoutApproval : spendClass === 'guardrail' ? CEO_VENTURE_MANDATE.maximumSingleSpendWithoutApproval : null
  return {
    action: normalized,
    authority,
    riskClass: riskClassForAction(normalized),
    spendClass,
    maxSingleSpend,
    maxMonthlySpend: spendClass === 'guardrail' ? CEO_VENTURE_MANDATE.maximumMonthlyBurnWithoutApproval : null,
    maxDailyCount: normalized === 'outreach_within_limit' ? CEO_VENTURE_MANDATE.maximumDailyOutreachWithoutApproval : null,
    irreversible: IRREVERSIBLE_ACTIONS.has(normalized),
  }
}

export function evaluateVentureAction(action: string, input: { requestedSpend?: number; monthlyCommittedSpend?: number; dailyCount?: number } = {}): VentureActionEvaluation {
  const envelope = resolveVentureActionEnvelope(action)
  const requestedSpend = input.requestedSpend ?? 0
  const monthlyCommittedSpend = input.monthlyCommittedSpend ?? 0
  const dailyCount = input.dailyCount ?? 0
  if (envelope.authority === 'human_approval') return { allowed: false, requiresHumanApproval: true, reason: `Action ${envelope.action} requires owner approval.`, envelope }
  if (!Number.isFinite(requestedSpend) || requestedSpend < 0) return { allowed: false, requiresHumanApproval: false, reason: 'Requested spend must be a finite non-negative number.', envelope }
  if (envelope.spendClass === 'guardrail') {
    if (envelope.maxSingleSpend !== null && requestedSpend > envelope.maxSingleSpend) return { allowed: false, requiresHumanApproval: true, reason: `Requested spend exceeds the single-action guardrail for ${envelope.action}.`, envelope }
    if (envelope.maxMonthlySpend !== null && monthlyCommittedSpend + requestedSpend > envelope.maxMonthlySpend) return { allowed: false, requiresHumanApproval: true, reason: `Requested spend exceeds the monthly guardrail for ${envelope.action}.`, envelope }
  }
  if (envelope.maxDailyCount !== null && dailyCount > envelope.maxDailyCount) return { allowed: false, requiresHumanApproval: true, reason: `Daily action count exceeds the guardrail for ${envelope.action}.`, envelope }
  return { allowed: true, requiresHumanApproval: false, reason: null, envelope }
}

export function validateVentureMandate(mandate: VentureMandate = CEO_VENTURE_MANDATE): string[] {
  const errors: string[] = []
  if (mandate.targetPortfolioSize < 1) errors.push('targetPortfolioSize must be at least 1.')
  if (mandate.maximumInitialCapital < 0) errors.push('maximumInitialCapital must be non-negative.')
  if (mandate.preferredInitialCapital < 0 || mandate.preferredInitialCapital > mandate.maximumInitialCapital) errors.push('preferredInitialCapital must be within the maximumInitialCapital ceiling.')
  for (const [name, value] of [['opportunityScoreMinimum', mandate.opportunityScoreMinimum], ['scaleHealthMinimum', mandate.scaleHealthMinimum], ['optimizeHealthMinimum', mandate.optimizeHealthMinimum], ['experimentHealthMinimum', mandate.experimentHealthMinimum], ['killHealthMaximum', mandate.killHealthMaximum]] as const) {
    if (value < 0 || value > 100) errors.push(`${name} must be between 0 and 100.`)
  }
  if (mandate.scaleHealthMinimum <= mandate.optimizeHealthMinimum) errors.push('scaleHealthMinimum must be greater than optimizeHealthMinimum.')
  if (mandate.optimizeHealthMinimum <= mandate.experimentHealthMinimum) errors.push('optimizeHealthMinimum must be greater than experimentHealthMinimum.')
  if (mandate.experimentHealthMinimum <= mandate.killHealthMaximum) errors.push('experimentHealthMinimum must be greater than killHealthMaximum.')
  if (mandate.validationConfidenceMinimum < 0 || mandate.validationConfidenceMinimum > 1) errors.push('validationConfidenceMinimum must be between 0 and 1.')
  if (mandate.maximumSingleSpendWithoutApproval > mandate.maximumInitialCapital) errors.push('maximumSingleSpendWithoutApproval cannot exceed the portfolio ceiling.')
  if (mandate.authorities.autonomous.length === 0 || mandate.authorities.human_approval.length === 0) errors.push('Authority boundaries must contain autonomous and human approval actions.')
  const allActions = [...mandate.authorities.autonomous, ...mandate.authorities.guardrailed, ...mandate.authorities.human_approval]
  if (new Set(allActions).size !== allActions.length) errors.push('Authority actions must belong to exactly one authority tier.')
  for (const action of allActions) if (!resolveVentureActionEnvelope(action).action) errors.push('An authority action resolved to an empty envelope.')
  if (mandate.hardStops.length < 5) errors.push('Hard-stop policy is unexpectedly incomplete.')
  return errors
}
export function isSpendWithinGuardrail(amount: number, monthlyCommitted: number = 0): boolean { return evaluateVentureAction('internal_experiments', { requestedSpend: amount, monthlyCommittedSpend: monthlyCommitted }).allowed }
export function canActAutonomously(action: string): boolean { return resolveVentureActionEnvelope(action).authority === 'autonomous' }
export function canActWithinGuardrail(action: string): boolean { return resolveVentureActionEnvelope(action).authority === 'guardrailed' }
