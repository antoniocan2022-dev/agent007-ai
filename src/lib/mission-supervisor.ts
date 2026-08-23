import { db } from './db'
import { assertMissionTransition } from './architecture-control-plane'
import { getActiveMissionDB, listActiveMissionsDB, saveActiveMissionDB } from './active-missions-db'
import { runCeoCognitiveLifecycle } from './ceo-cognitive-lifecycle'
import { getAllSubagents, runSubagent } from './subagents'
import { assessMissionCapabilityReadiness, capabilityRequirementForStage } from './mission-capability-readiness'
import { getAllGovernanceProfiles, getSubagentGovernanceProfile } from './subagent-governance'
import type { ActiveMission, MissionStage } from './active-missions'

const SUPERVISOR_PREFIX = 'mission_supervisor_state_'
const DEFAULT_STALE_MINUTES = 30
const DEFAULT_MAX_MISSIONS_PER_TICK = 5
const DEFAULT_MAX_LEADER_RUNS_PER_TICK = 2
const STAGES: MissionStage[] = ['PLANNED', 'IN_PROGRESS', 'REVIEW', 'DELIVERED', 'VERIFIED', 'OWNER_APPROVAL', 'COMPLETED']

export type MissionSupervisorAction = 'RUN_LEADER' | 'ADVANCE_STAGE' | 'WAIT_FOR_ARTIFACT' | 'REPLAN_REQUIRED' | 'REPLAN_AND_CONTINUE' | 'BLOCKED' | 'OWNER_APPROVAL' | 'COMPLETED' | 'NO_ACTION'

export interface MissionSupervisorState {
  lastHeartbeatAt: string | null
  lastActionAt: string | null
  lastAction: MissionSupervisorAction | null
  consecutiveFailures: number
  totalActions: number
  blocker: string | null
  nextAction: string | null
}

export interface MissionSupervisorDecision {
  missionId: string
  stage: MissionStage
  action: MissionSupervisorAction
  reason: string
  leaderId: string | null
  leaderName: string | null
  stale: boolean
  capabilityReady: boolean
  artifactRequired: string | null
  artifactVerified: boolean
  state: MissionSupervisorState
}

export interface MissionSupervisorRunResult {
  startedAt: string
  finishedAt: string
  inspected: number
  acted: number
  blocked: number
  advanced: number
  failures: number
  decisions: MissionSupervisorDecision[]
}

function emptyState(): MissionSupervisorState {
  return { lastHeartbeatAt: null, lastActionAt: null, lastAction: null, consecutiveFailures: 0, totalActions: 0, blocker: null, nextAction: null }
}

async function getOperatorUserId(): Promise<string | null> {
  try { return (await db.user.findFirst({ orderBy: { createdAt: 'asc' } }))?.id ?? null } catch { return null }
}

async function readState(missionId: string): Promise<MissionSupervisorState> {
  const userId = await getOperatorUserId()
  if (!userId) return emptyState()
  const row = await db.userSetting.findFirst({ where: { userId, key: `${SUPERVISOR_PREFIX}${missionId}` } })
  if (!row) return emptyState()
  try {
    const parsed = JSON.parse(row.value) as Partial<MissionSupervisorState>
    return {
      lastHeartbeatAt: parsed.lastHeartbeatAt ?? null,
      lastActionAt: parsed.lastActionAt ?? null,
      lastAction: parsed.lastAction ?? null,
      consecutiveFailures: parsed.consecutiveFailures ?? 0,
      totalActions: parsed.totalActions ?? 0,
      blocker: parsed.blocker ?? null,
      nextAction: parsed.nextAction ?? null,
    }
  } catch { return emptyState() }
}

async function writeState(missionId: string, state: MissionSupervisorState): Promise<void> {
  const userId = await getOperatorUserId()
  if (!userId) return
  const key = `${SUPERVISOR_PREFIX}${missionId}`
  const existing = await db.userSetting.findFirst({ where: { userId, key } })
  const value = JSON.stringify(state)
  if (existing) await db.userSetting.update({ where: { id: existing.id }, data: { value } })
  else await db.userSetting.create({ data: { userId, key, value } })
}

function minutesSince(timestamp: string | null, nowMs: number): number {
  if (!timestamp) return Number.POSITIVE_INFINITY
  const time = Date.parse(timestamp)
  if (!Number.isFinite(time)) return Number.POSITIVE_INFINITY
  return Math.max(0, (nowMs - time) / 60_000)
}

function activeHandoff(mission: ActiveMission) { return mission.chain.find((handoff) => handoff.stage === mission.currentStage) ?? null }

async function appendSystemLog(mission: ActiveMission, message: string): Promise<void> {
  mission.log.push({ timestamp: new Date().toISOString(), actor: 'MISSION_SUPERVISOR', stage: mission.currentStage, message })
  mission.updatedAt = new Date().toISOString()
  await saveActiveMissionDB(mission)
}

async function advanceDurableMission(mission: ActiveMission): Promise<ActiveMission> {
  const currentIndex = STAGES.indexOf(mission.currentStage)
  if (currentIndex < 0 || currentIndex >= STAGES.length - 1) return mission
  const current = activeHandoff(mission)
  if (!current) return mission
  if (mission.currentStage === 'OWNER_APPROVAL') return mission
  if (current.artifactRequired !== 'none' && (!current.artifactValue || !current.artifactVerified)) return mission

  current.status = 'done'
  current.completedAt = current.completedAt ?? new Date().toISOString()
  const nextStage = STAGES[currentIndex + 1]
  assertMissionTransition(mission.currentStage, nextStage)
  mission.currentStage = nextStage
  const next = activeHandoff(mission)
  if (next) {
    next.status = 'active'
    next.startedAt = next.startedAt ?? new Date().toISOString()
  }
  mission.updatedAt = new Date().toISOString()
  mission.log.push({ timestamp: new Date().toISOString(), actor: current.leader || 'MISSION_SUPERVISOR', stage: mission.currentStage, message: `Supervisor advanced mission after verified completion: ${current.stage} → ${nextStage}.` })
  await saveActiveMissionDB(mission)
  return mission
}

async function findReplanCandidate(stage: MissionStage, currentLeaderId: string): Promise<{ id: string; name: string } | null> {
  const currentProfile = getSubagentGovernanceProfile(currentLeaderId)
  const requirement = capabilityRequirementForStage(stage)
  if (!currentProfile || !requirement || currentProfile.riskLevel === 'critical' || stage === 'OWNER_APPROVAL') return null
  const agents = await getAllSubagents({ includeDisabled: false })
  const profiles = getAllGovernanceProfiles()
  const candidates = profiles
    .filter((profile) => profile.id !== currentLeaderId)
    .filter((profile) => profile.class === currentProfile.class)
    .filter((profile) => profile.taskTypes.includes(requirement.requiredTaskType))
    .filter((profile) => agents.some((agent: any) => agent.id === profile.id && agent.enabled !== false))
  for (const candidate of candidates) {
    const readiness = await assessMissionCapabilityReadiness(stage, candidate.id)
    if (readiness.ready) return { id: candidate.id, name: agents.find((agent: any) => agent.id === candidate.id)?.name ?? candidate.id }
  }
  return null
}

async function applyReplanIfSafe(mission: ActiveMission): Promise<{ applied: boolean; reason: string }> {
  const handoff = activeHandoff(mission)
  if (!handoff) return { applied: false, reason: 'No current stage handoff exists.' }
  const candidate = await findReplanCandidate(mission.currentStage, handoff.team)
  if (!candidate) return { applied: false, reason: 'No safe same-class replacement leader is available.' }
  const previous = `${handoff.team}/${handoff.leader}`
  handoff.team = candidate.id
  handoff.leader = candidate.name
  handoff.status = 'active'
  handoff.notes = `${handoff.notes ? `${handoff.notes} ` : ''}Supervisor reassigned from ${previous} to ${candidate.id} after capability readiness failure.`.trim()
  mission.updatedAt = new Date().toISOString()
  mission.log.push({ timestamp: new Date().toISOString(), actor: 'MISSION_SUPERVISOR', stage: mission.currentStage, message: `SAFE REPLAN APPLIED — ${previous} → ${candidate.id}.` })
  await saveActiveMissionDB(mission)
  return { applied: true, reason: `Reassigned stage to compliant ${candidate.id}.` }
}

function buildLeaderTask(mission: ActiveMission, leaderId: string, leaderName: string, requiredType: string): string {
  const handoff = activeHandoff(mission)
  return [
    `[AUTONOMOUS MISSION SUPERVISOR — Mission ${mission.id}]`,
    `You are ${leaderName} (${leaderId}) responsible for stage ${mission.currentStage}.`,
    `Mission: ${mission.title}`,
    `Description: ${mission.description}`,
    `Required task type: ${requiredType}`,
    `Required artifact type: ${handoff?.artifactRequired ?? 'none'}`,
    '',
    'Execute the next useful step within your authority and available capabilities.',
    'Do not claim completion without producing or referencing the required artifact.',
    'If blocked, state the exact blocker, missing evidence, and smallest next action that would unblock the stage.',
    'Return a concise execution report including accomplishments, blocker, artifact, verification needed, and next action.',
  ].join('\n')
}

async function runLeaderOnce(mission: ActiveMission, leaderId: string, leaderName: string, requiredType: string): Promise<string> {
  if (leaderId === 'ceo' || leaderName.toLowerCase() === 'ceo') {
    const result = await runCeoCognitiveLifecycle({
      missionId: mission.id,
      contextualEvidence: `Mission ${mission.id}\nStage ${mission.currentStage}\nTitle ${mission.title}\nDescription ${mission.description}`,
      verification: 'enhanced',
      messages: [
        { role: 'system', content: 'You are supervising an autonomous mission. Never claim an artifact, deployment, approval, or outcome that is not actually recorded.' },
        { role: 'user', content: buildLeaderTask(mission, leaderId, leaderName, requiredType) },
      ],
      timeoutMs: 50_000,
    })
    return result.content
  }
  const subagents = await getAllSubagents({ includeDisabled: false })
  const subagent = subagents.find((candidate: any) => candidate.id === leaderId)
  if (!subagent) throw new Error(`No enabled subagent found for leader '${leaderId}'.`)
  const result = await runSubagent({
    subagentId: subagent.id,
    task: buildLeaderTask(mission, leaderId, leaderName, requiredType),
    dispatchId: `mission_supervisor_${mission.id}_${Date.now()}`,
    attachments: [], language: 'en', emit: async () => {}, parentConversationId: `mission_${mission.id}`,
  })
  return result.answer || ''
}

function detectProgressArtifact(text: string, requiredArtifact: string | null): string | null {
  if (!requiredArtifact || requiredArtifact === 'none') return null
  if (requiredArtifact === 'url') return text.match(/https?:\/\/[^\s)]+/i)?.[0] ?? null
  return null
}

export async function inspectMission(mission: ActiveMission, options?: { staleMinutes?: number }): Promise<MissionSupervisorDecision> {
  const now = Date.now()
  const handoff = activeHandoff(mission)
  const state = await readState(mission.id)
  const staleMinutes = options?.staleMinutes ?? DEFAULT_STALE_MINUTES
  const stale = minutesSince(mission.updatedAt, now) >= staleMinutes

  if (mission.currentStage === 'COMPLETED') return { missionId: mission.id, stage: mission.currentStage, action: 'COMPLETED', reason: 'Mission is already completed.', leaderId: handoff?.team ?? null, leaderName: handoff?.leader ?? null, stale: false, capabilityReady: true, artifactRequired: handoff?.artifactRequired ?? null, artifactVerified: handoff?.artifactVerified ?? true, state }
  if (mission.currentStage === 'OWNER_APPROVAL') return { missionId: mission.id, stage: mission.currentStage, action: 'OWNER_APPROVAL', reason: 'Owner approval is a deliberate governance boundary and cannot be auto-approved by the supervisor.', leaderId: handoff?.team ?? null, leaderName: handoff?.leader ?? null, stale, capabilityReady: true, artifactRequired: handoff?.artifactRequired ?? 'none', artifactVerified: handoff?.artifactVerified ?? true, state }
  if (!handoff) return { missionId: mission.id, stage: mission.currentStage, action: 'REPLAN_REQUIRED', reason: 'Current mission stage has no registered handoff.', leaderId: null, leaderName: null, stale: true, capabilityReady: false, artifactRequired: null, artifactVerified: false, state }

  const readiness = await assessMissionCapabilityReadiness(mission.currentStage, handoff.team)
  if (!readiness.ready) {
    const candidate = await findReplanCandidate(mission.currentStage, handoff.team)
    return { missionId: mission.id, stage: mission.currentStage, action: candidate ? 'REPLAN_AND_CONTINUE' : 'REPLAN_REQUIRED', reason: candidate ? `Current leader is not ready; compliant replacement ${candidate.id} is available.` : `Leader capability readiness failed: ${readiness.missing.join(', ')}.`, leaderId: handoff.team, leaderName: handoff.leader, stale, capabilityReady: false, artifactRequired: handoff.artifactRequired, artifactVerified: handoff.artifactVerified, state }
  }
  if (handoff.artifactRequired !== 'none' && handoff.artifactValue && !handoff.artifactVerified) return { missionId: mission.id, stage: mission.currentStage, action: 'WAIT_FOR_ARTIFACT', reason: 'Artifact exists but is not verified; do not advance until verification succeeds.', leaderId: handoff.team, leaderName: handoff.leader, stale, capabilityReady: true, artifactRequired: handoff.artifactRequired, artifactVerified: false, state }
  if (handoff.artifactRequired !== 'none' && handoff.artifactVerified) return { missionId: mission.id, stage: mission.currentStage, action: 'ADVANCE_STAGE', reason: 'Required stage artifact is verified.', leaderId: handoff.team, leaderName: handoff.leader, stale: false, capabilityReady: true, artifactRequired: handoff.artifactRequired, artifactVerified: true, state }
  return { missionId: mission.id, stage: mission.currentStage, action: 'RUN_LEADER', reason: stale ? `Stage is stale (${Math.round(minutesSince(mission.updatedAt, now))}m without state change).` : 'Stage is active and has no verified completion artifact yet.', leaderId: handoff.team, leaderName: handoff.leader, stale, capabilityReady: true, artifactRequired: handoff.artifactRequired, artifactVerified: handoff.artifactVerified, state }
}

export async function runMissionSupervisorCycle(options?: { maxMissions?: number; maxLeaderRuns?: number; staleMinutes?: number }): Promise<MissionSupervisorRunResult> {
  const startedAt = new Date().toISOString()
  const missions = (await listActiveMissionsDB()).slice(0, options?.maxMissions ?? DEFAULT_MAX_MISSIONS_PER_TICK)
  const decisions: MissionSupervisorDecision[] = []
  let acted = 0; let blocked = 0; let advanced = 0; let failures = 0; let leaderRuns = 0

  for (const mission of missions) {
    const decision = await inspectMission(mission, { staleMinutes: options?.staleMinutes ?? DEFAULT_STALE_MINUTES })
    const state = { ...decision.state, lastHeartbeatAt: new Date().toISOString() }
    try {
      if (decision.action === 'ADVANCE_STAGE') {
        const updated = await advanceDurableMission(mission)
        state.lastActionAt = new Date().toISOString(); state.lastAction = updated.currentStage === 'COMPLETED' ? 'COMPLETED' : 'ADVANCE_STAGE'; state.totalActions += 1; state.consecutiveFailures = 0; state.blocker = null; state.nextAction = updated.currentStage === 'COMPLETED' ? null : 'Run the newly active stage leader.'; advanced += 1; acted += 1
      } else if (decision.action === 'WAIT_FOR_ARTIFACT') {
        const handoff = activeHandoff(mission)
        state.lastActionAt = new Date().toISOString(); state.lastAction = 'WAIT_FOR_ARTIFACT'; state.totalActions += 1; state.blocker = handoff?.artifactVerifyError ?? 'Artifact requires verification.'; state.nextAction = 'Verify or replace the stage artifact before advancing.'; blocked += 1; acted += 1
      } else if (decision.action === 'REPLAN_AND_CONTINUE') {
        const replanned = await applyReplanIfSafe(mission)
        state.lastActionAt = new Date().toISOString(); state.lastAction = replanned.applied ? 'REPLAN_AND_CONTINUE' : 'REPLAN_REQUIRED'; state.totalActions += 1; state.consecutiveFailures = replanned.applied ? 0 : Math.min(10, state.consecutiveFailures + 1); state.blocker = replanned.applied ? null : replanned.reason; state.nextAction = replanned.applied ? 'Run the replacement leader on the next supervisor pass.' : 'CEO/VID must select a compliant replacement leader.'; acted += 1; if (!replanned.applied) blocked += 1
      } else if (decision.action === 'REPLAN_REQUIRED') {
        await appendSystemLog(mission, `MISSION SUPERVISOR REPLAN REQUIRED — ${decision.reason}`)
        state.lastActionAt = new Date().toISOString(); state.lastAction = 'REPLAN_REQUIRED'; state.totalActions += 1; state.consecutiveFailures = Math.min(10, state.consecutiveFailures + 1); state.blocker = decision.reason; state.nextAction = 'CEO/VID must select a compliant replacement leader or revise the stage requirement.'; blocked += 1; acted += 1
      } else if (decision.action === 'OWNER_APPROVAL') {
        state.lastActionAt = new Date().toISOString(); state.lastAction = 'OWNER_APPROVAL'; state.totalActions += 1; state.blocker = null; state.nextAction = 'Owner approval is required; no autonomous approval will be performed.'; blocked += 1; acted += 1
      } else if (decision.action === 'RUN_LEADER') {
        if (leaderRuns >= (options?.maxLeaderRuns ?? DEFAULT_MAX_LEADER_RUNS_PER_TICK)) {
          state.nextAction = 'Wait for the next supervisor tick to prevent runaway autonomous calls.'
        } else if (!decision.leaderId || !decision.leaderName) {
          throw new Error('Mission leader is missing.')
        } else {
          const readiness = await assessMissionCapabilityReadiness(mission.currentStage, decision.leaderId)
          const response = await runLeaderOnce(mission, decision.leaderId, decision.leaderName, readiness.requiredTaskType)
          const handoff = activeHandoff(mission)
          const artifact = detectProgressArtifact(response, handoff?.artifactRequired ?? null)
          if (artifact && handoff) { handoff.artifactValue = artifact; handoff.artifactVerified = false; handoff.artifactVerifiedAt = null; handoff.artifactVerifyError = 'Artifact detected from leader output; verification is required before advancement.' }
          mission.log.push({ timestamp: new Date().toISOString(), actor: decision.leaderName, stage: mission.currentStage, message: `Supervisor execution report: ${response.slice(0, 500)}` })
          mission.updatedAt = new Date().toISOString()
          await saveActiveMissionDB(mission)
          state.lastActionAt = new Date().toISOString(); state.lastAction = 'RUN_LEADER'; state.totalActions += 1; state.consecutiveFailures = 0; state.blocker = null; state.nextAction = handoff?.artifactRequired === 'none' ? 'Supervisor can evaluate stage completion on the next tick.' : 'Verify the produced artifact before advancing.'; leaderRuns += 1; acted += 1
        }
      } else if (decision.action === 'COMPLETED') {
        state.lastAction = 'COMPLETED'; state.nextAction = null
      }
    } catch (error) {
      failures += 1; state.lastActionAt = new Date().toISOString(); state.lastAction = 'BLOCKED'; state.consecutiveFailures = Math.min(10, state.consecutiveFailures + 1); state.blocker = error instanceof Error ? error.message : String(error); state.nextAction = 'Retry after the blocker is resolved; escalate after repeated failures.'; blocked += 1
    }
    await writeState(mission.id, state)
    decisions.push({ ...decision, state })
  }

  return { startedAt, finishedAt: new Date().toISOString(), inspected: missions.length, acted, blocked, advanced, failures, decisions }
}

export async function getMissionSupervisorState(missionId: string): Promise<MissionSupervisorState> { return readState(missionId) }

export async function getMissionSupervisorSnapshot(missionId: string) {
  const mission = await getActiveMissionDB(missionId)
  if (!mission) return null
  const decision = await inspectMission(mission)
  const state = await readState(missionId)
  const requirement = capabilityRequirementForStage(mission.currentStage)
  return { missionId, decision, state, capabilityRequirement: requirement ?? null }
}
