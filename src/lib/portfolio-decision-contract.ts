/** Canonical decision vocabulary shared across portfolio and venture policy layers. */
export const PORTFOLIO_OPERATIONAL_DECISIONS = ['scale', 'optimize', 'experiment', 'hold', 'pivot', 'kill'] as const
export type PortfolioOperationalDecision = typeof PORTFOLIO_OPERATIONAL_DECISIONS[number]

export const VENTURE_LIFECYCLE_DECISIONS = ['reject', 'validate', 'build', 'launch_ready', 'scale', 'optimize', 'experiment', 'pivot', 'kill', 'hold'] as const
export type VentureLifecycleDecision = typeof VENTURE_LIFECYCLE_DECISIONS[number]

export type VentureHealthDecision = 'scale' | 'optimize' | 'experiment' | 'kill_or_pivot'

export function isPortfolioOperationalDecision(value: string): value is PortfolioOperationalDecision {
  return (PORTFOLIO_OPERATIONAL_DECISIONS as readonly string[]).includes(value)
}

export function toPortfolioDecision(decision: VentureLifecycleDecision | VentureHealthDecision): PortfolioOperationalDecision {
  if (decision === 'kill_or_pivot') return 'pivot'
  if (decision === 'reject' || decision === 'validate' || decision === 'build' || decision === 'launch_ready') return 'hold'
  return decision
}

export function toHealthDecision(decision: PortfolioOperationalDecision): VentureHealthDecision {
  if (decision === 'scale' || decision === 'optimize' || decision === 'experiment') return decision
  return decision === 'kill' || decision === 'pivot' ? 'kill_or_pivot' : 'experiment'
}
