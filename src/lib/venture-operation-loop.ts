/**
 * Provider-neutral continuous-operation boundary for Venture OS.
 * The canonical heartbeat enters through Autonomy Manager exactly once.
 * Mission Supervisor is a child of that manager; this cycle only performs
 * bounded KPI/health work after the manager has acquired the global lease.
 */
import { createHash } from 'node:crypto'
import { db } from './db'
import { runAutonomyManagerTick } from './autonomy/autonomy-manager'
import type { AutonomyMode, ReadinessStatus } from './venture-autonomy-control'
import { evaluateVentureReadiness } from './venture-autonomy-control'
import { calculateOperationalKpis, persistOperationalKpiSnapshot, type OperationalKpiSnapshot } from './operational-kpi-engine'
import { assertDelegationAllowed } from './architecture-control-plane'

export interface VentureOperationCycle { cycleId: string; ventureId: string; leaseId: string; mode: AutonomyMode; readiness: ReadinessStatus; heartbeatAt: string; recoveredStaleRecords: number; kpi: OperationalKpiSnapshot; ok: boolean; findings: string[] }
function cycleId(ventureId: string) { return `cycle_${createHash('sha256').update(`${ventureId}|${new Date().toISOString().slice(0, 16)}`).digest('hex').slice(0, 20)}` }

export async function runVentureOperationCycle(ventureId = 'venture_001', owner = 'agent007'): Promise<VentureOperationCycle> {
  const findings: string[] = []
  const canonicalOwner = owner.trim().toLowerCase()
  assertDelegationAllowed({ actorId: canonicalOwner, actorLevel: 'CEO', targetId: 'vid', targetLevel: 'VID', delegatedBy: canonicalOwner })
  assertDelegationAllowed({ actorId: 'vid', actorLevel: 'VID', targetId: 'pulse', targetLevel: 'LEADER', delegatedBy: canonicalOwner })

  const manager = await runAutonomyManagerTick({
    actorId: 'vid',
    ventureIds: [ventureId],
    maxWorkItems: 10,
    includeMissionSupervisor: true,
    maxMissionSupervisorMissions: 5,
    maxMissionLeaderRuns: 2,
    missionStaleMinutes: 30,
  })
  if (manager.status === 'BUSY') throw new Error('Canonical Autonomy Manager heartbeat is already leased by another execution.')
  if (manager.status === 'FAILED') throw new Error(manager.errors.join('; ') || 'Canonical Autonomy Manager heartbeat failed.')

  const readiness = await evaluateVentureReadiness(ventureId)
  const mode: AutonomyMode = readiness.status === 'READY' ? 'AUTONOMOUS' : 'SUPERVISED'
  const heartbeatAt = manager.finishedAt
  const stale = await db.memory.findMany({ where: { category: 'venture_operation_checkpoint' }, take: 1000 })
  let recoveredStaleRecords = 0
  for (const row of stale) {
    try {
      const checkpoint = JSON.parse(row.value) as { ventureId?: string; status?: string; updatedAt?: string }
      if (checkpoint.ventureId === ventureId && checkpoint.status === 'RUNNING' && checkpoint.updatedAt && Date.parse(checkpoint.updatedAt) < Date.now() - 15 * 60 * 1000) {
        await db.memory.update({ where: { id: row.id }, data: { value: JSON.stringify({ ...checkpoint, status: 'RECOVERABLE', recoveredAt: heartbeatAt }) } })
        recoveredStaleRecords += 1
      }
    } catch { /* Malformed checkpoints are observationally ignored and never executed. */ }
  }

  const kpi = await calculateOperationalKpis(ventureId, 24)
  await persistOperationalKpiSnapshot(kpi)
  if (kpi.controlHealth.syntheticRevenueDetected) findings.push('Synthetic revenue evidence detected by KPI integrity scan.')
  if (readiness.status !== 'READY') findings.push(...readiness.blockingReasons)

  const id = cycleId(ventureId)
  const checkpoint = { cycleId: id, ventureId, leaseId: manager.runId, status: 'HEALTHY', updatedAt: heartbeatAt, readiness: readiness.status, mode, kpiSnapshotId: kpi.snapshotId, recoveredStaleRecords }
  await db.memory.upsert({ where: { key: `venture-os:operation:${ventureId}` }, update: { category: 'venture_operation_checkpoint', value: JSON.stringify(checkpoint) }, create: { key: `venture-os:operation:${ventureId}`, category: 'venture_operation_checkpoint', value: JSON.stringify(checkpoint) } })
  return { cycleId: id, ventureId, leaseId: manager.runId, mode, readiness: readiness.status, heartbeatAt, recoveredStaleRecords, kpi, ok: !kpi.controlHealth.syntheticRevenueDetected, findings }
}
