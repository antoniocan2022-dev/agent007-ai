import { db } from './db'
import type { PortfolioBusiness } from './portfolio-intelligence-contract'

export const MAX_EXPERIMENTS_STARTED_PER_BUSINESS_24H = 3
export const EXPERIMENT_COOLDOWN_MS = 30 * 60 * 1000

interface StoredExperiment { business?: unknown; status?: unknown; createdAt?: unknown; completedAt?: unknown }

function parse(value: string): StoredExperiment | null {
  try { return JSON.parse(value) as StoredExperiment } catch { return null }
}

export async function assertPortfolioExperimentSafety(business: PortfolioBusiness, now = Date.now()): Promise<void> {
  const rows = await db.memory.findMany({ where: { category: 'portfolio_intelligence_experiment' }, orderBy: { createdAt: 'desc' }, take: 500, select: { value: true } })
  let startedLast24h = 0
  let latestCompletedAt = 0
  for (const row of rows) {
    const experiment = parse(row.value)
    if (!experiment || experiment.business !== business) continue
    if (['approved', 'running', 'completed'].includes(String(experiment.status))) {
      const createdAt = Date.parse(String(experiment.createdAt ?? ''))
      if (Number.isFinite(createdAt) && now - createdAt < 24 * 60 * 60 * 1000) startedLast24h += 1
    }
    if (experiment.completedAt) {
      const completedAt = Date.parse(String(experiment.completedAt))
      if (Number.isFinite(completedAt)) latestCompletedAt = Math.max(latestCompletedAt, completedAt)
    }
    if (['proposed', 'approved', 'running'].includes(String(experiment.status))) return
  }
  if (startedLast24h >= MAX_EXPERIMENTS_STARTED_PER_BUSINESS_24H) {
    throw new Error(`Experiment rate limit reached for ${business}: maximum ${MAX_EXPERIMENTS_STARTED_PER_BUSINESS_24H} started experiments per 24 hours.`)
  }
  if (latestCompletedAt && now - latestCompletedAt < EXPERIMENT_COOLDOWN_MS) {
    throw new Error(`Experiment cooldown active for ${business}.`)
  }
}
