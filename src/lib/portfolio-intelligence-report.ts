import type {PortfolioMetric} from './portfolio-intelligence-types'
import {healthScore} from './portfolio-intelligence-rules'
import {forecast} from './portfolio-forecast'
export function buildPerformanceReport(metrics:PortfolioMetric[]){return metrics.map(m=>({business:m.business,health:healthScore(m),revenue:m.revenue,projectedNextPeriod:forecast(m.revenue,0.1,1,m.confidence).projected,confidence:m.confidence}))}
