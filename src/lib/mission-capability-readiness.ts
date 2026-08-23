import { getAllGovernanceProfiles, getSubagentGovernanceProfile, type TaskType } from './subagent-governance'
import { getAllSubagents } from './subagents'

export type MissionStageCapability = {
  stage: string
  requiredTaskType: TaskType
  rationale: string
}

export type CapabilityReadiness = {
  ready: boolean
  leaderId: string
  leaderName: string
  stage: string
  requiredTaskType: TaskType
  governanceProfilePresent: boolean
  taskTypeAllowed: boolean
  agentPresent: boolean
  agentEnabled: boolean
  toolCount: number
  verificationTier: string | null
  riskLevel: string | null
  missing: string[]
}

const STAGE_CAPABILITIES: Record<string, MissionStageCapability> = {
  PLANNED: { stage: 'PLANNED', requiredTaskType: 'research', rationale: 'Discovery and evidence gathering before execution.' },
  IN_PROGRESS: { stage: 'IN_PROGRESS', requiredTaskType: 'creative', rationale: 'Creation/building of the primary mission deliverable.' },
  REVIEW: { stage: 'REVIEW', requiredTaskType: 'analysis', rationale: 'Independent quality and outcome review.' },
  DELIVERED: { stage: 'DELIVERED', requiredTaskType: 'coding', rationale: 'Technical delivery, integration, or deployment work.' },
  VERIFIED: { stage: 'VERIFIED', requiredTaskType: 'operations', rationale: 'Production verification, monitoring, and readiness checks.' },
  OWNER_APPROVAL: { stage: 'OWNER_APPROVAL', requiredTaskType: 'reasoning', rationale: 'Executive decision and governance review.' },
  COMPLETED: { stage: 'COMPLETED', requiredTaskType: 'reasoning', rationale: 'Terminal mission state.' },
}

export function capabilityRequirementForStage(stage: string): MissionStageCapability | undefined {
  return STAGE_CAPABILITIES[stage]
}

export async function assessMissionCapabilityReadiness(stage: string, leaderId: string): Promise<CapabilityReadiness> {
  const requirement = STAGE_CAPABILITIES[stage] ?? {
    stage,
    requiredTaskType: 'reasoning' as TaskType,
    rationale: 'Generic governed reasoning fallback.',
  }
  const profile = getSubagentGovernanceProfile(leaderId)
  const subagents = await getAllSubagents({ includeDisabled: false })
  const agent = subagents.find((candidate: any) => candidate.id === leaderId)
  const governanceProfilePresent = Boolean(profile)
  const taskTypeAllowed = Boolean(profile?.taskTypes.includes(requirement.requiredTaskType))
  const agentPresent = Boolean(agent)
  const agentEnabled = Boolean(agent?.enabled !== false)
  const toolCount = Array.isArray(agent?.allowedTools) ? agent.allowedTools.length : 0
  const missing: string[] = []

  if (!governanceProfilePresent) missing.push('governance_profile')
  if (!agentPresent) missing.push('subagent')
  if (!agentEnabled) missing.push('enabled_subagent')
  if (!taskTypeAllowed) missing.push(`task_type:${requirement.requiredTaskType}`)
  if (toolCount === 0) missing.push('tools')

  return {
    ready: missing.length === 0,
    leaderId,
    leaderName: profile?.division ?? agent?.name ?? leaderId,
    stage,
    requiredTaskType: requirement.requiredTaskType,
    governanceProfilePresent,
    taskTypeAllowed,
    agentPresent,
    agentEnabled,
    toolCount,
    verificationTier: profile?.verificationTier ?? null,
    riskLevel: profile?.riskLevel ?? null,
    missing,
  }
}

export function listMissionCapabilityRequirements(): MissionStageCapability[] {
  return Object.values(STAGE_CAPABILITIES)
}

export function validateCapabilityProfileCoverage(): string[] {
  const errors: string[] = []
  const profiles = getAllGovernanceProfiles()
  if (profiles.length === 0) errors.push('No governance profiles are registered.')
  for (const requirement of Object.values(STAGE_CAPABILITIES)) {
    const matches = profiles.filter((profile) => profile.taskTypes.includes(requirement.requiredTaskType))
    if (matches.length === 0) errors.push(`No governance profile supports mission stage ${requirement.stage} task type ${requirement.requiredTaskType}.`)
  }
  return errors
}
