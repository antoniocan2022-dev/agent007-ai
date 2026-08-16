/** Provider-neutral continuous-operation boundary for Venture OS. */
import { db } from './db'
import { acquireAutonomyLease, heartbeatAutonomyLease, type AutonomyMode } from './venture-autonomy-control'
import { evaluateVentureReadiness } from './venture-autonomy-control'

export interface VentureOperationCycle {
  ventureId: string
  leaseId: string
  mode: AutonomyMode
  readiness: 'READY' | 'NOT_READY'
  heartbeatAt: string
  recoveredStaleRecords: number
  ok: boolean
  findings: string[]
}

export async function runVentureOperationCycle(ventureId = 'venture_001', owner = 'agent007'): Promise<VentureOperationCycle> {
  const readiness = await evaluateVentureReadiness(ventureId)
  const lease = await acquireAutonomyLease(ventureId, readiness.status === 'READY' ? 'AUTONOMOUS' : 'SUPERVISED', owner)
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
    } catch { /* malformed checkpoints are not executable */ }
  }
  await db.memory.upsert({ where: { key: `venture-os:operation:${ventureId}` }, update: { category: 'venture_operation_checkpoint', value: JSON.stringify({ ventureId, leaseId: heartbeat.leaseId, status: 'HEALTHY', updatedAt: now, readiness: readiness.status }) }, create: { key: `venture-os:operation:${ventureId}`, category: 'venture_operation_checkpoint', value: JSON.stringify({ ventureId, leaseId: heartbeat.leaseId, status: 'HEALTHY', updatedAt: now, readiness: readiness.status }) } })
  return { ventureId, leaseId: heartbeat.leaseId, mode: heartbeat.mode, readiness: readiness.status, heartbeatAt: heartbeat.heartbeatAt, recoveredStaleRecords, ok: true, findings: [] }
}
