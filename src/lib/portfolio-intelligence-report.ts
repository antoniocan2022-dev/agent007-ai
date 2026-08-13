import type {PortfolioMetric} from './portfolio-intelligence-types'
import {healthScore} from './portfolio-intelligence-rules'
import {forecast} from './portfolio-forecast'
export function buildPerformanceReport(metrics:PortfolioMetric[],growthRates:Partial<Record<PortfolioMetric['business'],number>>={}){return metrics.map(m=>{const growth=Number.isFinite(growthRates[m.business])?Number(growthRates[m.business]):0;const projected=forecast(m.business,m.revenue,growth,1,m.confidence);return{business:m.business,health:healthScore(m),revenue:m.revenue,projectedNextPeriod:projected.projected,growthAssumption:growth,confidence:m.confidence}})}
