/**
 * CEO Venture Mandate — the executive constitution for venture decisions.
 *
 * This is policy only. It does not create a second portfolio or execution
 * runtime; Venture OS and the existing Portfolio remain the sources of truth.
 */

export const CEO_VENTURE_MANDATE_VERSION = 1

export type VentureAuthorityLevel = 'autonomous' | 'guardrailed' | 'human_approval'

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
  mission:
    'Create and operate a small portfolio of evidence-driven digital businesses that increase long-term enterprise value while preserving capital discipline, learning velocity, and human control over irreversible external actions.',
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
    autonomous: [
      'research',
      'analysis',
      'content_generation',
      'digital_asset_generation',
      'internal_experiments',
      'analytics',
      'monitoring',
      'reporting',
      'non_destructive_optimization',
    ],
    guardrailed: [
      'publish_content',
      'website_updates',
      'small_operating_spend',
      'discounts_within_limit',
      'refunds_within_limit',
      'outreach_within_limit',
      'routine_product_changes',
    ],
    human_approval: [
      'banking',
      'identity_verification',
      'kyc',
      'legal_contracts',
      'ownership_changes',
      'borrowing',
      'tax_filings',
      'major_expenditure',
      'payment_credential_changes',
      'irreversible_financial_actions',
    ],
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

export function validateVentureMandate(mandate: VentureMandate = CEO_VENTURE_MANDATE): string[] {
  const errors: string[] = []
  if (mandate.targetPortfolioSize < 1) errors.push('targetPortfolioSize must be at least 1.')
  if (mandate.maximumInitialCapital < 0) errors.push('maximumInitialCapital must be non-negative.')
  if (mandate.preferredInitialCapital < 0 || mandate.preferredInitialCapital > mandate.maximumInitialCapital) {
    errors.push('preferredInitialCapital must be within the maximumInitialCapital ceiling.')
  }
  for (const [name, value] of [
    ['opportunityScoreMinimum', mandate.opportunityScoreMinimum],
    ['scaleHealthMinimum', mandate.scaleHealthMinimum],
    ['optimizeHealthMinimum', mandate.optimizeHealthMinimum],
    ['experimentHealthMinimum', mandate.experimentHealthMinimum],
    ['killHealthMaximum', mandate.killHealthMaximum],
  ] as const) {
    if (value < 0 || value > 100) errors.push(`${name} must be between 0 and 100.`)
  }
  if (mandate.scaleHealthMinimum <= mandate.optimizeHealthMinimum) errors.push('scaleHealthMinimum must be greater than optimizeHealthMinimum.')
  if (mandate.optimizeHealthMinimum <= mandate.experimentHealthMinimum) errors.push('optimizeHealthMinimum must be greater than experimentHealthMinimum.')
  if (mandate.experimentHealthMinimum <= mandate.killHealthMaximum) errors.push('experimentHealthMinimum must be greater than killHealthMaximum.')
  if (mandate.validationConfidenceMinimum < 0 || mandate.validationConfidenceMinimum > 1) errors.push('validationConfidenceMinimum must be between 0 and 1.')
  if (mandate.maximumSingleSpendWithoutApproval > mandate.maximumInitialCapital) errors.push('maximumSingleSpendWithoutApproval cannot exceed the portfolio ceiling.')
  if (mandate.authorities.autonomous.length === 0 || mandate.authorities.human_approval.length === 0) errors.push('Authority boundaries must contain autonomous and human approval actions.')
  if (mandate.hardStops.length < 5) errors.push('Hard-stop policy is unexpectedly incomplete.')
  return errors
}

export function isSpendWithinGuardrail(amount: number, monthlyCommitted: number = 0): boolean {
  return Number.isFinite(amount) && amount >= 0 && amount <= CEO_VENTURE_MANDATE.maximumSingleSpendWithoutApproval &&
    monthlyCommitted + amount <= CEO_VENTURE_MANDATE.maximumMonthlyBurnWithoutApproval
}

export function canActAutonomously(action: string): boolean {
  return CEO_VENTURE_MANDATE.authorities.autonomous.includes(action)
}

export function canActWithinGuardrail(action: string): boolean {
  return CEO_VENTURE_MANDATE.authorities.guardrailed.includes(action)
}
