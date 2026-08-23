import { getCapabilityMetadata, listCapabilityMetadata } from './autonomy/capability-registry'
import { getSubagentGovernanceProfile, type SubagentClass, type TaskType } from './subagent-governance'
import type { Subagent } from './subagents'

export type MissionCapability =
  | 'RESEARCH.READ'
  | 'MISSION.INTERNAL_BOOKKEEPING'
  | 'MISSION.INTERNAL_ARTIFACT_GENERATION'
  | 'MISSION.VERIFICATION'
  | 'MISSION.INTERNAL_ANALYSIS'
  | 'DEVELOPMENT.EXECUTE_CODE'
  | 'DEVELOPMENT.MUTATE_SOURCE_OR_DATA'

export type MissionStageCapability = { stage: string; requiredTaskType: TaskType; requiredCapabilities: readonly MissionCapability[]; rationale: string }
export type CapabilityReadiness = {
  ready: boolean; leaderId: string; leaderName: string; stage: string; requiredTaskType: TaskType;
  requiredCapabilities: readonly MissionCapability[]; availableCapabilities: readonly MissionCapability[];
  governanceProfilePresent: boolean; taskTypeAllowed: boolean; requiredCapabilitiesAvailable: boolean;
  agentPresent: boolean; agentEnabled: boolean; toolCount: number; verificationTier: string | null;
  riskLevel: string | null; subagentClass: SubagentClass | null; missing: string[]
}

const STAGE_CAPABILITIES: Record<string, MissionStageCapability> = {
  PLANNED: { stage: 'PLANNED', requiredTaskType: 'research', requiredCapabilities: ['RESEARCH.READ', 'MISSION.INTERNAL_BOOKKEEPING'], rationale: 'Discovery and evidence gathering before execution.' },
  IN_PROGRESS: { stage: 'IN_PROGRESS', requiredTaskType: 'creative', requiredCapabilities: ['RESEARCH.READ', 'MISSION.INTERNAL_BOOKKEEPING', 'MISSION.INTERNAL_ARTIFACT_GENERATION'], rationale: 'Creation and preparation of the primary mission deliverable.' },
  REVIEW: { stage: 'REVIEW', requiredTaskType: 'analysis', requiredCapabilities: ['MISSION.VERIFICATION', 'MISSION.INTERNAL_ANALYSIS', 'RESEARCH.READ'], rationale: 'Independent quality, accuracy, and evidence review.' },
  DELIVERED: { stage: 'DELIVERED', requiredTaskType: 'coding', requiredCapabilities: ['DEVELOPMENT.MUTATE_SOURCE_OR_DATA', 'DEVELOPMENT.EXECUTE_CODE', 'MISSION.VERIFICATION'], rationale: 'Technical delivery, integration, or governed implementation work.' },
  VERIFIED: { stage: 'VERIFIED', requiredTaskType: 'analysis', requiredCapabilities: ['MISSION.VERIFICATION', 'MISSION.INTERNAL_ANALYSIS'], rationale: 'Production verification, monitoring, KPI and readiness analysis.' },
  OWNER_APPROVAL: { stage: 'OWNER_APPROVAL', requiredTaskType: 'reasoning', requiredCapabilities: ['MISSION.VERIFICATION', 'MISSION.INTERNAL_BOOKKEEPING'], rationale: 'Executive governance review; autonomous approval is prohibited.' },
  COMPLETED: { stage: 'COMPLETED', requiredTaskType: 'reasoning', requiredCapabilities: [], rationale: 'Terminal mission state.' },
}

export function capabilityRequirementForStage(stage: string): MissionStageCapability | undefined { return STAGE_CAPABILITIES[stage] }
export function capabilitiesForTools(tools: readonly string[]): MissionCapability[] { const capabilities = new Set<MissionCapability>(); for (const tool of tools) { const metadata = getCapabilityMetadata(tool); if (metadata) capabilities.add(metadata.capability as MissionCapability) } return [...capabilities].sort() }
export function isCapabilitySetSatisfied(required: readonly MissionCapability[], available: readonly MissionCapability[]): boolean { const availableSet = new Set(available); return required.every((capability) => availableSet.has(capability)) }

export function assessBuiltInCapabilityReadiness(stage: string, agent: Pick<Subagent, 'id' | 'name' | 'allowedTools' | 'enabled'>): CapabilityReadiness {
  const requirement = STAGE_CAPABILITIES[stage] ?? { stage, requiredTaskType: 'reasoning' as TaskType, requiredCapabilities: ['MISSION.INTERNAL_BOOKKEEPING'] as const, rationale: 'Generic governed reasoning fallback.' }
  const profile = getSubagentGovernanceProfile(agent.id)
  const availableCapabilities = capabilitiesForTools(agent.allowedTools)
  const governanceProfilePresent = Boolean(profile)
  const taskTypeAllowed = Boolean(profile?.taskTypes.includes(requirement.requiredTaskType))
  const agentEnabled = agent.enabled !== false
  const requiredCapabilitiesAvailable = isCapabilitySetSatisfied(requirement.requiredCapabilities, availableCapabilities)
  const missing = requirement.requiredCapabilities.filter((capability) => !availableCapabilities.includes(capability)).map((capability) => `capability:${capability}`)
  if (!governanceProfilePresent) missing.unshift('governance_profile')
  if (!agentEnabled) missing.push('enabled_subagent')
  if (!taskTypeAllowed) missing.push(`task_type:${requirement.requiredTaskType}`)
  return {
    ready: missing.length === 0, leaderId: agent.id, leaderName: agent.name, stage,
    requiredTaskType: requirement.requiredTaskType, requiredCapabilities: requirement.requiredCapabilities,
    availableCapabilities, governanceProfilePresent, taskTypeAllowed, requiredCapabilitiesAvailable,
    agentPresent: true, agentEnabled, toolCount: agent.allowedTools.length,
    verificationTier: profile?.verificationTier ?? null, riskLevel: profile?.riskLevel ?? null,
    subagentClass: profile?.class ?? null, missing,
  }
}

export async function assessMissionCapabilityReadiness(stage: string, leaderId: string): Promise<CapabilityReadiness> {
  const { getAllSubagents } = await import('./subagents')
  const agent = (await getAllSubagents({ includeDisabled: false })).find((candidate) => candidate.id === leaderId)
  if (agent) return assessBuiltInCapabilityReadiness(stage, agent)
  const profile = getSubagentGovernanceProfile(leaderId)
  const requirement = STAGE_CAPABILITIES[stage] ?? { stage, requiredTaskType: 'reasoning' as TaskType, requiredCapabilities: ['MISSION.INTERNAL_BOOKKEEPING'] as const, rationale: 'Generic governed reasoning fallback.' }
  return {
    ready: false, leaderId, leaderName: leaderId, stage, requiredTaskType: requirement.requiredTaskType,
    requiredCapabilities: requirement.requiredCapabilities, availableCapabilities: [],
    governanceProfilePresent: Boolean(profile), taskTypeAllowed: false, requiredCapabilitiesAvailable: false,
    agentPresent: false, agentEnabled: false, toolCount: 0, verificationTier: profile?.verificationTier ?? null,
    riskLevel: profile?.riskLevel ?? null, subagentClass: profile?.class ?? null, missing: ['subagent'],
  }
}

export function listMissionCapabilityRequirements(): MissionStageCapability[] { return Object.values(STAGE_CAPABILITIES) }

export function validateCapabilityProfileCoverage(): string[] {
  const errors: string[] = []
  const registeredCapabilities = new Set(Object.values(listCapabilityMetadata()).map((metadata) => metadata.capability))
  for (const requirement of Object.values(STAGE_CAPABILITIES)) {
    for (const capability of requirement.requiredCapabilities) if (!registeredCapabilities.has(capability)) errors.push(`Unregistered mission capability: ${capability}.`)
  }
  return [...new Set(errors)]
}
