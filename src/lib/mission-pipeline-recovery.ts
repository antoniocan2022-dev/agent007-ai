/**
 * "Next architecture" program, Stage 5: durable mission execution for mission-pipeline.ts.
 *
 * Before this, any exception thrown while a pipeline stage ran (a transient provider timeout, a
 * network blip, a real programming bug -- all indistinguishable to the catch block in
 * runMissionPipeline) aborted the entire mission permanently. Nothing ever retried it automatically;
 * a human had to notice and manually re-trigger via resumeMissionPipeline. Meanwhile the separate
 * ActiveMission system (mission-supervisor.ts) already has durable RETRY/REPLAN/ESCALATE supervision
 * wired into the existing 15-minute autonomy heartbeat -- this module gives mission-pipeline.ts the
 * same kind of durability using the same already-proven, host-neutral primitives (DB-backed
 * heartbeat + a per-mission execution lease), rather than introducing a new platform-specific
 * durability primitive (e.g. Vercel Workflows, which this repo's hosting-independence test suite
 * explicitly keeps out of core execution logic).
 *
 * Kept as its own module (not inlined into the already-994-line mission-pipeline.ts) so the pure
 * classification/backoff logic stays independently unit-testable without pulling in the whole
 * pipeline runner, mirroring ceo-failure-reason.ts's own separation from its callers.
 */

import { ProviderControlPlaneError, getProviderFailurePolicy } from './provider-control-plane'
import type { MissionHeartbeat } from './mission-heartbeat'

/** Hard ceiling on automatic retries for one mission. Beyond this, a retryable-looking failure still
 *  becomes durably fatal -- an unhealthy mission must not retry forever and burn provider budget. */
export const MAX_MISSION_AUTO_RETRIES = 5

/** Backoff base, minutes. Doubles per attempt, capped at 30 minutes -- bounded by the same order of
 *  magnitude as the 15-minute heartbeat cadence that drives the sweep, not an arbitrary constant. */
const BACKOFF_BASE_MINUTES = 2
const BACKOFF_CAP_MINUTES = 30

/**
 * Classifies a caught stage-execution error as safe to automatically retry or not.
 *
 * Reuses Stage 4's shared provider-failure taxonomy directly: a ProviderControlPlaneError already
 * carries provider-control-plane.ts's own precise classification (see PROVIDER_FAILURE_POLICY), so
 * this defers to it rather than re-guessing from a message string. Anything else -- a non-provider
 * error, or a provider error the policy table itself marks non-retryable (e.g. BILLING) -- is treated
 * as fatal by default; retrying an error whose real cause won't resolve on its own (a bug, a
 * misconfiguration) only delays the mission being visibly stuck.
 */
export function classifyMissionStageFailure(error: unknown): { retryable: boolean; reason: string } {
  if (error instanceof ProviderControlPlaneError) {
    return { retryable: getProviderFailurePolicy(error.kind).retryable, reason: `provider:${error.kind}` }
  }
  if (error instanceof Error && /timeout|timed out|ECONNRESET|ETIMEDOUT|network|fetch failed/i.test(error.message)) {
    return { retryable: true, reason: 'network-or-timeout' }
  }
  return { retryable: false, reason: 'fatal' }
}

/** Computes the ISO timestamp of the earliest time attempt `attemptNumber` (1-indexed) may run. */
export function computeNextAutoRetryAt(attemptNumber: number, now: Date): string {
  const minutes = Math.min(BACKOFF_BASE_MINUTES * 2 ** Math.max(0, attemptNumber - 1), BACKOFF_CAP_MINUTES)
  return new Date(now.getTime() + minutes * 60_000).toISOString()
}

/**
 * Pure function applying one stage-crash classification onto a heartbeat's recovery bookkeeping
 * fields, given the PRIOR heartbeat's autoRetryCount as the carry-forward base (buildHeartbeatFromAuditLog
 * always reconstructs a fresh heartbeat from the audit log with no memory of these fields, so the
 * caller must load and pass forward the previous value explicitly). Mutates and returns `heartbeat`
 * for convenient chaining; does not touch the database itself.
 */
export function recordMissionStageFailureOnHeartbeat(heartbeat: MissionHeartbeat, priorAutoRetryCount: number, error: unknown, now: Date = new Date()): MissionHeartbeat {
  const { retryable, reason } = classifyMissionStageFailure(error)
  const nextAttempt = retryable ? priorAutoRetryCount + 1 : priorAutoRetryCount
  const withinBudget = retryable && nextAttempt <= MAX_MISSION_AUTO_RETRIES
  heartbeat.lastFailureRetryable = withinBudget
  heartbeat.autoRetryCount = nextAttempt
  heartbeat.nextAutoRetryAt = withinBudget ? computeNextAutoRetryAt(nextAttempt, now) : null
  heartbeat.lastError = heartbeat.lastError ? `${heartbeat.lastError} [${reason}]` : reason
  return heartbeat
}

/** True when a failed mission's heartbeat says it is both eligible and due for an automatic resume. */
export function isMissionDueForAutoRetry(heartbeat: MissionHeartbeat, now: Date): boolean {
  if (heartbeat.status !== 'failed') return false
  if (!heartbeat.lastFailureRetryable) return false
  if ((heartbeat.autoRetryCount ?? 0) > MAX_MISSION_AUTO_RETRIES) return false
  if (!heartbeat.nextAutoRetryAt) return false
  const dueAt = Date.parse(heartbeat.nextAutoRetryAt)
  return Number.isFinite(dueAt) && dueAt <= now.getTime()
}

export interface MissionPipelineSupervisorSweepResult {
  inspected: number
  retried: number
  skipped: number
  errors: string[]
}

/**
 * "Next architecture" program, Stage 6: the durability/idempotency guarantee around Stage 5's
 * auto-retry capability. Wired into the same 15-minute autonomy heartbeat that already drains
 * mission-supervisor.ts's ActiveMission queue (see autonomy-manager.ts's includeMissionPipelineSupervisor
 * option) -- the heartbeat row saved by recordMissionStageFailureOnHeartbeat IS the durable commit;
 * nothing else needs to observe or replay a separate event. Idempotency across a heartbeat tick that
 * runs twice (or overlaps a slow prior run) comes from acquireMissionExecutionLease -- the same
 * per-mission, TTL'd, DB-backed lease mission-supervisor.ts already relies on for exactly this -- so
 * two concurrent sweeps can both inspect the same due mission but only one ever calls
 * resumeMissionPipeline on it.
 */
export async function sweepMissionPipelineAutoRetries(now: Date = new Date(), limit = 10): Promise<MissionPipelineSupervisorSweepResult> {
  const result: MissionPipelineSupervisorSweepResult = { inspected: 0, retried: 0, skipped: 0, errors: [] }
  const { listHeartbeats } = await import('./mission-heartbeat')
  const { acquireMissionExecutionLease, releaseMissionExecutionLease } = await import('./autonomy/autonomy-manager')
  const heartbeats = await listHeartbeats()
  const due = heartbeats.filter((hb) => isMissionDueForAutoRetry(hb, now)).slice(0, Math.max(1, Math.min(limit, 50)))
  for (const hb of due) {
    result.inspected++
    const runId = `mission-pipeline-auto-retry:${hb.missionId}:${now.getTime()}`
    const lease = await acquireMissionExecutionLease(hb.missionId, runId).catch(() => null)
    if (!lease) { result.skipped++; continue }
    try {
      const { resumeMissionPipeline } = await import('./mission-pipeline')
      const outcome = await resumeMissionPipeline(hb.missionId)
      if (outcome.success || !outcome.error) result.retried++
      else { result.retried++; result.errors.push(`${hb.missionId}: resumed but reported ${outcome.error}`) }
    } catch (error) {
      result.errors.push(`${hb.missionId}: ${error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200)}`)
    } finally {
      await releaseMissionExecutionLease(hb.missionId, runId).catch(() => {})
    }
  }
  return result
}
