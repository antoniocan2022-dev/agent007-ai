export const PORTFOLIO_BUSINESSES=['revenue-recovery','operations-kit','career-command'] as const
export type PortfolioBusiness=typeof PORTFOLIO_BUSINESSES[number]
export type PortfolioDecision='scale'|'optimize'|'experiment'|'hold'|'pivot'|'kill'
export const PORTFOLIO_MIN_CONFIDENCE=70
export const PORTFOLIO_SCALE_MIN_HEALTH=80
export const PORTFOLIO_KILL_MAX_HEALTH=40
export const PORTFOLIO_KILL_MIN_PERIODS=2
