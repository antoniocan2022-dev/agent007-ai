export const PORTFOLIO_BUSINESSES = ['revenue-recovery','operations-kit','career-command'] as const
export type PortfolioBusiness = typeof PORTFOLIO_BUSINESSES[number]
export type PortfolioDecision = 'scale'|'optimize'|'experiment'|'hold'|'pivot'|'kill'
export const PORTFOLIO_MIN_CONFIDENCE = 70
