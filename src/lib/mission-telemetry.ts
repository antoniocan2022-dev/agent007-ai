/**
 * Mission Telemetry + Observability Engine.
 * Tracks real mission data and explicit autonomy evidence.
 */

import { db } from './db'
import { buildAutonomyTelemetrySummary, type AutonomyMissionEvidence, type AutonomyTelemetrySummary } from './autonomy/autonomy-telemetry'
import type { ApprovalLogEntry } from './approval-audit-log'

export const runtime = 'nodejs'

export interface MissionTelemetry {
  missionId: string; goal: string; startedAt: number; completedAt: number | null; duration: number | null
  status: 'running' | 'completed' | 'failed'; leadersUsed: string[]; toolsCalled: string[]; toolCallCount: number
  retries: number; memoryReads: number; memoryWrites: number; confidence: number; verificationScore: number
  verificationPassed: boolean; errors: string[]; cost: number; tokensUsed: number; latencyMs: number
  debateTriggered: boolean; executiveCorrections: number; autonomyEvidence?: AutonomyMissionEvidence
  failureOccurred?: boolean; resumedWithoutHumanRestart?: boolean; outcomeQuality?: number
}

export function startMissionTelemetry(goal: string): MissionTelemetry {
  return {
    missionId: `mission_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, goal: goal.slice(0, 200),
    startedAt: Date.now(), completedAt: null, duration: null, status: 'running', leadersUsed: [], toolsCalled: [],
    toolCallCount: 0, retries: 0, memoryReads: 0, memoryWrites: 0, confidence: 0, verificationScore: 0,
    verificationPassed: false, errors: [], cost: 0, tokensUsed: 0, latencyMs: 0, debateTriggered: false, executiveCorrections: 0,
  }
}

export function recordAutonomyEvidence(telemetry: MissionTelemetry, evidence: AutonomyMissionEvidence): void { telemetry.autonomyEvidence = { ...evidence } }
export function recordFailureOccurrence(telemetry: MissionTelemetry): void { telemetry.failureOccurred = true }
export function recordMissionResumption(telemetry: MissionTelemetry, resumedWithoutHumanRestart: boolean): void { telemetry.resumedWithoutHumanRestart = resumedWithoutHumanRestart }
export function recordOutcomeQuality(telemetry: MissionTelemetry, quality: number): boolean {
  if (!Number.isFinite(quality) || quality < 0 || quality > 100) return false
  telemetry.outcomeQuality = quality; return true
}

/** Persist an evidence update to the existing mission row without creating duplicates. */
export async function persistMissionTelemetryEvidence(telemetry: MissionTelemetry): Promise<boolean> {
  try {
    await db.memory.update({ where: { key: telemetry.missionId }, data: { value: JSON.stringify(telemetry) } })
    return true
  } catch (e: any) { console.error('[telemetry] Failed to persist evidence update:', e?.message); return false }
}

export function recordToolCall(telemetry: MissionTelemetry, toolName: string, tokensUsed = 0, cost = 0) {
  if (!telemetry.toolsCalled.includes(toolName)) telemetry.toolsCalled.push(toolName)
  telemetry.toolCallCount++; telemetry.tokensUsed += tokensUsed; telemetry.cost += cost
}
export function recordLeaderDispatch(telemetry: MissionTelemetry, leaderId: string) { if (!telemetry.leadersUsed.includes(leaderId)) telemetry.leadersUsed.push(leaderId) }
export function recordMemoryOp(telemetry: MissionTelemetry, type: 'read' | 'write') { if (type === 'read') telemetry.memoryReads++; else telemetry.memoryWrites++ }
export function recordRetry(telemetry: MissionTelemetry) { telemetry.retries++ }
export function recordError(telemetry: MissionTelemetry, error: string) { telemetry.errors.push(error.slice(0, 200)) }
export function recordVerification(telemetry: MissionTelemetry, score: number, passed: boolean) { telemetry.verificationScore = score; telemetry.verificationPassed = passed }
export function recordConfidence(telemetry: MissionTelemetry, confidence: number) { telemetry.confidence = confidence }
export function recordDebate(telemetry: MissionTelemetry) { telemetry.debateTriggered = true }
export function recordExecutiveCorrection(telemetry: MissionTelemetry) { telemetry.executiveCorrections++ }

/** Complete or refresh a mission record. The mission key is unique, so completion is idempotent. */
export async function completeMissionTelemetry(telemetry: MissionTelemetry, status: 'completed' | 'failed' = 'completed'): Promise<MissionTelemetry> {
  telemetry.completedAt = Date.now(); telemetry.duration = telemetry.completedAt - telemetry.startedAt; telemetry.status = status
  try {
    await db.memory.upsert({
      where: { key: telemetry.missionId },
      create: { key: telemetry.missionId, value: JSON.stringify(telemetry), category: 'mission_telemetry' },
      update: { value: JSON.stringify(telemetry), category: 'mission_telemetry' },
    })
  } catch (e: any) { console.error('[telemetry] Failed to store:', e?.message) }
  return telemetry
}

function evidenceFromApprovalLog(log: ApprovalLogEntry[]): AutonomyMissionEvidence | null {
  const hasCompletion = log.some((e) => e.action === 'completed'), hasFailure = log.some((e) => e.action === 'failed')
  const submittedStages = new Set(log.filter((e) => e.agentRole === 'team_leader' && e.action === 'submitted').map((e) => e.stageId))
  const approvedStages = new Set(log.filter((e) => e.agentRole === 'super_agent' && e.action === 'approved').map((e) => e.stageId))
  const ownerGate = log.some((e) => e.stageId === 'owner_gate'), ownerApproved = log.some((e) => e.action === 'owner_approved')
  const escalated = log.some((e) => e.action === 'escalated')
  const recoveredStage = log.some((e) => e.action === 'retry_submitted') && log.some((e) => e.agentRole === 'super_agent' && e.action === 'approved')
  if (!hasCompletion && !hasFailure && submittedStages.size === 0) return null
  const allSubmittedStagesVerified = submittedStages.size > 0 && [...submittedStages].every((stageId) => approvedStages.has(stageId))
  return { eligible: hasCompletion || hasFailure, executionAutonomous: submittedStages.size > 0, verificationIndependent: allSubmittedStagesVerified, recoveryAutonomous: recoveredStage, governancePassed: ownerGate ? ownerApproved : (!escalated && allSubmittedStagesVerified) }
}

export async function getAutonomyTelemetrySummary(): Promise<AutonomyTelemetrySummary> {
  try {
    const telemetryRecords = await db.memory.findMany({ where: { category: 'mission_telemetry' }, orderBy: { createdAt: 'desc' }, take: 500 })
    const evidence: AutonomyMissionEvidence[] = []; const explicitTelemetryMissionIds = new Set<string>()
    for (const record of telemetryRecords) { try { const telemetry = JSON.parse(record.value) as MissionTelemetry; if (telemetry.autonomyEvidence) { explicitTelemetryMissionIds.add(telemetry.missionId); evidence.push(telemetry.autonomyEvidence) } } catch {} }
    const auditRows = await db.userSetting.findMany({ where: { key: { startsWith: 'approval_log_' } }, take: 500 })
    for (const row of auditRows) {
      const missionId = row.key.slice('approval_log_'.length); if (explicitTelemetryMissionIds.has(missionId)) continue
      try { const log = JSON.parse(row.value) as ApprovalLogEntry[]; if (!Array.isArray(log)) continue; const derived = evidenceFromApprovalLog(log); if (derived) evidence.push(derived) } catch {}
    }
    return buildAutonomyTelemetrySummary(evidence)
  } catch (e: any) { console.error('[autonomy-telemetry] Failed to rebuild summary:', e?.message); return buildAutonomyTelemetrySummary([]) }
}

export interface ObservabilityMetrics {
  totalMissions: number; missionSuccessRate: number; averageLatencyMs: number; averageDurationMs: number; verificationFailureRate: number
  leaderDebateUsage: number; memoryHitRate: number; averageConfidence: number; executiveCorrectionRate: number; totalToolsCalled: number
  totalTokensUsed: number; totalCost: number; topLeaders: Array<{ leader: string; missions: number }>; topTools: Array<{ tool: string; calls: number }>
  recentMissions: Array<MissionTelemetry>; autonomy: AutonomyTelemetrySummary
}

export async function getObservabilityMetrics(): Promise<ObservabilityMetrics> {
  try {
    const rows = await db.memory.findMany({ where: { category: 'mission_telemetry' }, orderBy: { createdAt: 'desc' }, take: 500 })
    if (!rows.length) return { totalMissions: 0, missionSuccessRate: 0, averageLatencyMs: 0, averageDurationMs: 0, verificationFailureRate: 0, leaderDebateUsage: 0, memoryHitRate: 0, averageConfidence: 0, executiveCorrectionRate: 0, totalToolsCalled: 0, totalTokensUsed: 0, totalCost: 0, topLeaders: [], topTools: [], recentMissions: [], autonomy: buildAutonomyTelemetrySummary([]) }
    const missions: MissionTelemetry[] = rows.map(r => { try { return JSON.parse(r.value) } catch { return null } }).filter(Boolean)
    const total = missions.length, successful = missions.filter(m => m.status === 'completed'), withDebate = missions.filter(m => m.debateTriggered), withMemory = missions.filter(m => m.memoryReads > 0 || m.memoryWrites > 0), withCorrections = missions.filter(m => m.executiveCorrections > 0), verificationFailed = missions.filter(m => !m.verificationPassed)
    const leaderCounts: Record<string, number> = {}, toolCounts: Record<string, number> = {}
    for (const m of missions) { for (const l of m.leadersUsed) leaderCounts[l] = (leaderCounts[l] || 0) + 1; for (const t of m.toolsCalled) toolCounts[t] = (toolCounts[t] || 0) + 1 }
    const topLeaders = Object.entries(leaderCounts).sort((a,b) => b[1]-a[1]).slice(0,10).map(([leader, missions]) => ({ leader, missions })), topTools = Object.entries(toolCounts).sort((a,b) => b[1]-a[1]).slice(0,10).map(([tool, calls]) => ({ tool, calls }))
    return { totalMissions: total, missionSuccessRate: successful.length / total * 100, averageLatencyMs: missions.reduce((s,m) => s + (m.latencyMs || 0),0) / total, averageDurationMs: missions.reduce((s,m) => s + (m.duration || 0),0) / total, verificationFailureRate: verificationFailed.length / total * 100, leaderDebateUsage: withDebate.length / total * 100, memoryHitRate: withMemory.length / total * 100, averageConfidence: missions.reduce((s,m) => s + (m.confidence || 0),0) / total, executiveCorrectionRate: withCorrections.length / total * 100, totalToolsCalled: missions.reduce((s,m) => s + m.toolCallCount,0), totalTokensUsed: missions.reduce((s,m) => s + m.tokensUsed,0), totalCost: missions.reduce((s,m) => s + m.cost,0), topLeaders, topTools, recentMissions: missions.slice(0,10), autonomy: await getAutonomyTelemetrySummary() }
  } catch (e: any) {
    console.error('[observability] Failed:', e?.message)
    return { totalMissions: 0, missionSuccessRate: 0, averageLatencyMs: 0, averageDurationMs: 0, verificationFailureRate: 0, leaderDebateUsage: 0, memoryHitRate: 0, averageConfidence: 0, executiveCorrectionRate: 0, totalToolsCalled: 0, totalTokensUsed: 0, totalCost: 0, topLeaders: [], topTools: [], recentMissions: [], autonomy: buildAutonomyTelemetrySummary([]) }
  }
}
