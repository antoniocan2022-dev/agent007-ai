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
  resolvedFrom: 'heartbeat'
}

function normalizeMissionId(value: string): string {
  const missionId = value.trim()
  if (!missionId) throw new Error('MISSION_CONTEXT_MISSING: missionId is required.')
  return missionId
}

/**
 * Resolve mission context only from the canonical durable heartbeat.
 * The resolver never invents a title, objective, pipeline type, or status from
 * conversational text or incomplete audit entries.
 */
export async function resolveMissionContext(missionIdInput: string): Promise<MissionContextResolution> {
  const missionId = normalizeMissionId(missionIdInput)
  const heartbeat = await loadHeartbeat(missionId)
  if (!heartbeat) {
    throw new Error(`MISSION_CONTEXT_NOT_FOUND: no complete durable heartbeat exists for ${missionId}.`)
  }

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

export function assertMissionContextMatches(input: {
  resolved: MissionContextResolution
  expectedPipelineType?: string
  expectedObjective?: string
}): void {
  const { resolved, expectedPipelineType, expectedObjective } = input
  if (expectedPipelineType && resolved.pipelineType !== expectedPipelineType) {
    throw new Error(`MISSION_CONTEXT_CONFLICT: expected pipeline "${expectedPipelineType}" but resolved "${resolved.pipelineType}".`)
  }
  if (expectedObjective && resolved.objective.trim() !== expectedObjective.trim()) {
    throw new Error('MISSION_CONTEXT_CONFLICT: supplied objective does not match the durable mission objective.')
  }
}
