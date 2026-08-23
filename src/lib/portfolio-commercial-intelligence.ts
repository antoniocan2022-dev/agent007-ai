import { db } from './db'
import { CEO_VENTURE_MANDATE } from './venture-mandate'
import { normalizeMetric } from './portfolio-intelligence-rules'
import type { PortfolioBusiness } from './portfolio-intelligence-contract'
import type { PortfolioMetric } from './portfolio-intelligence-types'
import type { BusinessUnitKey } from './venture-commercial-foundation'

const BUSINESS_KEYS: readonly BusinessUnitKey[] = ['revenue-recovery', 'operations-kit', 'career-command']

const toPortfolioBusiness = (value: BusinessUnitKey): PortfolioBusiness => value

function parseJson(value: string): Record<string, unknown> | null {
  try { return JSON.parse(value) as Record<string, unknown> } catch { return null }
}

async function verifiedPortfolioEvidence(business: PortfolioBusiness) {
  const rows = await db.memory.findMany({ where: { category: 'commercial_evidence' }, take: 5000 })
  const ids: string[] = []
  let confidenceTotal = 0
  let count = 0
  for (const row of rows) {
    const value = parseJson(row.value)
    if (!value || value.business !== business || value.verified !== true) continue
    const source = String(value.source ?? '')
    if (!['portfolio-intelligence', 'commercial-control-plane', 'venture-os'].includes(source)) continue
    const rawConfidence = Number(value.confidence)
    if (!Number.isFinite(rawConfidence)) continue
    const normalized = rawConfidence <= 1 ? rawConfidence * 100 : rawConfidence
    confidenceTotal += Math.max(0, Math.min(100, normalized))
    count += 1
    ids.push(row.key)
  }
  const confidence = count ? Math.max(0, Math.min(100, confidenceTotal / count)) : 0
  return { confidence, ids: [...new Set(ids)] }
}

async function observedPeriods(business: PortfolioBusiness, currentPeriod: string): Promise<number> {
  const rows = await db.memory.findMany({ where: { category: 'portfolio_intelligence_snapshot' }, take: 5000 })
  const periods = new Set<string>()
  for (const row of rows) {
    const snapshot = parseJson(row.value)
    if (!snapshot || !Array.isArray(snapshot.metrics)) continue
    for (const metric of snapshot.metrics) {
      const candidate = metric as Record<string, unknown>
      if (candidate.business === business && typeof candidate.period === 'string' && candidate.period) periods.add(candidate.period)
    }
  }
  periods.add(currentPeriod)
  return periods.size
}

interface RelationalBusinessMetrics {
  business: PortfolioBusiness
  ventureCount: number
  revenue: number
  trackedSpend: number
  customers: number
  leads: number
  conversions: number
}

async function queryBusinessMetrics(business: BusinessUnitKey): Promise<RelationalBusinessMetrics> {
  const [ventureRows, revenueRows, spendRows, customerRows, leadRows, conversionRows] = await Promise.all([
    db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM "Venture" v INNER JOIN "BusinessUnit" bu ON bu."id"=v."businessUnitId" WHERE bu."businessKey"=${business}
    `,
    db.$queryRaw<Array<{ total: number | null }>>`
      SELECT COALESCE(SUM("amount"),0)::double precision AS total FROM "Transaction" t INNER JOIN "Venture" v ON v."id"=t."ventureId" INNER JOIN "BusinessUnit" bu ON bu."id"=v."businessUnitId" WHERE bu."businessKey"=${business} AND t."status"='succeeded'
    `,
    db.$queryRaw<Array<{ total: number | null }>>`
      SELECT COALESCE(SUM("spent"),0)::double precision AS total FROM "MarketingCampaign" c INNER JOIN "Venture" v ON v."id"=c."ventureId" INNER JOIN "BusinessUnit" bu ON bu."id"=v."businessUnitId" WHERE bu."businessKey"=${business}
    `,
    db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM "Customer" c INNER JOIN "Venture" v ON v."id"=c."ventureId" INNER JOIN "BusinessUnit" bu ON bu."id"=v."businessUnitId" WHERE bu."businessKey"=${business}
    `,
    db.$queryRaw<Array<{ total: number | null }>>`
      SELECT COALESCE(SUM("leadsGenerated"),0)::double precision AS total FROM "MarketingCampaign" c INNER JOIN "Venture" v ON v."id"=c."ventureId" INNER JOIN "BusinessUnit" bu ON bu."id"=v."businessUnitId" WHERE bu."businessKey"=${business}
    `,
    db.$queryRaw<Array<{ total: number | null }>>`
      SELECT COALESCE(SUM("conversions"),0)::double precision AS total FROM "MarketingCampaign" c INNER JOIN "Venture" v ON v."id"=c."ventureId" INNER JOIN "BusinessUnit" bu ON bu."id"=v."businessUnitId" WHERE bu."businessKey"=${business}
    `,
  ])
  return {
    business: toPortfolioBusiness(business),
    ventureCount: Number(ventureRows[0]?.count ?? 0),
    revenue: Math.max(0, Number(revenueRows[0]?.total ?? 0)),
    trackedSpend: Math.max(0, Number(spendRows[0]?.total ?? 0)),
    customers: Number(customerRows[0]?.count ?? 0),
    leads: Math.max(0, Number(leadRows[0]?.total ?? 0)),
    conversions: Math.max(0, Number(conversionRows[0]?.total ?? 0)),
  }
}

export async function buildRelationalPortfolioMetrics(): Promise<PortfolioMetric[]> {
  const period = new Date().toISOString().slice(0, 10)
  const raw = await Promise.all(BUSINESS_KEYS.map(queryBusinessMetrics))
  return Promise.all(raw.map(async (metric) => {
    const evidence = await verifiedPortfolioEvidence(metric.business)
    const periods = await observedPeriods(metric.business, period)
    const confidence = evidence.confidence / 100 >= CEO_VENTURE_MANDATE.validationConfidenceMinimum ? evidence.confidence : 0
    return normalizeMetric({
      business: metric.business,
      revenue: metric.revenue,
      cost: metric.trackedSpend,
      customers: metric.customers,
      leads: metric.leads,
      conversions: metric.conversions,
      automation: null,
      satisfaction: null,
      confidence,
      observedPeriods: periods,
      evidenceIds: evidence.ids,
      source: `relational-commercial:ventures=${metric.ventureCount};tracked-campaign-spend-only`,
      period,
    })
  }))
}
