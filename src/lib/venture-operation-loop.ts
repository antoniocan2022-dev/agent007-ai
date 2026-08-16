/**
 * Provider-neutral continuous-operation boundary for Venture OS.
 *
 * A cycle is deliberately bounded: acquire/renew control lease, recover stale
 * checkpoints, calculate evidence-backed KPIs, persist the checkpoint, then
 * exit. It never invents revenue or performs an irreversible business action.
 */
import { createHash } from 'node:crypto'
import { db } from './db'
import { acquireAutonomyLease, heartbeatAutonomyLease, type AutonomyMode, type ReadinessStatus, evaluateVentureReadiness } from './venture-autonomy-control'
import { calculateOperationalKpis, persistOperationalKpiSnapshot, type OperationalKpiSnapshot } from './operational-kpi-engine'
import { assertDelegationAllowed } from './architecture-control-plane'

export interface VentureOperationCycle {
  cycleId: string
  ventureId: string
  leaseId: string
  mode: AutonomyMode
  readiness: ReadinessStatus
  heartbeatAt: string
  recoveredStaleRecords: number
  kpi: OperationalKpiSnapshot
  ok: boolean
  findings: string[]
}

function cycleId(ventureId: string) {
  return `cycle_${createHash('sha256').update(`${ventureId}|${new Date().toISOString().slice(0, 16)}`).digest('hex').slice(0, 20)}`
}

export async function runVentureOperationCycle(ventureId = 'venture_001', owner = 'agent007'): Promise<VentureOperationCycle> {
  const findings: string[] = []
  // The runtime operation loop is a CEO-owned control action. Its internal
  // operational handoff is explicitly CEO → VID → PULSE; no hierarchy bypass.
  assertDelegationAllowed({ actorId: 'agent007', actorLevel: 'CEO', targetId: 'vid', targetLevel: 'VID', delegatedBy: owner })
  assertDelegationAllowed({ actorId: 'vid', actorLevel: 'VID', targetId: 'pulse', targetLevel: 'LEADER', delegatedBy: 'agent007' })

  const readiness = await evaluateVentureReadiness(ventureId)
  const mode: AutonomyMode = readiness.status === 'READY' ? 'AUTONOMOUS' : 'SUPERVISED'
  const lease = await acquireAutonomyLease(ventureId, mode, owner)
  const heartbeat = await heartbeatAutonomyLease(ventureId, lease.leaseId)
  const now = new Date().toISOString()

  const stale = await db.memory.findMany({ where: { category: 'venture_operation_checkpoint' }, take: 1000 })
  let recoveredStaleRecords = 0
  for (const row of stale) {
    try {
      const checkpoint = JSON.parse(row.value) as { ventureId?: string; leaseId?: string; status?: string; updatedAt?: string }
      if (checkpoint.ventureId === ventureId && checkpoint.status === 'RUNNING' && checkpoint.updatedAt && Date.parse(checkpoint.updatedAt) < Date.now() - 15 * 60 * 1000) {
        await db.memory.update({ where: { id: row.id }, data: { value: JSON.stringify({ ...checkpoint, status: 'RECOVERABLE', recoveredAt: now }) } })
        recoveredStaleRecords += 1
      }
    } catch {
      // Malformed checkpoints are observationally ignored and never executed.
    }
  }

  const kpi = await calculateOperationalKpis(ventureId, 24)
  await persistOperationalKpiSnapshot(kpi)
  if (kpi.controlHealth.syntheticRevenueDetected) findings.push('Synthetic revenue evidence detected by KPI integrity scan.')
  if (readiness.status !== 'READY') findings.push(...readiness.blockingReasons)

  const id = cycleId(ventureId)
  const checkpoint = { cycleId: id, ventureId, leaseId: heartbeat.leaseId, status: 'HEALTHY', updatedAt: now, readiness: readiness.status, mode: heartbeat.mode, kpiSnapshotId: kpi.snapshotId, recoveredStaleRecords }
  await db.memory.upsert({
    where: { key: `venture-os:operation:${ventureId}` },
    update: { category: 'venture_operation_checkpoint', value: JSON.stringify(checkpoint) },
    create: { key: `venture-os:operation:${ventureId}`, category: 'venture_operation_checkpoint', value: JSON.stringify(checkpoint) },
  })

  return { cycleId: id, ventureId, leaseId: heartbeat.leaseId, mode: heartbeat.mode, readiness: readiness.status, heartbeatAt: heartbeat.heartbeatAt, recoveredStaleRecords, kpi, ok: !kpi.controlHealth.syntheticRevenueDetected, findings }
}
