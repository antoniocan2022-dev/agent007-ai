/**
 * Provider-neutral continuous-operation boundary for Venture OS.
 * The canonical heartbeat enters through Autonomy Manager exactly once.
 * Mission Supervisor is a child of that manager; this cycle performs bounded
 * KPI/health work and, through a lease/cooldown guard, activates the existing
 * portfolio intelligence/learning loop without creating a second scheduler.
 */
import { createHash } from 'node:crypto'
import { db } from './db'
import { runAutonomyManagerTick } from './autonomy/autonomy-manager'
import type { AutonomyMode, ReadinessStatus } from './venture-autonomy-control'
import { evaluateVentureReadiness } from './venture-autonomy-control'
import { calculateOperationalKpis, persistOperationalKpiSnapshot, type OperationalKpiSnapshot } from './operational-kpi-engine'
import { assertDelegationAllowed } from './architecture-control-plane'
import { resolveVentureOrganizationScope, type VentureOrganizationScope } from './commercial-organization-scope'
import { runPortfolioLearningHeartbeat, type PortfolioLearningHeartbeatResult } from './portfolio-learning-heartbeat'

export interface VentureOperationCycle {
  cycleId: string
  ventureId: string
  leaseId: string
  mode: AutonomyMode
  readiness: ReadinessStatus
  heartbeatAt: string
  recoveredStaleRecords: number
  kpi: OperationalKpiSnapshot
  organization: VentureOrganizationScope
  portfolioLearning: PortfolioLearningHeartbeatResult
  ok: boolean
  findings: string[]
}

function cycleId(ventureId: string) {
  return `cycle_${createHash('sha256').update(`${ventureId}|${new Date().toISOString().slice(0, 16)}`).digest('hex').slice(0, 20)}`
}

export async function runVentureOperationCycle(ventureId = 'venture_001', owner = 'agent007'): Promise<VentureOperationCycle> {
  const findings: string[] = []
  const canonicalOwner = owner.trim().toLowerCase()
  const organization = await resolveVentureOrganizationScope(ventureId)

  assertDelegationAllowed({ actorId: canonicalOwner, actorLevel: 'CEO', targetId: 'vid', targetLevel: 'VID', delegatedBy: canonicalOwner })

  if (organization.operationalOwnerId) {
    assertDelegationAllowed({ actorId: 'vid', actorLevel: 'VID', targetId: organization.operationalOwnerId, targetLevel: 'LEADER', delegatedBy: canonicalOwner })
  } else {
    findings.push(`Business ${organization.businessKey} has shared leadership without a dedicated venture-specific operational owner.`)
  }

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

  let portfolioLearning: PortfolioLearningHeartbeatResult = { status: 'skipped', reason: 'venture-operation-cycle-not-reached' }
  try {
    portfolioLearning = await runPortfolioLearningHeartbeat()
    if (portfolioLearning.status === 'ran' && portfolioLearning.cycle?.completedExperiments.some((learning) => learning.completed)) {
      findings.push(`Portfolio learning completed ${portfolioLearning.cycle.completedExperiments.filter((learning) => learning.completed).length} experiment learning result(s).`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    findings.push(`Portfolio learning heartbeat failed safely: ${message.slice(0, 240)}`)
  }

  const id = cycleId(ventureId)
  const checkpoint = { cycleId: id, ventureId, leaseId: manager.runId, status: 'HEALTHY', updatedAt: heartbeatAt, readiness: readiness.status, mode, businessKey: organization.businessKey, operationalOwnerId: organization.operationalOwnerId, sharedLeaderIds: organization.sharedLeaderIds, ventureSpecificLeaderIds: organization.ventureSpecificLeaderIds, kpiSnapshotId: kpi.snapshotId, recoveredStaleRecords, portfolioLearning: { status: portfolioLearning.status, reason: portfolioLearning.reason, completedExperiments: portfolioLearning.cycle?.completedExperiments.length ?? 0, replanned: Boolean(portfolioLearning.cycle?.replan) } }
  await db.memory.upsert({ where: { key: `venture-os:operation:${ventureId}` }, update: { category: 'venture_operation_checkpoint', value: JSON.stringify(checkpoint) }, create: { key: `venture-os:operation:${ventureId}`, category: 'venture_operation_checkpoint', value: JSON.stringify(checkpoint) } })
  return { cycleId: id, ventureId, leaseId: manager.runId, mode, readiness: readiness.status, heartbeatAt, recoveredStaleRecords, kpi, organization, portfolioLearning, ok: !kpi.controlHealth.syntheticRevenueDetected, findings }
}
