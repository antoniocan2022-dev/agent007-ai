/**
 * approval-audit-log.ts — UPGRADE #140 (Audit Trail — Rec 5)
 * ===================================================================
 * Every approval, rejection, retry, escalation, and owner action gets
 * logged here with timestamp + agent role + score + feedback.
 *
 * Storage: UserSetting table (key = `approval_log_${missionId}`)
 * Why not a new Prisma model? Because adding models requires migration
 * on Vercel, and UserSetting already works. We store the audit log as
 * a JSON array in a single row per mission.
 *
 * API: /api/missions/[id]/audit-trail
 */

import { db } from './db'

export type ApprovalAction =
  | 'started'           // stage started
  | 'submitted'         // team submitted output
  | 'approved'          // super agent approved
  | 'rejected'          // super agent rejected
  | 'retry_submitted'   // team re-submitted after feedback
  | 'escalated'         // max rounds exceeded, escalated
  | 'owner_approved'    // owner explicitly approved (Rec 7)
  | 'owner_rejected'    // owner explicitly rejected (Rec 7)
  | 'paused'            // mission paused for owner approval
  | 'resumed'           // mission resumed after owner approval
  | 'completed'         // mission fully completed
  | 'failed'            // mission failed

export type AgentRole = 'team_leader' | 'super_agent' | 'ceo' | 'owner' | 'system'

export interface ApprovalLogEntry {
  id: string            // unique ID for this entry
  timestamp: string     // ISO date
  missionId: string
  stageId: string       // e.g. "stage_3"
  round: number         // 1-based round number
  agentRole: AgentRole
  agentId: string       // subagent id (e.g. "scout", "aurora", "super_agent", "ceo", "owner")
  action: ApprovalAction
  score?: number        // 0-100 (for verified entries)
  feedback?: string     // verification notes, correction summary, etc.
  artifactValue?: string // the artifact produced (if any)
}

export interface ApprovalEventInput {
  missionId: string
  stageId: string
  round: number
  agentRole: AgentRole
  agentId: string
  action: ApprovalAction
  score?: number
  feedback?: string
  artifactValue?: string
}

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Append a new entry to a mission's audit log.
 * Safe to call from any agent (orchestrator, pipeline, API route).
 */
export async function logApprovalEvent(input: ApprovalEventInput): Promise<void> {
  try {
    const user = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!user) return

    const key = `approval_log_${input.missionId}`
    const entry: ApprovalLogEntry = {
      id: uid('log'),
      timestamp: new Date().toISOString(),
      missionId: input.missionId,
      stageId: input.stageId,
      round: input.round,
      agentRole: input.agentRole,
      agentId: input.agentId,
      action: input.action,
      score: input.score,
      feedback: input.feedback?.slice(0, 5000),
      artifactValue: input.artifactValue,
    }

    // Read existing log
    const existing = await db.userSetting.findFirst({ where: { userId: user.id, key } })
    let log: ApprovalLogEntry[] = []
    if (existing) {
      try { log = JSON.parse(existing.value) as ApprovalLogEntry[] } catch { log = [] }
    }

    // Append + cap at 200 entries (prevent unbounded growth)
    log.push(entry)
    if (log.length > 200) log = log.slice(-200)

    // Write back
    const value = JSON.stringify(log)
    if (existing) {
      await db.userSetting.update({ where: { id: existing.id }, data: { value } })
    } else {
      await db.userSetting.create({ data: { userId: user.id, key, value } })
    }
  } catch (e: any) {
    // Non-fatal — log to console but don't crash the mission
    console.warn('[approval-audit-log] Failed to log:', e?.message?.slice(0, 100))
  }
}

/**
 * Load the full audit trail for a mission.
 * Used by the dashboard timeline + /api/missions/[id]/audit-trail.
 */
export async function loadApprovalLog(missionId: string): Promise<ApprovalLogEntry[]> {
  try {
    const user = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!user) return []
    const row = await db.userSetting.findFirst({
      where: { userId: user.id, key: `approval_log_${missionId}` },
    })
    if (!row) return []
    const log = JSON.parse(row.value) as ApprovalLogEntry[]
    return Array.isArray(log) ? log : []
  } catch {
    return []
  }
}

/**
 * Check if owner has explicitly approved a mission (Rec 7).
 */
export async function hasOwnerApproval(missionId: string): Promise<boolean> {
  try {
    const log = await loadApprovalLog(missionId)
    return log.some((e) => e.agentRole === 'owner' && e.action === 'owner_approved')
  } catch {
    return false
  }
}

/**
 * Check if owner has explicitly rejected a mission (Rec 7).
 */
export async function hasOwnerRejection(missionId: string): Promise<boolean> {
  try {
    const log = await loadApprovalLog(missionId)
    return log.some((e) => e.agentRole === 'owner' && e.action === 'owner_rejected')
  } catch {
    return false
  }
}

/**
 * Mark a mission as owner-approved (called by the /approve Telegram command
 * or the dashboard "Approve" button).
 */
export async function markOwnerApproved(missionId: string, notes?: string): Promise<void> {
  await logApprovalEvent({
    missionId,
    stageId: 'owner_gate',
    round: 1,
    agentRole: 'owner',
    agentId: 'owner',
    action: 'owner_approved',
    feedback: notes ?? 'Owner approved via dashboard/Telegram',
  })
}

/**
 * Mark a mission as owner-rejected.
 */
export async function markOwnerRejected(missionId: string, reason?: string): Promise<void> {
  await logApprovalEvent({
    missionId,
    stageId: 'owner_gate',
    round: 1,
    agentRole: 'owner',
    agentId: 'owner',
    action: 'owner_rejected',
    feedback: reason ?? 'Owner rejected via dashboard/Telegram',
  })
}

/**
 * Mark a mission as completed.
 */
export async function markMissionCompleted(missionId: string, summary?: string): Promise<void> {
  await logApprovalEvent({
    missionId,
    stageId: 'final',
    round: 1,
    agentRole: 'system',
    agentId: 'system',
    action: 'completed',
    feedback: summary ?? 'Mission completed all stages',
  })
}

/**
 * Mark a mission as failed.
 */
export async function markMissionFailed(missionId: string, reason?: string): Promise<void> {
  await logApprovalEvent({
    missionId,
    stageId: 'final',
    round: 1,
    agentRole: 'system',
    agentId: 'system',
    action: 'failed',
    feedback: reason ?? 'Mission failed',
  })
}
