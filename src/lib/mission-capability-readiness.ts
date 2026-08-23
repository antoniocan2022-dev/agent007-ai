import { getAllGovernanceProfiles, getSubagentGovernanceProfile, type SubagentClass, type TaskType } from './subagent-governance'
import { getAllSubagents } from './subagents'

export type MissionStageCapability = {
  stage: string
  requiredTaskType: TaskType
  requiredTools: readonly string[]
  rationale: string
}

export type CapabilityReadiness = {
  ready: boolean
  leaderId: string
  leaderName: string
  stage: string
  requiredTaskType: TaskType
  requiredTools: readonly string[]
  governanceProfilePresent: boolean
  taskTypeAllowed: boolean
  requiredToolsAvailable: boolean
  agentPresent: boolean
  agentEnabled: boolean
  toolCount: number
  verificationTier: string | null
  riskLevel: string | null
  subagentClass: SubagentClass | null
  missing: string[]
}

const STAGE_CAPABILITIES: Record<string, MissionStageCapability> = {
  PLANNED: { stage: 'PLANNED', requiredTaskType: 'research', requiredTools: ['web_search', 'page_reader', 'source_read', 'memory_recall'], rationale: 'Discovery and evidence gathering before execution.' },
  IN_PROGRESS: { stage: 'IN_PROGRESS', requiredTaskType: 'creative', requiredTools: ['ai_content_factory', 'file_write', 'memory_recall'], rationale: 'Creation/building of the primary mission deliverable.' },
  REVIEW: { stage: 'REVIEW', requiredTaskType: 'analysis', requiredTools: ['quality_scorer_v2', 'accuracy_checker', 'memory_recall'], rationale: 'Independent quality and outcome review.' },
  DELIVERED: { stage: 'DELIVERED', requiredTaskType: 'coding', requiredTools: ['code_exec', 'file_write', 'file_read', 'result_verifier_v2'], rationale: 'Technical delivery, integration, or deployment work.' },
  VERIFIED: { stage: 'VERIFIED', requiredTaskType: 'analysis', requiredTools: ['accuracy_checker', 'quality_scorer_v2', 'memory_recall'], rationale: 'Production verification, monitoring, KPI and readiness analysis.' },
  OWNER_APPROVAL: { stage: 'OWNER_APPROVAL', requiredTaskType: 'reasoning', requiredTools: ['memory_recall', 'quality_scorer_v2'], rationale: 'Executive decision and governance review; no autonomous approval is allowed.' },
  COMPLETED: { stage: 'COMPLETED', requiredTaskType: 'reasoning', requiredTools: [], rationale: 'Terminal mission state.' },
}

export function capabilityRequirementForStage(stage: string): MissionStageCapability | undefined {
  return STAGE_CAPABILITIES[stage]
}

export async function assessMissionCapabilityReadiness(stage: string, leaderId: string): Promise<CapabilityReadiness> {
  const requirement = STAGE_CAPABILITIES[stage] ?? {
    stage,
    requiredTaskType: 'reasoning' as TaskType,
    requiredTools: ['memory_recall'],
    rationale: 'Generic governed reasoning fallback.',
  }
  const profile = getSubagentGovernanceProfile(leaderId)
  const subagents = await getAllSubagents({ includeDisabled: false })
  const agent = subagents.find((candidate: any) => candidate.id === leaderId)
  const allowedTools = Array.isArray(agent?.allowedTools) ? agent.allowedTools : []
  const governanceProfilePresent = Boolean(profile)
  const taskTypeAllowed = Boolean(profile?.taskTypes.includes(requirement.requiredTaskType))
  const requiredToolsAvailable = requirement.requiredTools.every((tool) => allowedTools.includes(tool))
  const agentPresent = Boolean(agent)
  const agentEnabled = Boolean(agent?.enabled !== false)
  const toolCount = allowedTools.length
  const missing: string[] = []

  if (!governanceProfilePresent) missing.push('governance_profile')
  if (!agentPresent) missing.push('subagent')
  if (!agentEnabled) missing.push('enabled_subagent')
  if (!taskTypeAllowed) missing.push(`task_type:${requirement.requiredTaskType}`)
  for (const tool of requirement.requiredTools) if (!allowedTools.includes(tool)) missing.push(`tool:${tool}`)

  return {
    ready: missing.length === 0,
    leaderId,
    leaderName: profile?.id === leaderId ? profile.division : agent?.name ?? leaderId,
    stage,
    requiredTaskType: requirement.requiredTaskType,
    requiredTools: requirement.requiredTools,
    governanceProfilePresent,
    taskTypeAllowed,
    requiredToolsAvailable,
    agentPresent,
    agentEnabled,
    toolCount,
    verificationTier: profile?.verificationTier ?? null,
    riskLevel: profile?.riskLevel ?? null,
    subagentClass: profile?.class ?? null,
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
