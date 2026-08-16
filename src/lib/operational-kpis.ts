/**
 * Operational KPI Engine — one canonical calculation path for the executive dashboard.
 *
 * KPIs are derived from persisted operational facts only. Estimates, targets,
 * reference-venture examples, and auto-parsed income are never counted as real cash.
 */
import { db } from './db'
import { getPortfolio, type Business, type BusinessLifecycle } from './business-portfolio'
import { VENTURE_001_REFERENCE } from './venture-001'

export const OPERATIONAL_KPI_VERSION = 1
export const KPI_WINDOW_DAYS = 30

export interface IncomeFact { amount: number; source: string; notes: string | null; date: Date }
export interface MissionFact { status: 'running' | 'completed' | 'failed' }
export interface OperationalKpiInput { now: Date; missions: MissionFact[]; businesses: Business[]; incomeEntries: IncomeFact[]; customerCount: number; opportunityCount: number }

export interface ReferenceVentureSnapshot {
  exists: boolean
  ventureKey: string
  name: string | null
  lifecycle: BusinessLifecycle | null
  ventureScore: number | null
  healthScore: number | null
  monthlyRevenue: number
  customerCount: number
  automationLevel: number
  referenceVersion: number | null
}

export interface OperationalKpiSnapshot {
  version: number
  asOf: string
  windowDays: number
  missions: { active: number; completed: number; failed: number; total: number; successRate: number | null }
  ventures: { active: number; launched: number; scaling: number; portfolioMrr: number; monthlyCost: number; monthlyNetRevenue: number; averageRoi: number | null; averageHealth: number | null; averageAutomation: number | null; customers: number }
  commercial: { revenue30d: number; transactions30d: number; customers: number; openOpportunities: number }
  referenceVenture001: ReferenceVentureSnapshot
}

const ACTIVE_LIFECYCLES = new Set<BusinessLifecycle>(['proposed', 'validated', 'launched', 'active', 'scaling', 'automated'])
const LAUNCHED_LIFECYCLES = new Set<BusinessLifecycle>(['launched', 'active', 'scaling', 'automated'])
function finite(value: number | null | undefined): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null }
function clamp(value: number, min = 0, max = 100): number { return Math.min(max, Math.max(min, value)) }
function average(values: number[]): number | null { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null }
function normalizedName(name: string): string { return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase() }
export function isReferenceVenture(business: Business): boolean { return normalizedName(business.name) === normalizedName(VENTURE_001_REFERENCE.name) }

export function calculateBusinessHealth(business: Business): number {
  const roiHealth = clamp((finite(business.roi) ?? 0) + 100, 0, 200) / 2
  const automation = clamp(finite(business.automationLevel) ?? 0)
  const brand = clamp(finite(business.brandScore) ?? 0)
  const lifecycleHealth: Record<BusinessLifecycle, number> = { proposed: 30, validated: 55, launched: 75, active: 90, scaling: 95, automated: 100, retired: 0 }
  return Math.round(automation * 0.35 + roiHealth * 0.25 + lifecycleHealth[business.lifecycle] * 0.25 + brand * 0.15)
}

/** Conservative classification: only payment/affiliate evidence counts as real cash. */
export function isVerifiedIncomeEntry(entry: Pick<IncomeFact, 'source' | 'notes'>): boolean {
  const source = entry.source.trim().toLowerCase()
  const notes = (entry.notes ?? '').trim().toLowerCase()
  if (!source && !notes) return false
  if (/auto[-_ ]?logged|auto[-_ ]?parsed|projected|forecast|estimate/.test(`${source} ${notes}`)) return false
  if (['stripe', 'paypal', 'affiliate', 'payment_processor'].includes(source)) return true
  return /(?:stripe|paypal)[_:-][a-z0-9_-]+|(?:transaction|order)[_:-][a-z0-9_-]+/.test(notes)
}

export function calculateOperationalKpis(input: OperationalKpiInput): OperationalKpiSnapshot {
  const reference = input.businesses.find(isReferenceVenture) ?? null
  const realBusinesses = input.businesses.filter((business) => !isReferenceVenture(business))
  const activeBusinesses = realBusinesses.filter((business) => ACTIVE_LIFECYCLES.has(business.lifecycle))
  const launchedBusinesses = realBusinesses.filter((business) => Boolean(business.launchedAt) || LAUNCHED_LIFECYCLES.has(business.lifecycle))
  const scalingBusinesses = realBusinesses.filter((business) => business.lifecycle === 'scaling')
  const completed = input.missions.filter((mission) => mission.status === 'completed').length
  const failed = input.missions.filter((mission) => mission.status === 'failed').length
  const active = input.missions.filter((mission) => mission.status === 'running').length
  const terminal = completed + failed
  const windowStart = new Date(input.now.getTime() - KPI_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const verifiedIncome = input.incomeEntries.filter((entry) => entry.date >= windowStart && isVerifiedIncomeEntry(entry))
  const revenue30d = verifiedIncome.reduce((sum, entry) => sum + Math.max(0, finite(entry.amount) ?? 0), 0)
  const portfolioMrr = activeBusinesses.reduce((sum, business) => sum + Math.max(0, finite(business.monthlyRevenue) ?? 0), 0)
  const monthlyCost = activeBusinesses.reduce((sum, business) => sum + Math.max(0, finite(business.monthlyCost) ?? 0), 0)
  const monthlyNetRevenue = portfolioMrr - monthlyCost
  const roiValues = activeBusinesses.map((business) => finite(business.roi)).filter((value): value is number => value !== null)
  const healthValues = activeBusinesses.map(calculateBusinessHealth)
  const automationValues = activeBusinesses.map((business) => clamp(finite(business.automationLevel) ?? 0))
  const customers = activeBusinesses.reduce((sum, business) => sum + Math.max(0, Math.floor(finite(business.customerCount) ?? 0)), 0)

  return {
    version: OPERATIONAL_KPI_VERSION,
    asOf: input.now.toISOString(),
    windowDays: KPI_WINDOW_DAYS,
    missions: { active, completed, failed, total: input.missions.length, successRate: terminal ? Number(((completed / terminal) * 100).toFixed(1)) : null },
    ventures: {
      active: activeBusinesses.length,
      launched: launchedBusinesses.length,
      scaling: scalingBusinesses.length,
      portfolioMrr: Number(portfolioMrr.toFixed(2)),
      monthlyCost: Number(monthlyCost.toFixed(2)),
      monthlyNetRevenue: Number(monthlyNetRevenue.toFixed(2)),
      averageRoi: average(roiValues) === null ? null : Number((average(roiValues) as number).toFixed(1)),
      averageHealth: average(healthValues) === null ? null : Number((average(healthValues) as number).toFixed(1)),
      averageAutomation: average(automationValues) === null ? null : Number((average(automationValues) as number).toFixed(1)),
      customers,
    },
    commercial: { revenue30d: Number(revenue30d.toFixed(2)), transactions30d: verifiedIncome.length, customers: Math.max(0, Math.floor(input.customerCount)), openOpportunities: Math.max(0, Math.floor(input.opportunityCount)) },
    referenceVenture001: {
      exists: Boolean(reference),
      ventureKey: VENTURE_001_REFERENCE.ventureKey,
      name: reference?.name ?? null,
      lifecycle: reference?.lifecycle ?? null,
      ventureScore: null,
      healthScore: reference ? calculateBusinessHealth(reference) : null,
      monthlyRevenue: reference ? Number((finite(reference.monthlyRevenue) ?? 0).toFixed(2)) : 0,
      customerCount: reference ? Math.max(0, Math.floor(finite(reference.customerCount) ?? 0)) : 0,
      automationLevel: reference ? clamp(finite(reference.automationLevel) ?? 0) : 0,
      referenceVersion: reference ? VENTURE_001_REFERENCE.version : null,
    },
  }
}

export async function loadOperationalKpis(now = new Date()): Promise<OperationalKpiSnapshot> {
  const [missionRows, businesses, incomeEntries, customerCount, opportunityCount] = await Promise.all([
    db.memory.findMany({ where: { category: 'mission_telemetry' }, select: { value: true } }).catch(() => []),
    getPortfolio().catch(() => []),
    db.incomeEntry.findMany({ where: { date: { gte: new Date(now.getTime() - KPI_WINDOW_DAYS * 24 * 60 * 60 * 1000) } }, select: { amount: true, source: true, notes: true, date: true } }).catch(() => []),
    db.customer.count().catch(() => 0),
    db.opportunity.count({ where: { status: { in: ['new', 'open', 'qualified', 'in_progress'] } } }).catch(() => 0),
  ])
  const missions: MissionFact[] = missionRows.map((row) => {
    try {
      const parsed = JSON.parse(row.value) as { status?: string }
      if (parsed.status === 'completed' || parsed.status === 'failed') return { status: parsed.status }
      return { status: 'running' }
    } catch { return { status: 'running' } }
  })
  return calculateOperationalKpis({ now, missions, businesses, incomeEntries, customerCount, opportunityCount })
}
