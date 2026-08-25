import { db } from './db'
import { buildRelationalPortfolioMetrics } from './portfolio-commercial-intelligence'
import { optimize } from './portfolio-intelligence-rules'
import { activatePortfolioExperiment } from './portfolio-experiments'
import { assertPortfolioExperimentSafety } from './portfolio-experiment-safety'
import type { PortfolioMetric, PortfolioSnapshot, PortfolioDecisionRecord } from './portfolio-intelligence-types'

function stableDecisionId(business: string, snapshotId: string): string { return `portfolio_decision_${business}_${snapshotId}` }

export async function buildPortfolioSnapshot(): Promise<PortfolioSnapshot> {
  const metrics: PortfolioMetric[] = await buildRelationalPortfolioMetrics()
  const revenue = metrics.reduce((sum, metric) => sum + metric.revenue, 0)
  const cost = metrics.reduce((sum, metric) => sum + metric.cost, 0)
  const customers = metrics.reduce((sum, metric) => sum + metric.customers, 0)
  const hasTrackedSpend = metrics.some((metric) => metric.source.includes('tracked-campaign-spend-only'))
  const margin = revenue ? Number((((revenue - cost) / revenue) * 100).toFixed(2)) : 0
  const health = metrics.length ? Math.round(metrics.reduce((sum, metric) => sum + optimize(metric).score, 0) / metrics.length) : 0
  const createdAt = new Date().toISOString()
  const snapshotId = `portfolio_snapshot_${createdAt.replace(/[-:.TZ]/g, '')}`
  const snapshot: PortfolioSnapshot & { marginScope?: string } = { snapshotId, createdAt, metrics, revenue: Number(revenue.toFixed(2)), cost: Number(cost.toFixed(2)), netRevenue: Number((revenue - cost).toFixed(2)), margin, customers, health, marginScope: hasTrackedSpend ? 'tracked_campaign_spend_only' : 'no_tracked_cost' }
  await db.memory.create({ data: { key: snapshot.snapshotId, category: 'portfolio_intelligence_snapshot', value: JSON.stringify(snapshot) } })
  return snapshot
}

export async function createOptimizationRecords(snapshot: PortfolioSnapshot): Promise<PortfolioDecisionRecord[]> {
  return Promise.all(snapshot.metrics.map(async (metric) => {
    const decision = optimize(metric)
    const decisionId = stableDecisionId(metric.business, snapshot.snapshotId)
    const record: PortfolioDecisionRecord = { ...decision, decisionId, snapshotId: snapshot.snapshotId, createdAt: new Date().toISOString(), status: 'recommended' }
    await db.memory.upsert({ where: { key: decisionId }, update: { value: JSON.stringify(record), category: 'portfolio_intelligence_decision' }, create: { key: decisionId, category: 'portfolio_intelligence_decision', value: JSON.stringify(record) } })

    if (decision.decision === 'experiment') {
      // Current causal evidence is payment-backed revenue. Do not label a revenue experiment
      // as conversion_rate until exposure/conversion outcome evidence is modeled end-to-end.
      await assertPortfolioExperimentSafety(metric.business)
      const baseline = metric.revenue
      const target = baseline > 0 ? Number((baseline * 1.1).toFixed(2)) : 1
      await activatePortfolioExperiment({
        business: metric.business,
        decisionId,
        hypothesis: `Improve ${metric.business} verified revenue using a controlled variant against the current evidence-backed baseline.`,
        metric: 'revenue',
        baseline,
        target,
        budget: 0,
      })
    }
    return record
  }))
}

export async function runPortfolioOptimization() {
  const snapshot = await buildPortfolioSnapshot()
  return { snapshot, decisions: await createOptimizationRecords(snapshot) }
}

export async function getPortfolioOptimizationHistory(limit = 25): Promise<PortfolioDecisionRecord[]> {
  const rows = await db.memory.findMany({ where: { category: 'portfolio_intelligence_decision' }, orderBy: { createdAt: 'desc' }, take: Math.max(1, Math.min(100, limit)) })
  const records: PortfolioDecisionRecord[] = []
  for (const row of rows) {
    try { records.push(JSON.parse(row.value) as PortfolioDecisionRecord) } catch { /* malformed historical telemetry is ignored */ }
  }
  return records
}
