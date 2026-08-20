import { loadApprovalLog } from './approval-audit-log'
import { loadHeartbeat, type MissionHeartbeat } from './mission-heartbeat'

export type MissionContextResolution = {
  missionId: string
  missionTitle: string
  objective: string
  pipelineType: string
  status: MissionHeartbeat['status']
  requiresOwnerApproval: boolean
  currentStage: MissionHeartbeat['currentStage']
  completedStages: MissionHeartbeat['completedStages']
  resolvedFrom: 'heartbeat' | 'audit_log'
}

function normalizeMissionId(value: string): string {
  const missionId = value.trim()
  if (!missionId) throw new Error('MISSION_CONTEXT_MISSING: missionId is required.')
  return missionId
}

/**
 * Resolve a mission by its canonical identity. No conversational guesswork is
 * permitted: a mission must exist in the durable heartbeat or audit trail.
 */
export async function resolveMissionContext(missionIdInput: string): Promise<MissionContextResolution> {
  const missionId = normalizeMissionId(missionIdInput)
  const heartbeat = await loadHeartbeat(missionId)
  if (heartbeat) {
    return {
      missionId: heartbeat.missionId,
      missionTitle: heartbeat.missionTitle,
      objective: heartbeat.objective,
      pipelineType: heartbeat.pipelineType,
      status: heartbeat.status,
      requiresOwnerApproval: heartbeat.requiresOwnerApproval,
      currentStage: heartbeat.currentStage,
      completedStages: heartbeat.completedStages,
      resolvedFrom: 'heartbeat',
    }
  }

  const log = await loadApprovalLog(missionId)
  if (log.length === 0) {
    throw new Error(`MISSION_NOT_FOUND: no durable mission context exists for ${missionId}.`)
  }

  const first = log[0]
  const completedStages = log
    .filter((entry) => entry.action === 'approved' || entry.action === 'completed')
    .map((entry) => ({
      stageId: entry.stageId,
      stageName: entry.stageId,
      team: entry.agentId,
      leader: entry.agentId,
      startedAt: entry.timestamp ?? null,
      completedAt: entry.timestamp ?? null,
      durationMs: null,
      rounds: entry.round,
      finalScore: entry.score ?? null,
    }))

  return {
    missionId,
    missionTitle: missionId,
    objective: first.feedback ?? '',
    pipelineType: 'unknown',
    status: 'idle',
    requiresOwnerApproval: false,
    currentStage: null,
    completedStages,
    resolvedFrom: 'audit_log',
  }
}

export function assertMissionContextMatches(input: {
  resolved: MissionContextResolution
  expectedPipelineType?: string
  expectedObjective?: string
}): void {
  const { resolved, expectedPipelineType, expectedObjective } = input
  if (expectedPipelineType && resolved.pipelineType !== 'unknown' && resolved.pipelineType !== expectedPipelineType) {
    throw new Error(`MISSION_CONTEXT_CONFLICT: expected pipeline "${expectedPipelineType}" but resolved "${resolved.pipelineType}".`)
  }
  if (expectedObjective && resolved.objective && resolved.objective.trim() !== expectedObjective.trim()) {
    throw new Error('MISSION_CONTEXT_CONFLICT: supplied objective does not match the durable mission objective.')
  }
}
