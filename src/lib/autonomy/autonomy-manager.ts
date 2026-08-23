/**
 * Venture OS Autonomy Manager — canonical orchestration boundary for durable work.
 * Mission Supervisor execution is integrated here so there is one autonomous
 * control loop and one global manager lease rather than competing schedulers.
 */
import { createHash, randomUUID } from 'node:crypto'
import { db } from '../db'
import { assertDelegationAllowed, authorityLevelFor, ensureVentureControlContract } from '../architecture-control-plane'
import { evaluateVentureReadiness, type VentureReadinessResult } from '../venture-autonomy-control'

const MANAGER_VERSION = 2
const LEASE_TTL_MS = 4 * 60 * 1000
const LEASE_KEY = 'venture-os:autonomy-manager:lease'
const WORK_CATEGORY = 'venture_autonomy_work'
const RUN_CATEGORY = 'venture_autonomy_run'
const MISSION_LEASE_PREFIX = 'venture-os:mission-execution-lease:'
const MISSION_LEASE_TTL_MS = 3 * 60 * 1000

export type AutonomyWorkStatus = 'QUEUED' | 'CLAIMED' | 'BLOCKED' | 'COMPLETED' | 'FAILED'

export interface AutonomyWorkItem {
  workId: string
  idempotencyKey: string
  ventureId: string
  missionId: string | null
  action: string
  status: AutonomyWorkStatus
  attempts: number
  maxAttempts: number
  nextRunAt: string
  claimedAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export interface MissionExecutionLease {
  missionId: string
  runId: string
  acquiredAt: string
  expiresAt: string
}

export interface AutonomyManagerRun {
  runId: string
  version: number
  startedAt: string
  finishedAt: string
  status: 'COMPLETED' | 'BUSY' | 'FAILED'
  leaseAcquired: boolean
  venturesChecked: number
  venturesReady: number
  venturesBlocked: number
  workClaimed: number
  workCompleted: number
  workBlocked: number
  workFailed: number
  errors: string[]
  missionSupervisor?: {
    inspected: number
    acted: number
    blocked: number
    advanced: number
    failures: number
  }
}

export interface AutonomyManagerOptions {
  ventureIds?: string[]
  maxWorkItems?: number
  actorId?: string
  now?: Date
  includeMissionSupervisor?: boolean
  maxMissionSupervisorMissions?: number
  maxMissionLeaderRuns?: number
  missionStaleMinutes?: number
}

const stableId = (prefix: string, ...parts: string[]) =>
  `${prefix}_${createHash('sha256').update(parts.map((p) => p.trim()).join('|')).digest('hex').slice(0, 24)}`

function parseJson<T>(value: string): T | null {
  try { return JSON.parse(value) as T } catch { return null }
}

function normalizeVentureIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))].sort()
}

function isExpiredLease(value: string, nowMs: number): boolean {
  const lease = parseJson<{ expiresAt?: string }>(value)
  return !lease?.expiresAt || !Number.isFinite(Date.parse(lease.expiresAt)) || Date.parse(lease.expiresAt) <= nowMs
}

async function acquireLease(now: Date, runId: string): Promise<boolean> {
  const existing = await db.memory.findUnique({ where: { key: LEASE_KEY } })
  if (existing && !isExpiredLease(existing.value, now.getTime())) return false
  const value = JSON.stringify({ runId, acquiredAt: now.toISOString(), expiresAt: new Date(now.getTime() + LEASE_TTL_MS).toISOString(), version: MANAGER_VERSION })
  try {
    if (existing) await db.memory.update({ where: { key: LEASE_KEY }, data: { value, category: 'venture_autonomy_lease' } })
    else await db.memory.create({ data: { key: LEASE_KEY, value, category: 'venture_autonomy_lease' } })
    const confirmed = await db.memory.findUnique({ where: { key: LEASE_KEY } })
    const lease = confirmed ? parseJson<{ runId?: string }>(confirmed.value) : null
    return lease?.runId === runId
  } catch {
    const confirmed = await db.memory.findUnique({ where: { key: LEASE_KEY } })
    const lease = confirmed ? parseJson<{ runId?: string }>(confirmed.value) : null
    return lease?.runId === runId
  }
}

async function releaseLease(runId: string): Promise<void> {
  const existing = await db.memory.findUnique({ where: { key: LEASE_KEY } })
  const lease = existing ? parseJson<{ runId?: string }>(existing.value) : null
  if (lease?.runId !== runId) return
  await db.memory.delete({ where: { key: LEASE_KEY } }).catch(() => {})
}

/** Durable per-mission execution lease used by Mission Supervisor. */
export async function acquireMissionExecutionLease(missionId: string, runId: string, ttlMs = MISSION_LEASE_TTL_MS): Promise<MissionExecutionLease | null> {
  const id = missionId.trim()
  const owner = runId.trim()
  if (!id || !owner) throw new Error('missionId and runId are required for mission execution lease.')
  if (!Number.isFinite(ttlMs) || ttlMs < 30_000 || ttlMs > 10 * 60_000) throw new Error('Mission execution lease TTL must be between 30 seconds and 10 minutes.')
  const key = `${MISSION_LEASE_PREFIX}${id}`
  const now = Date.now()
  const existingRow = await db.memory.findUnique({ where: { key } })
  if (existingRow) {
    const existing = parseJson<MissionExecutionLease>(existingRow.value)
    if (existing?.expiresAt && Date.parse(existing.expiresAt) > now && existing.runId !== owner) return null
  }
  const lease: MissionExecutionLease = { missionId: id, runId: owner, acquiredAt: new Date(now).toISOString(), expiresAt: new Date(now + ttlMs).toISOString() }
  await db.memory.upsert({ where: { key }, update: { value: JSON.stringify(lease), category: 'venture_mission_execution_lease' }, create: { key, value: JSON.stringify(lease), category: 'venture_mission_execution_lease' } })
  const confirmed = await db.memory.findUnique({ where: { key } })
  const actual = confirmed ? parseJson<MissionExecutionLease>(confirmed.value) : null
  return actual?.runId === owner ? actual : null
}

export async function releaseMissionExecutionLease(missionId: string, runId: string): Promise<void> {
  const key = `${MISSION_LEASE_PREFIX}${missionId.trim()}`
  const existingRow = await db.memory.findUnique({ where: { key } })
  if (!existingRow) return
  const existing = parseJson<MissionExecutionLease>(existingRow.value)
  if (existing?.runId === runId) await db.memory.delete({ where: { key } }).catch(() => {})
}

async function persistRun(run: AutonomyManagerRun): Promise<void> {
  await db.memory.upsert({ where: { key: `${RUN_CATEGORY}:${run.runId}` }, update: { value: JSON.stringify(run), category: RUN_CATEGORY }, create: { key: `${RUN_CATEGORY}:${run.runId}`, value: JSON.stringify(run), category: RUN_CATEGORY } })
}

async function listDueWork(now: Date, limit: number): Promise<AutonomyWorkItem[]> {
  const rows = await db.memory.findMany({ where: { category: WORK_CATEGORY }, orderBy: { updatedAt: 'asc' }, take: Math.max(1, Math.min(limit, 100)) })
  return rows.map((row) => parseJson<AutonomyWorkItem>(row.value)).filter((item): item is AutonomyWorkItem => Boolean(item)).filter((item) => (item.status === 'QUEUED' || (item.status === 'CLAIMED' && item.claimedAt && Date.parse(item.claimedAt) + LEASE_TTL_MS <= now.getTime()))).filter((item) => Number.isFinite(Date.parse(item.nextRunAt)) && Date.parse(item.nextRunAt) <= now.getTime()).sort((a, b) => Date.parse(a.nextRunAt) - Date.parse(b.nextRunAt)).slice(0, limit)
}

async function updateWork(item: AutonomyWorkItem): Promise<void> {
  item.updatedAt = new Date().toISOString()
  await db.memory.upsert({ where: { key: `${WORK_CATEGORY}:${item.workId}` }, update: { value: JSON.stringify(item), category: WORK_CATEGORY }, create: { key: `${WORK_CATEGORY}:${item.workId}`, value: JSON.stringify(item), category: WORK_CATEGORY } })
}

export async function enqueueAutonomyWork(input: { ventureId: string; missionId?: string | null; action: string; idempotencyKey: string; nextRunAt?: string; maxAttempts?: number }): Promise<AutonomyWorkItem> {
  const ventureId = input.ventureId.trim(); const action = input.action.trim(); const idempotencyKey = input.idempotencyKey.trim()
  if (!ventureId || !action || !idempotencyKey) throw new Error('ventureId, action, and idempotencyKey are required.')
  await ensureVentureControlContract(ventureId)
  const workId = stableId('autowork', ventureId, idempotencyKey)
  const existing = await db.memory.findUnique({ where: { key: `${WORK_CATEGORY}:${workId}` } })
  if (existing) return JSON.parse(existing.value) as AutonomyWorkItem
  const now = new Date().toISOString()
  const item: AutonomyWorkItem = { workId, idempotencyKey, ventureId, missionId: input.missionId ?? null, action, status: 'QUEUED', attempts: 0, maxAttempts: Math.max(1, Math.min(input.maxAttempts ?? 3, 10)), nextRunAt: input.nextRunAt ? new Date(input.nextRunAt).toISOString() : now, claimedAt: null, lastError: null, createdAt: now, updatedAt: now }
  await db.memory.create({ data: { key: `${WORK_CATEGORY}:${workId}`, value: JSON.stringify(item), category: WORK_CATEGORY } }).catch(() => {})
  const confirmed = await db.memory.findUnique({ where: { key: `${WORK_CATEGORY}:${workId}` } })
  if (!confirmed) throw new Error('Autonomy work item could not be persisted.')
  return JSON.parse(confirmed.value) as AutonomyWorkItem
}

/** Execute one bounded autonomous heartbeat. Mission Supervisor is an integrated child of this manager. */
export async function runAutonomyManagerTick(options: AutonomyManagerOptions = {}): Promise<AutonomyManagerRun> {
  const started = options.now ? new Date(options.now) : new Date()
  const runId = stableId('autorun', started.toISOString(), cryptoSafeRunNonce())
  const actorId = (options.actorId ?? 'vid').trim().toLowerCase()
  const actorLevel = authorityLevelFor(actorId)
  const run: AutonomyManagerRun = { runId, version: MANAGER_VERSION, startedAt: started.toISOString(), finishedAt: started.toISOString(), status: 'COMPLETED', leaseAcquired: false, venturesChecked: 0, venturesReady: 0, venturesBlocked: 0, workClaimed: 0, workCompleted: 0, workBlocked: 0, workFailed: 0, errors: [] }
  if (actorLevel !== 'VID') throw new Error(`Autonomy Manager requires VID authority; received ${actorId} (${actorLevel}).`)
  run.leaseAcquired = await acquireLease(started, runId)
  if (!run.leaseAcquired) { run.status = 'BUSY'; run.finishedAt = new Date().toISOString(); await persistRun(run); return run }
  try {
    const ventureIds = normalizeVentureIds(options.ventureIds ?? ['venture_001'])
    for (const ventureId of ventureIds) {
      run.venturesChecked++
      try {
        assertDelegationAllowed({ actorId, actorLevel: 'VID', targetId: 'aurora', targetLevel: 'LEADER' })
        await ensureVentureControlContract(ventureId)
        const readiness: VentureReadinessResult = await evaluateVentureReadiness(ventureId)
        if (readiness.status === 'READY') run.venturesReady++; else run.venturesBlocked++
        const due = await listDueWork(started, options.maxWorkItems ?? 10)
        for (const item of due.filter((candidate) => candidate.ventureId === ventureId)) {
          if (readiness.status !== 'READY') { item.status = 'BLOCKED'; item.lastError = readiness.blockingReasons.join('; '); run.workBlocked++; await updateWork(item); continue }
          item.status = 'CLAIMED'; item.attempts += 1; item.claimedAt = started.toISOString(); item.lastError = null; await updateWork(item); run.workClaimed++
        }
      } catch (error: any) { run.status = 'FAILED'; run.errors.push(`${ventureId}: ${error?.message ?? String(error)}`) }
    }

    if (options.includeMissionSupervisor) {
      try {
        const { runMissionSupervisorCycle } = await import('../mission-supervisor')
        const missionResult = await runMissionSupervisorCycle({
          maxMissions: options.maxMissionSupervisorMissions,
          maxLeaderRuns: options.maxMissionLeaderRuns,
          staleMinutes: options.missionStaleMinutes,
          assumeAutonomyLease: true,
          executionOwner: runId,
        })
        run.missionSupervisor = { inspected: missionResult.inspected, acted: missionResult.acted, blocked: missionResult.blocked, advanced: missionResult.advanced, failures: missionResult.failures }
        if (missionResult.failures > 0 && run.status === 'COMPLETED') run.status = 'FAILED'
      } catch (error: any) {
        run.status = 'FAILED'
        run.errors.push(`mission-supervisor: ${error?.message ?? String(error)}`)
      }
    }
  } catch (error: any) { run.status = 'FAILED'; run.errors.push(error?.message ?? String(error)) }
  finally { run.finishedAt = new Date().toISOString(); await persistRun(run); await releaseLease(runId) }
  return run
}

function cryptoSafeRunNonce(): string { return `${Date.now()}-${randomUUID()}` }
