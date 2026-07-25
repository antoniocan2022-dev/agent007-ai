/**
 * mission-heartbeat.ts — UPGRADE #144 (Real-Time Mission Monitoring — Rec 2)
 * ===================================================================
 * Provides LIVE mission status for the dashboard:
 *   - Which stage is currently running
 *   - How long it has been running (elapsed time)
 *   - Estimated time to completion (based on historical stage durations)
 *   - Whether the team is "working" / "stuck" / "errored"
 *   - The CEO's watchdog verdict on the current state
 *
 * Storage: UserSetting table (key = `mission_heartbeat_<missionId>`)
 * Updated by: mission-pipeline.ts after every stage transition
 * Read by: /api/missions/[id]/heartbeat (polled by dashboard every 5s)
 */

import { db } from './db'
import { loadApprovalLog } from './approval-audit-log'

export type MissionStatus = 'idle' | 'working' | 'paused_owner' | 'stuck' | 'errored' | 'completed' | 'failed'

export interface StageTiming {
  stageId: string
  stageName: string
  team: string
  leader: string
  startedAt: string | null
  completedAt: string | null
  durationMs: number | null  // null if not yet completed
  rounds: number
  finalScore: number | null
}

export interface MissionHeartbeat {
  missionId: string
  missionTitle: string
  pipelineType: string
  status: MissionStatus
  currentStage: {
    stageId: string
    stageNumber: number
    totalStages: number
    name: string
    team: string
    leader: string
    startedAt: string | null
    elapsedMs: number | null
    round: number
    maxRounds: number
  } | null
  completedStages: StageTiming[]
  estimatedRemainingMs: number | null  // based on avg stage duration
  estimatedCompletionAt: string | null  // ISO date
  lastActivityAt: string | null
  lastError: string | null
  ceoWatchdog: {
    verdict: 'healthy' | 'warning' | 'critical'
    message: string
    checkedAt: string
  }
  updatedAt: string
}

const HEARTBEAT_KEY_PREFIX = 'mission_heartbeat_'

async function getOperatorUserId(): Promise<string | null> {
  try {
    const user = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
    return user?.id ?? null
  } catch {
    return null
  }
}

/**
 * Save a mission heartbeat to DB.
 */
export async function saveHeartbeat(hb: MissionHeartbeat): Promise<void> {
  try {
    const userId = await getOperatorUserId()
    if (!userId) return
    const key = `${HEARTBEAT_KEY_PREFIX}${hb.missionId}`
    const value = JSON.stringify(hb)
    const existing = await db.userSetting.findFirst({ where: { userId, key } })
    if (existing) {
      await db.userSetting.update({ where: { id: existing.id }, data: { value } })
    } else {
      await db.userSetting.create({ data: { userId, key, value } })
    }
  } catch (e: any) {
    console.warn('[mission-heartbeat] save failed:', e?.message?.slice(0, 100))
  }
}

/**
 * Load a mission heartbeat from DB.
 */
export async function loadHeartbeat(missionId: string): Promise<MissionHeartbeat | null> {
  try {
    const userId = await getOperatorUserId()
    if (!userId) return null
    const row = await db.userSetting.findFirst({
      where: { userId, key: `${HEARTBEAT_KEY_PREFIX}${missionId}` },
    })
    if (!row) return null
    return JSON.parse(row.value) as MissionHeartbeat
  } catch {
    return null
  }
}

/**
 * List all heartbeats (for the dashboard's "active missions" overview).
 */
export async function listHeartbeats(): Promise<MissionHeartbeat[]> {
  try {
    const userId = await getOperatorUserId()
    if (!userId) return []
    const rows = await db.userSetting.findMany({
      where: { userId, key: { startsWith: HEARTBEAT_KEY_PREFIX } },
    })
    return rows
      .map((r) => {
        try { return JSON.parse(r.value) as MissionHeartbeat } catch { return null }
      })
      .filter((x): x is MissionHeartbeat => x !== null)
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
  } catch {
    return []
  }
}

/**
 * Compute the CEO's watchdog verdict based on the heartbeat.
 *
 * Rules:
 *   - healthy  = stage started < 5 min ago, no errors, round 1
 *   - warning  = stage started 5-15 min ago, OR round > 1, OR no activity for 2+ min
 *   - critical = stage started > 15 min ago, OR round = max, OR errored, OR no activity for 5+ min
 */
export function computeCeoWatchdog(hb: MissionHeartbeat): MissionHeartbeat['ceoWatchdog'] {
  const now = Date.now()
  const checkedAt = new Date().toISOString()

  if (hb.status === 'errored' || hb.status === 'failed') {
    return { verdict: 'critical', message: `Mission ${hb.status}: ${hb.lastError ?? 'unknown error'}`, checkedAt }
  }
  if (hb.status === 'completed') {
    return { verdict: 'healthy', message: 'Mission completed successfully', checkedAt }
  }
  if (hb.status === 'paused_owner') {
    return { verdict: 'warning', message: 'Paused — waiting for owner approval', checkedAt }
  }
  if (hb.status === 'idle' || !hb.currentStage) {
    return { verdict: 'healthy', message: 'Mission idle', checkedAt }
  }

  const elapsedMs = hb.currentStage.elapsedMs ?? 0
  const lastActivityMs = hb.lastActivityAt ? now - new Date(hb.lastActivityAt).getTime() : elapsedMs

  if (elapsedMs > 15 * 60 * 1000) {
    return {
      verdict: 'critical',
      message: `Stage ${hb.currentStage.stageNumber} running for ${Math.round(elapsedMs / 60000)} min — likely stuck. CEO should investigate.`,
      checkedAt,
    }
  }
  if (hb.currentStage.round >= hb.currentStage.maxRounds) {
    return {
      verdict: 'critical',
      message: `Stage ${hb.currentStage.stageNumber} on final retry round — about to escalate.`,
      checkedAt,
    }
  }
  if (lastActivityMs > 5 * 60 * 1000) {
    return {
      verdict: 'critical',
      message: `No activity for ${Math.round(lastActivityMs / 60000)} min — team may be stuck.`,
      checkedAt,
    }
  }
  if (elapsedMs > 5 * 60 * 1000 || hb.currentStage.round > 1) {
    return {
      verdict: 'warning',
      message: `Stage ${hb.currentStage.stageNumber} round ${hb.currentStage.round} — ${Math.round(elapsedMs / 60000)} min elapsed.`,
      checkedAt,
    }
  }
  return {
    verdict: 'healthy',
    message: `Stage ${hb.currentStage.stageNumber} running normally — ${Math.round(elapsedMs / 1000)}s elapsed.`,
    checkedAt,
  }
}

/**
 * Build a fresh heartbeat from the approval audit log.
 * This is the canonical way to reconstruct state if no heartbeat exists yet.
 */
export async function buildHeartbeatFromAuditLog(opts: {
  missionId: string
  missionTitle: string
  pipelineType: string
  totalStages: number
}): Promise<MissionHeartbeat> {
  const { missionId, missionTitle, pipelineType, totalStages } = opts
  const log = await loadApprovalLog(missionId)

  // Group entries by stage
  const stageMap = new Map<string, StageTiming>()
  for (const entry of log) {
    if (!stageMap.has(entry.stageId)) {
      stageMap.set(entry.stageId, {
        stageId: entry.stageId,
        stageName: entry.stageId,
        team: '',
        leader: '',
        startedAt: null,
        completedAt: null,
        durationMs: null,
        rounds: 0,
        finalScore: null,
      })
    }
    const st = stageMap.get(entry.stageId)!
    if (entry.action === 'started' && !st.startedAt) st.startedAt = entry.timestamp
    if (entry.action === 'approved' || entry.action === 'completed') {
      st.completedAt = entry.timestamp
      if (st.startedAt) {
        st.durationMs = new Date(st.completedAt).getTime() - new Date(st.startedAt).getTime()
      }
      if (typeof entry.score === 'number') st.finalScore = entry.score
    }
    if (entry.action === 'retry_submitted') st.rounds = entry.round
    if (entry.action === 'escalated') {
      st.rounds = entry.round
      st.finalScore = entry.score ?? 0
    }
    if (entry.agentRole === 'team_leader' && !st.leader) st.leader = entry.agentId
  }

  // Find current stage (last started, not yet completed)
  const completedStages: StageTiming[] = []
  let currentStageInfo: MissionHeartbeat['currentStage'] = null
  let lastActivityAt: string | null = null
  let lastError: string | null = null
  let overallStatus: MissionStatus = 'idle'

  for (const [stageId, st] of stageMap) {
    if (st.completedAt) {
      completedStages.push(st)
    } else if (st.startedAt) {
      // Currently running
      const elapsedMs = Date.now() - new Date(st.startedAt).getTime()
      currentStageInfo = {
        stageId,
        stageNumber: completedStages.length + 1,
        totalStages,
        name: st.stageName,
        team: st.team,
        leader: st.leader,
        startedAt: st.startedAt,
        elapsedMs,
        round: Math.max(1, st.rounds + 1),
        maxRounds: 3,
      }
    }
  }

  // Check for errors / escalations
  for (const entry of log.slice().reverse()) {
    if (entry.action === 'escalated' || entry.action === 'failed') {
      lastError = entry.feedback ?? `${entry.action} at ${entry.stageId}`
      overallStatus = entry.action === 'failed' ? 'failed' : 'errored'
      break
    }
  }
  if (!lastError && log.some((e) => e.action === 'owner_approved' || e.action === 'owner_rejected')) {
    overallStatus = log.some((e) => e.action === 'owner_approved') ? 'completed' : 'paused_owner'
  }

  // Last activity timestamp
  if (log.length > 0) {
    lastActivityAt = log[log.length - 1].timestamp
  }

  // Estimated remaining time
  let estimatedRemainingMs: number | null = null
  if (completedStages.length > 0) {
    const avgStageMs = completedStages
      .filter((s) => s.durationMs !== null)
      .reduce((sum, s, _, arr) => sum + (s.durationMs ?? 0) / arr.length, 0)
    const remainingStages = totalStages - completedStages.length - (currentStageInfo ? 1 : 0)
    estimatedRemainingMs = avgStageMs * remainingStages
  }

  const hb: MissionHeartbeat = {
    missionId,
    missionTitle,
    pipelineType,
    status: currentStageInfo ? (overallStatus === 'idle' ? 'working' : overallStatus) : overallStatus,
    currentStage: currentStageInfo,
    completedStages,
    estimatedRemainingMs,
    estimatedCompletionAt: estimatedRemainingMs !== null
      ? new Date(Date.now() + estimatedRemainingMs).toISOString()
      : null,
    lastActivityAt,
    lastError,
    ceoWatchdog: { verdict: 'healthy', message: 'Not yet checked', checkedAt: new Date().toISOString() },
    updatedAt: new Date().toISOString(),
  }
  hb.ceoWatchdog = computeCeoWatchdog(hb)
  return hb
}
