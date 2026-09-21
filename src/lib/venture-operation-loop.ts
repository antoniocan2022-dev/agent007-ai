/**
 * Provider-neutral continuous-operation boundary for Venture OS.
 * The canonical heartbeat enters through Autonomy Manager exactly once.
 * Mission Supervisor execution is integrated here so there is one autonomous
 * control loop and one global manager lease rather than competing schedulers.
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
import { evaluateAndPersistAutonomy, recordAutonomyEvidence, type AutonomyDecision } from './autonomy-graduation'
import { assessSustainedBusinessOutcome } from './ceo-sustained-outcome'
import { ensureVenture001, VENTURE_001_REFERENCE } from './venture-001'

// Deep-audit fix: ceo-self-repair-engine.ts's runGovernedSelfRepairCycle() and
// ceo-continuous-loop.ts's runGovernedEvolutionCycle() are both real, complete, deterministic
// governed pipelines (incident clustering -> pattern extraction -> validation -> risk tiering ->
// autonomous activation or owner-approval queue, and health report -> initiative -> simulation ->
// owner-approval queue, respectively) -- both self-documented as safe to call "repeatedly and
// often ... from a scheduled trigger," but neither had one anywhere in the codebase; they only
// ran if a human manually hit /api/system/self-repair?cycle=true or /api/system/evolution?cycle=true.
// Throttled to roughly once per day (not every 15-minute heartbeat) since both scan a multi-hour/
// multi-day window and do real DB writes -- running on every heartbeat would be redundant churn,
// not more coverage.
const GOVERNED_CYCLE_MIN_INTERVAL_MS = 20 * 60 * 60 * 1000
const SELF_REPAIR_CYCLE_KEY = 'venture-os:last-self-repair-cycle'
const EVOLUTION_CYCLE_KEY = 'venture-os:last-evolution-cycle'

async function dueForGovernedCycle(key: string): Promise<boolean> {
  const row = await db.memory.findUnique({ where: { key } }).catch(() => null)
  if (!row) return true
  const last = Date.parse(row.value)
  return !Number.isFinite(last) || Date.now() - last >= GOVERNED_CYCLE_MIN_INTERVAL_MS
}

async function markGovernedCycleRun(key: string): Promise<void> {
  const value = new Date().toISOString()
  await db.memory.upsert({ where: { key }, update: { value, category: 'venture_operation_governed_cycle' }, create: { key, value, category: 'venture_operation_governed_cycle' } }).catch(() => {})
}

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
  autonomy: AutonomyDecision
  ok: boolean
  findings: string[]
}

export function createVentureOperationCycleId(ventureId: string, leaseId: string): string {
  const normalizedVentureId = ventureId.trim()
  const normalizedLeaseId = leaseId.trim()
  if (!normalizedVentureId || !normalizedLeaseId) throw new Error('ventureId and leaseId are required for a Venture operation cycle id.')
  return `cycle_${createHash('sha256').update(`${normalizedVentureId}|${normalizedLeaseId}`).digest('hex').slice(0, 20)}`
}

export function autonomyModeForLevel(level: AutonomyDecision['level']): AutonomyMode {
  return level === 'AUTONOMOUS' ? 'AUTONOMOUS' : 'SUPERVISED'
}

// Production incident (2026-09-21): the 24x7 scheduled heartbeat is the ONLY caller of this
// function in production (see scripts/run-venture-operation-cycle.ts, an unattended GitHub Actions
// job with no HTTP session at all) -- but resolveVentureOrganizationScope() below requires
// venture_001's relational Venture/BusinessUnit identity to already exist, and the only code path
// that ever created it was the owner-authenticated POST /api/ventures/001 endpoint. With nobody
// required to ever log in and hit that endpoint, the scheduled heartbeat could never succeed even
// once, regardless of DATABASE_URL or the commercial org chart being wired correctly. Bootstraps
// Venture 001's identity here, idempotently, using the same seed/owner account ensureSeedUser()
// already provisions for the one-operator system (no HTTP session required, just a DB lookup) --
// self-healing on every cycle rather than depending on a one-time manual step.
async function ensureVenture001BootstrappedForCycle(ventureId: string, findings: string[]): Promise<void> {
  if (ventureId !== VENTURE_001_REFERENCE.ventureKey) return
  try {
    const { ensureSeedUser, SEED_EMAIL } = await import('./auth')
    await ensureSeedUser()
    const owner = await db.user.findUnique({ where: { email: SEED_EMAIL } })
    if (!owner) { findings.push('Venture 001 bootstrap skipped: no seed owner account exists yet.'); return }
    await ensureVenture001(owner.id)
  } catch (error) {
    findings.push(`Venture 001 bootstrap failed safely: ${error instanceof Error ? error.message.slice(0, 240) : String(error)}`)
  }
}

export async function runVentureOperationCycle(ventureId = 'venture_001', owner = 'agent007'): Promise<VentureOperationCycle> {
  const findings: string[] = []
  const canonicalOwner = owner.trim().toLowerCase()
  await ensureVenture001BootstrappedForCycle(ventureId, findings)
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

  // A cycle can complete cleanly (no synthetic revenue, manager COMPLETED) while producing zero or
  // negative real revenue for weeks -- that is task completion, not a business outcome. Checked
  // against the KPI snapshot history just persisted above, requiring several consecutive
  // independently-verified positive windows before it counts toward Autonomous graduation.
  let sustainedOutcome: Awaited<ReturnType<typeof assessSustainedBusinessOutcome>> | null = null
  try { sustainedOutcome = await assessSustainedBusinessOutcome(ventureId) } catch (error) { findings.push(`Sustained business outcome assessment failed safely: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`) }
  if (sustainedOutcome?.regressedWindows) findings.push(`${sustainedOutcome.regressedWindows} of the last ${sustainedOutcome.windowsFound} KPI window(s) were not real revenue-positive.`)

  // Phase D/E evidence measurement is deliberately bounded to LOW_RISK work at
  // this integration point. Higher-risk action classes require their own evidence
  // streams and never inherit autonomy merely because the heartbeat is healthy.
  const autonomyEvidence = await recordAutonomyEvidence({
    actionClass: 'LOW_RISK',
    attempts: 1,
    successes: manager.status === 'COMPLETED' && !kpi.controlHealth.syntheticRevenueDetected ? 1 : 0,
    safetyViolations: kpi.controlHealth.syntheticRevenueDetected ? 1 : 0,
    businessOutcomesVerified: sustainedOutcome?.sustained ? 1 : 0,
    businessOutcomeRegressions: sustainedOutcome && sustainedOutcome.regressedWindows > 0 ? 1 : 0,
    source: `canonical-heartbeat:${ventureId}`,
    recordedAt: heartbeatAt,
    idempotencyKey: `cycle:${manager.runId}:${ventureId}`,
  })
  const autonomy = await evaluateAndPersistAutonomy('LOW_RISK')
  const mode = autonomyModeForLevel(autonomy.level)
  if (autonomy.decision === 'BLOCKED') findings.push(`Autonomy graduation blocked: ${autonomy.reason}`)
  if (autonomy.decision === 'DOWNGRADED') findings.push(`Autonomy downgraded: ${autonomy.reason}`)
  if (autonomyEvidence.safetyViolations) findings.push('Low-risk autonomy evidence recorded a safety violation.')
  if (readiness.status === 'READY' && autonomy.level !== 'AUTONOMOUS') {
    findings.push(`Venture readiness is READY but autonomy remains ${autonomy.level}; the canonical graduation policy controls execution mode.`)
  }

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

  // Deep-audit fix: these two governed pipelines (incident-pattern self-repair, org-health-driven
  // evolution) were fully built and self-documented as safe to run "repeatedly and often ... from
  // a scheduled trigger," but had no trigger anywhere -- only a manual, owner-authenticated HTTP
  // call could ever run them. Throttled via dueForGovernedCycle so they run roughly daily, not on
  // every 15-minute heartbeat.
  if (await dueForGovernedCycle(SELF_REPAIR_CYCLE_KEY).catch(() => false)) {
    try {
      const { runGovernedSelfRepairCycle } = await import('./ceo-self-repair-engine')
      const selfRepair = await runGovernedSelfRepairCycle()
      await markGovernedCycleRun(SELF_REPAIR_CYCLE_KEY)
      if (selfRepair.autoActivated.length) findings.push(`Self-repair cycle auto-activated ${selfRepair.autoActivated.length} learned classifier pattern(s).`)
      if (selfRepair.awaitingApproval.length) findings.push(`Self-repair cycle queued ${selfRepair.awaitingApproval.length} correction(s) for owner approval.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      findings.push(`Self-repair cycle failed safely: ${message.slice(0, 240)}`)
    }
  }

  if (await dueForGovernedCycle(EVOLUTION_CYCLE_KEY).catch(() => false)) {
    try {
      const { runGovernedEvolutionCycle } = await import('./ceo-continuous-loop')
      const evolution = await runGovernedEvolutionCycle()
      await markGovernedCycleRun(EVOLUTION_CYCLE_KEY)
      if (evolution.simulated.length) findings.push(`Evolution cycle simulated ${evolution.simulated.length} improvement initiative(s) (org IQ ${evolution.observed.orgIQ}).`)
      if (evolution.awaitingApproval.length) findings.push(`Evolution cycle queued ${evolution.awaitingApproval.length} initiative(s) for owner approval.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      findings.push(`Evolution cycle failed safely: ${message.slice(0, 240)}`)
    }
  }

  const id = createVentureOperationCycleId(ventureId, manager.runId)
  const checkpoint = {
    cycleId: id,
    ventureId,
    leaseId: manager.runId,
    status: 'HEALTHY',
    updatedAt: heartbeatAt,
    readiness: readiness.status,
    mode,
    businessKey: organization.businessKey,
    operationalOwnerId: organization.operationalOwnerId,
    sharedLeaderIds: organization.sharedLeaderIds,
    ventureSpecificLeaderIds: organization.ventureSpecificLeaderIds,
    kpiSnapshotId: kpi.snapshotId,
    recoveredStaleRecords,
    autonomy: {
      level: autonomy.level,
      decision: autonomy.decision,
      score: autonomy.score,
      ceiling: autonomy.ceiling,
      evidenceWindow: autonomy.evidenceWindow,
      approvalId: autonomy.approvalId,
      reason: autonomy.reason,
    },
    portfolioLearning: {
      status: portfolioLearning.status,
      reason: portfolioLearning.reason,
      completedExperiments: portfolioLearning.cycle?.completedExperiments.length ?? 0,
      replanned: Boolean(portfolioLearning.cycle?.replan),
    },
  }
  await db.memory.upsert({ where: { key: `venture-os:operation:${ventureId}` }, update: { category: 'venture_operation_checkpoint', value: JSON.stringify(checkpoint) }, create: { key: `venture-os:operation:${ventureId}`, category: 'venture_operation_checkpoint', value: JSON.stringify(checkpoint) } })
  return { cycleId: id, ventureId, leaseId: manager.runId, mode, readiness: readiness.status, heartbeatAt, recoveredStaleRecords, kpi, organization, portfolioLearning, autonomy, ok: !kpi.controlHealth.syntheticRevenueDetected, findings }
}
