/** Evidence-backed operational KPI engine. */
import { createHash } from 'node:crypto'
import { db } from './db'
import { listActiveMissionsDB } from './active-missions-db'
import { evaluateVentureReadiness } from './venture-autonomy-control'
import { getVenture, getVentureCommercialSnapshot, type VentureCommercialSnapshot } from './venture-commercial-foundation'

export interface OperationalKpiSnapshot {
  snapshotId: string
  ventureId: string
  generatedAt: string
  windowHours: number
  missions: { total: number; completed: number; failed: number; blocked: number; completionRate: number }
  artifacts: { produced: number; verified: number; rejected: number; verificationRate: number }
  commercial: { totalOrders: number; paidOrders: number; fulfilledOrders: number; refundedOrders: number; failedOrders: number; conversionRate: number; fulfillmentRate: number }
  outcomes: { transactions: number; customersAcquired: number; grossRevenue: number; refunds: number; netRevenue: number; currency: string | null }
  readiness: { status: string; score: number; threshold: number; missingEvidence: string[] }
  autonomy: { mode: string; leaseHealthy: boolean; heartbeatAt: string | null; expiresAt: string | null }
  controlHealth: { artifactGateRate: number; syntheticRevenueDetected: boolean }
  relationalCommercial?: VentureCommercialSnapshot
}

function stableId(...parts: string[]) { return `kpi_${createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 24)}` }
function parseJson(value: string): Record<string, any> | null { try { return JSON.parse(value) as Record<string, any> } catch { return null } }

export async function calculateOperationalKpis(ventureId = 'venture_001', windowHours = 24): Promise<OperationalKpiSnapshot> {
  if (!ventureId.trim()) throw new Error('ventureId is required.')
  if (!Number.isFinite(windowHours) || windowHours <= 0 || windowHours > 720) throw new Error('windowHours must be between 1 and 720.')
  const cutoff = Date.now() - windowHours * 60 * 60 * 1000
  const rows = await db.memory.findMany({ take: 10000 })
  let missions: Array<Record<string, any>> = []
  try {
    const durable = await listActiveMissionsDB()
    missions = durable.map((mission) => mission as unknown as Record<string, any>).filter((m) => !m.ventureId || m.ventureId === ventureId)
  } catch {
    missions = rows.filter((r) => r.category === 'venture_mission').map((r) => parseJson(r.value)).filter((v): v is Record<string, any> => !!v && (!v.ventureId || v.ventureId === ventureId))
  }
  const artifacts = rows.filter((r) => r.category === 'architecture_artifact').map((r) => parseJson(r.value)).filter((v): v is Record<string, any> => !!v).filter((v) => (!v.ventureId || v.ventureId === ventureId) && (!v.createdAt || Date.parse(String(v.createdAt)) >= cutoff))
  const outcomes = rows.filter((r) => r.category === 'architecture_business_outcome').map((r) => parseJson(r.value)).filter((v): v is Record<string, any> => !!v).filter((v) => v.ventureId === ventureId && (!v.occurredAt || Date.parse(String(v.occurredAt)) >= cutoff))
  const workflows = rows.filter((r) => r.category === 'commercial_workflow').map((r) => parseJson(r.value)).filter((v): v is Record<string, any> => !!v).filter((v) => v.tenantId === `tenant_${ventureId}` || v.input?.ventureId === ventureId)

  const completed = missions.filter((m) => m.currentStage === 'COMPLETED').length
  const failed = missions.filter((m) => m.currentStage === 'FAILED').length
  const blocked = missions.filter((m) => m.currentStage === 'BLOCKED' || m.chain?.some((c: any) => c.status === 'blocked')).length
  const terminal = completed + failed
  const produced = artifacts.filter((a) => ['PRODUCED', 'VERIFIED', 'REJECTED', 'SUPERSEDED'].includes(String(a.status))).length
  const verified = artifacts.filter((a) => a.status === 'VERIFIED').length
  const rejected = artifacts.filter((a) => a.status === 'REJECTED').length
  const lifecycle = workflows.map((w) => String(w.output?.lifecycleState ?? w.input?.state ?? 'PROSPECT'))
  const totalOrders = lifecycle.length
  const paidOrders = lifecycle.filter((s) => ['PAID', 'FULFILLMENT', 'FULFILLED', 'REFUND_PENDING', 'REFUNDED'].includes(s)).length
  const fulfilledOrders = lifecycle.filter((s) => s === 'FULFILLED').length
  const refundedOrders = lifecycle.filter((s) => s === 'REFUNDED').length
  const failedOrders = lifecycle.filter((s) => s === 'FAILED').length
  const transactions = outcomes.filter((o) => o.type === 'TRANSACTION')
  const refunds = outcomes.filter((o) => o.type === 'REFUND')
  const customersAcquired = outcomes.filter((o) => o.type === 'CUSTOMER_ACQUIRED').length
  const grossRevenue = transactions.reduce((sum, o) => sum + (Number.isFinite(Number(o.amount)) ? Number(o.amount) : 0), 0)
  const refundAmount = refunds.reduce((sum, o) => sum + (Number.isFinite(Number(o.amount)) ? Number(o.amount) : 0), 0)

  let readiness: any
  try { readiness = await evaluateVentureReadiness(ventureId) } catch (error) { readiness = { status: 'BLOCKED', score: 0, threshold: 100, missingEvidence: [`Readiness evaluation failed: ${error instanceof Error ? error.message : String(error)}`] } }
  const leaseRow = await db.memory.findUnique({ where: { key: `venture-os:v2:autonomy-lease:${ventureId}` } })
  const lease = leaseRow ? parseJson(leaseRow.value) : null
  const leaseHealthy = !!lease && Date.parse(String(lease.expiresAt ?? '')) > Date.now() && lease.mode !== 'PAUSED'
  const syntheticRevenueDetected = outcomes.some((o) => ['TRANSACTION', 'REVENUE_RECOGNIZED'].includes(o.type) && (!o.transactionId || !o.source || Number(o.amount) <= 0))
  const relationalVenture = await getVenture(ventureId)
  const relationalCommercial = relationalVenture ? await getVentureCommercialSnapshot(ventureId) : undefined

  return {
    snapshotId: stableId(ventureId, String(windowHours), new Date().toISOString()),
    ventureId,
    generatedAt: new Date().toISOString(),
    windowHours,
    missions: { total: missions.length, completed, failed, blocked, completionRate: terminal ? Number(((completed / terminal) * 100).toFixed(2)) : 0 },
    artifacts: { produced, verified, rejected, verificationRate: produced ? Number(((verified / produced) * 100).toFixed(2)) : 0 },
    commercial: { totalOrders, paidOrders, fulfilledOrders, refundedOrders, failedOrders, conversionRate: totalOrders ? Number(((paidOrders / totalOrders) * 100).toFixed(2)) : 0, fulfillmentRate: paidOrders ? Number(((fulfilledOrders / paidOrders) * 100).toFixed(2)) : 0 },
    outcomes: { transactions: transactions.length, customersAcquired, grossRevenue: Number(grossRevenue.toFixed(2)), refunds: Number(refundAmount.toFixed(2)), netRevenue: Number((grossRevenue - refundAmount).toFixed(2)), currency: transactions.find((o) => o.currency)?.currency ?? null },
    readiness: { status: readiness.status, score: readiness.score, threshold: readiness.threshold, missingEvidence: [...readiness.missingEvidence] },
    autonomy: { mode: String(lease?.mode ?? 'PAUSED'), leaseHealthy, heartbeatAt: lease?.heartbeatAt ?? null, expiresAt: lease?.expiresAt ?? null },
    controlHealth: { artifactGateRate: produced ? Number(((verified / produced) * 100).toFixed(2)) : 100, syntheticRevenueDetected },
    relationalCommercial,
  }
}

export async function persistOperationalKpiSnapshot(snapshot: OperationalKpiSnapshot): Promise<void> {
  await db.memory.upsert({ where: { key: `operational-kpi:${snapshot.ventureId}:${snapshot.snapshotId}` }, update: { value: JSON.stringify(snapshot), category: 'operational_kpi_snapshot' }, create: { key: `operational-kpi:${snapshot.ventureId}:${snapshot.snapshotId}`, category: 'operational_kpi_snapshot', value: JSON.stringify(snapshot) } })
}
