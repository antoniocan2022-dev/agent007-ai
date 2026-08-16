/**
 * approval-audit-log.ts — UPGRADE #140 (Audit Trail — Rec 5)
 * ===================================================================
 * Every approval, rejection, retry, escalation, owner action, and artifact
 * handoff failure gets logged here with timestamp + agent role + score + feedback.
 *
 * Storage: UserSetting table (key = `approval_log_${missionId}`)
 * Why not a new Prisma model? Because adding models requires migration
 * on Vercel, and UserSetting already works. We store the audit log as a
 * JSON array in a single row per mission.
 *
 * API: /api/missions/[id]/audit-trail
 */

import { db } from './db'

export type ApprovalAction =
  | 'started'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'retry_submitted'
  | 'escalated'
  | 'owner_approved'
  | 'owner_rejected'
  | 'paused'
  | 'resumed'
  | 'completed'
  | 'failed'
  | 'handoff_failed'

export type AgentRole = 'team_leader' | 'super_agent' | 'ceo' | 'owner' | 'system' | 'artifact_ledger'

export interface ApprovalLogEntry {
  id: string
  timestamp: string
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

    const existing = await db.userSetting.findFirst({ where: { userId: user.id, key } })
    let log: ApprovalLogEntry[] = []
    if (existing) {
      try { log = JSON.parse(existing.value) as ApprovalLogEntry[] } catch { log = [] }
    }

    log.push(entry)
    if (log.length > 200) log = log.slice(-200)

    const value = JSON.stringify(log)
    if (existing) {
      await db.userSetting.update({ where: { id: existing.id }, data: { value } })
    } else {
      await db.userSetting.create({ data: { userId: user.id, key, value } })
    }
  } catch (e: any) {
    console.warn('[approval-audit-log] Failed to log:', e?.message?.slice(0, 100))
  }
}

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

export async function hasOwnerApproval(missionId: string): Promise<boolean> {
  try {
    const log = await loadApprovalLog(missionId)
    return log.some((e) => e.agentRole === 'owner' && e.action === 'owner_approved')
  } catch {
    return false
  }
}

export async function hasOwnerRejection(missionId: string): Promise<boolean> {
  try {
    const log = await loadApprovalLog(missionId)
    return log.some((e) => e.agentRole === 'owner' && e.action === 'owner_rejected')
  } catch {
    return false
  }
}
