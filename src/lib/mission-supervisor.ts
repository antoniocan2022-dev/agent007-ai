import { db } from './db'
import { assertMissionTransition, buildArtifactId, registerArtifact, type ArtifactKind } from './architecture-control-plane'
import { verifyCanonicalArtifact } from './artifact-verifier'
import { getActiveMissionDB, listActiveMissionsDB, saveActiveMissionDB } from './active-missions-db'
import { acquireMissionExecutionLease, releaseMissionExecutionLease, runAutonomyManagerTick } from './autonomy/autonomy-manager'
import { runCeoCognitiveLifecycle } from './ceo-cognitive-lifecycle'
import { assessMissionCapabilityReadiness, capabilityRequirementForStage } from './mission-capability-readiness'
import { getAllGovernanceProfiles, getSubagentGovernanceProfile } from './subagent-governance'
import { appendMissionControlEvent, markMissionProgress } from './active-missions'
import type { ActiveMission, MissionControlEventType, MissionStage } from './active-missions'

const DEFAULTS = { staleMinutes: 30, maxMissions: 5, maxLeaderRuns: 2 }
export const FAILURE_THRESHOLDS = { retryAt: 1, replanAt: 2, escalateAt: 3 } as const
export type FailurePolicy = 'RETRY' | 'REPLAN' | 'ESCALATE'
export type MissionSupervisorAction = 'RUN_LEADER' | 'ADVANCE_STAGE' | 'WAIT_FOR_ARTIFACT' | 'RETRY_LEADER' | 'REPLAN_REQUIRED' | 'REPLAN_AND_CONTINUE' | 'ESCALATE' | 'BLOCKED' | 'OWNER_APPROVAL' | 'COMPLETED' | 'NO_ACTION'
export interface MissionSupervisorState { lastHeartbeatAt: string | null; lastActionAt: string | null; lastProgressAt: string | null; lastAction: MissionSupervisorAction | null; consecutiveFailures: number; totalActions: number; blocker: string | null; nextAction: string | null }
export interface MissionSupervisorDecision { missionId: string; stage: MissionStage; action: MissionSupervisorAction; reason: string; leaderId: string | null; leaderName: string | null; stale: boolean; capabilityReady: boolean; artifactRequired: string | null; artifactVerified: boolean; state: MissionSupervisorState }
export interface MissionSupervisorRunResult { startedAt: string; finishedAt: string; inspected: number; acted: number; blocked: number; advanced: number; failures: number; decisions: MissionSupervisorDecision[] }

const now = () => new Date().toISOString()
const emptyState = (): MissionSupervisorState => ({ lastHeartbeatAt: null, lastActionAt: null, lastProgressAt: null, lastAction: null, consecutiveFailures: 0, totalActions: 0, blocker: null, nextAction: null })
const handoffFor = (mission: ActiveMission) => mission.chain.find((handoff) => handoff.stage === mission.currentStage) ?? null
const stateKey = (ownerId: string, missionId: string) => `mission_supervisor_state_${ownerId}:${missionId}`

export function evaluateFailurePolicy(consecutiveFailures: number): FailurePolicy {
  if (consecutiveFailures >= FAILURE_THRESHOLDS.escalateAt) return 'ESCALATE'
  if (consecutiveFailures >= FAILURE_THRESHOLDS.replanAt) return 'REPLAN'
  return 'RETRY'
}

export function recordMissionControlEvent(mission: ActiveMission, type: MissionControlEventType, actor: string, stage: MissionStage, reason: string, fromLeader: string | null = null, toLeader: string | null = null, details?: string) {
  return appendMissionControlEvent(mission, { type, actor, stage, fromLeader, toLeader, reason, details })
}

function minutesSince(value: string | null): number {
  if (!value) return Number.POSITIVE_INFINITY
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? Math.max(0, (Date.now() - parsed) / 60_000) : Number.POSITIVE_INFINITY
}

async function readState(ownerId: string, missionId: string): Promise<MissionSupervisorState> {
  if (!ownerId) return emptyState()
  const row = await db.userSetting.findFirst({ where: { userId: ownerId, key: stateKey(ownerId, missionId) } })
  if (!row) return emptyState()
  try { return { ...emptyState(), ...(JSON.parse(row.value) as Partial<MissionSupervisorState>) } } catch { return emptyState() }
}

async function writeState(ownerId: string, missionId: string, state: MissionSupervisorState): Promise<void> {
  if (!ownerId) return
  const key = stateKey(ownerId, missionId)
  const value = JSON.stringify({ ownerId, missionId, ...state })
  const existing = await db.userSetting.findFirst({ where: { userId: ownerId, key } })
  if (existing) await db.userSetting.update({ where: { id: existing.id }, data: { value } })
  else await db.userSetting.create({ data: { userId: ownerId, key, value } })
}

function extractJson(text: string): string | null {
  return text.match(/```(?:json)?\s*(\{[\s\S]*?\}|\[[\s\S]*?\])\s*```/i)?.[1] ?? text.match(/(\{[\s\S]{20,}\}|\[[\s\S]{20,}\])/m)?.[1] ?? null
}

export function extractMissionArtifact(text: string, kind: ArtifactKind): string | null {
  const value = text.trim()
  if (!value || kind === 'none') return null
  if (kind === 'url') return value.match(/https?:\/\/[^\s)]+/i)?.[0] ?? null
  if (kind === 'transaction_id') return value.match(/(?:transaction[_\s-]?id|tx(?:id)?)[\s:=#-]+([A-Za-z0-9_-]{8,})/i)?.[1] ?? null
  if (kind === 'message_id') return value.match(/(?:message[_\s-]?id|messageId)[\s:=#-]+([A-Za-z0-9_.:-]{4,})/i)?.[1] ?? null
  if (kind === 'file_path') return value.match(/(?:file[_\s-]?path|path)[\s:=]+([./~][^\s`]+\.[A-Za-z0-9_-]{1,16})/i)?.[1] ?? null
  if (kind === 'data') return extractJson(value) ?? JSON.stringify({ type: 'mission-leader-report', report: value })
  return null
}

async function persistLeaderArtifact(mission: ActiveMission, response: string) {
  const handoff = handoffFor(mission)
  if (!handoff || handoff.artifactRequired === 'none') return { artifactId: null, verified: true, reason: 'No artifact required.' }
  const value = extractMissionArtifact(response, handoff.artifactRequired as ArtifactKind)
  if (!value) return { artifactId: null, verified: false, reason: `No recognizable ${handoff.artifactRequired} artifact was produced.` }
  const artifactId = buildArtifactId({ ventureId: null, missionId: mission.id, stage: mission.currentStage, artifactType: handoff.artifactRequired as ArtifactKind, value })
  const record = await registerArtifact({ artifactId, ventureId: null, missionId: mission.id, stage: mission.currentStage, producer: handoff.leader, consumers: [], artifactType: handoff.artifactRequired as ArtifactKind, value, version: 1, supersedes: null })
  if (!handoff.artifacts.includes(record.artifactId)) handoff.artifacts.push(record.artifactId)
  handoff.artifactValue = value
  const verification = await verifyCanonicalArtifact(record.artifactId, handoff.leader, { missionId: mission.id, stage: mission.currentStage, ventureId: null })
  handoff.artifactVerified = verification.verified
  handoff.artifactVerifiedAt = verification.verified ? now() : null
  handoff.artifactVerifyError = verification.verified ? null : verification.reason
  return { artifactId: record.artifactId, verified: verification.verified, reason: verification.reason }
}

async function appendSystemLog(mission: ActiveMission, message: string): Promise<void> {
  const timestamp = now()
  mission.log.push({ timestamp, actor: 'MISSION_SUPERVISOR', stage: mission.currentStage, message })
  mission.updatedAt = timestamp
  await saveActiveMissionDB(mission)
}

async function advanceDurableMission(mission: ActiveMission): Promise<ActiveMission> {
  const stages: MissionStage[] = ['PLANNED', 'IN_PROGRESS', 'REVIEW', 'DELIVERED', 'VERIFIED', 'OWNER_APPROVAL', 'COMPLETED']
  const index = stages.indexOf(mission.currentStage)
  const current = handoffFor(mission)
  if (index < 0 || index >= stages.length - 1 || !current || mission.currentStage === 'OWNER_APPROVAL') return mission
  if (current.artifactRequired !== 'none' && (!current.artifactValue || !current.artifactVerified)) return mission
  const timestamp = now()
  const nextStage = stages[index + 1]
  current.status = 'done'
  current.completedAt = current.completedAt ?? timestamp
  assertMissionTransition(mission.currentStage, nextStage)
  mission.currentStage = nextStage
  const next = handoffFor(mission)
  if (next) { next.status = 'active'; next.startedAt = next.startedAt ?? timestamp }
  recordMissionControlEvent(mission, 'STAGE_ADVANCE', current.leader || 'MISSION_SUPERVISOR', nextStage, 'Stage completed with required artifact verification.', current.team, next?.team ?? null)
  markMissionProgress(mission, timestamp)
  mission.log.push({ timestamp, actor: current.leader || 'MISSION_SUPERVISOR', stage: nextStage, message: `Supervisor advanced mission: ${current.stage} → ${nextStage}.` })
  await saveActiveMissionDB(mission)
  return mission
}

async function getSubagentsModule() { return import('./subagents') }

async function findReplacement(stage: MissionStage, currentLeader: string) {
  const profile = getSubagentGovernanceProfile(currentLeader)
  const requirement = capabilityRequirementForStage(stage)
  if (!profile || !requirement || profile.riskLevel === 'critical' || stage === 'OWNER_APPROVAL') return null
  const { getAllSubagents } = await getSubagentsModule()
  const agents = await getAllSubagents({ includeDisabled: false })
  const { assessMissionCapabilityReadiness } = await import('./mission-capability-readiness')
  const candidates = getAllGovernanceProfiles().filter((candidate) => candidate.id !== currentLeader && candidate.class === profile.class && candidate.taskTypes.includes(requirement.requiredTaskType))
  for (const candidate of candidates) {
    const agent = agents.find((item) => item.id === candidate.id && item.enabled !== false)
    if (!agent) continue
    const readiness = await assessMissionCapabilityReadiness(stage, candidate.id)
    if (readiness.ready) return { id: candidate.id, name: agent.name }
  }
  return null
}

async function applySafeReplan(mission: ActiveMission, reason: string) {
  const handoff = handoffFor(mission)
  if (!handoff) return { applied: false, reason: 'No current stage handoff exists.' }
  const candidate = await findReplacement(mission.currentStage, handoff.team)
  if (!candidate) return { applied: false, reason: 'No safe same-class replacement leader is available.' }
  const previous = `${handoff.team}/${handoff.leader}`
  handoff.team = candidate.id
  handoff.leader = candidate.name
  handoff.status = 'active'
  handoff.notes = `${handoff.notes ? `${handoff.notes} ` : ''}Reassigned ${previous} → ${candidate.id}.`.trim()
  const timestamp = now()
  recordMissionControlEvent(mission, 'REPLAN', 'MISSION_SUPERVISOR', mission.currentStage, reason, previous, `${candidate.id}/${candidate.name}`)
  markMissionProgress(mission, timestamp)
  mission.log.push({ timestamp, actor: 'MISSION_SUPERVISOR', stage: mission.currentStage, message: `SAFE REPLAN APPLIED — ${previous} → ${candidate.id}.` })
  await saveActiveMissionDB(mission)
  return { applied: true, reason: `Reassigned stage to compliant ${candidate.id}.` }
}

function leaderTask(mission: ActiveMission, leaderId: string, leaderName: string, requiredTaskType: string) {
  return [`[AUTONOMOUS MISSION SUPERVISOR — ${mission.id}]`, `You are ${leaderName} (${leaderId}) responsible for stage ${mission.currentStage}.`, `Mission: ${mission.title}`, `Description: ${mission.description}`, `Required task type: ${requiredTaskType}`, `Required artifact type: ${handoffFor(mission)?.artifactRequired ?? 'none'}`, '', 'Execute the next useful step within your authority and available capabilities.', 'Do not claim completion without producing or referencing the required artifact.', 'If blocked, state the exact blocker, missing evidence, and smallest next action.', 'Return accomplishments, blocker, artifact, verification needed, and next action.'].join('\n')
}

async function runLeader(mission: ActiveMission, leaderId: string, leaderName: string, requiredTaskType: string): Promise<string> {
  recordMissionControlEvent(mission, 'DELEGATION', 'MISSION_SUPERVISOR', mission.currentStage, 'Mission stage delegated to current compliant leader.', handoffFor(mission)?.team ?? null, leaderId)
  await saveActiveMissionDB(mission)
  if (leaderId === 'ceo' || leaderName.toLowerCase() === 'ceo') {
    const result = await runCeoCognitiveLifecycle({ missionId: mission.id, contextualEvidence: `Mission ${mission.id}\nOwner ${mission.ownerId ?? 'unknown'}\nStage ${mission.currentStage}\nTitle ${mission.title}\nDescription ${mission.description}`, verification: 'enhanced', messages: [{ role: 'system', content: 'You supervise an autonomous mission. Never invent artifacts, deployment, approval, or outcomes.' }, { role: 'user', content: leaderTask(mission, leaderId, leaderName, requiredTaskType) }], timeoutMs: 50_000 })
    return result.content
  }
  const { getAllSubagents, runSubagent } = await getSubagentsModule()
  const subagent = (await getAllSubagents({ includeDisabled: false })).find((candidate) => candidate.id === leaderId)
  if (!subagent) throw new Error(`No enabled subagent found for '${leaderId}'.`)
  const result = await runSubagent({ subagentId: subagent.id, task: leaderTask(mission, leaderId, leaderName, requiredTaskType), dispatchId: `mission_supervisor_${mission.id}_${Date.now()}`, attachments: [], language: 'en', emit: async () => {}, parentConversationId: `mission_${mission.id}` })
  return result.answer || ''
}

export async function inspectMission(mission: ActiveMission, options?: { staleMinutes?: number }): Promise<MissionSupervisorDecision> {
  const handoff = handoffFor(mission)
  const state = await readState(mission.ownerId ?? '', mission.id)
  const progressTimestamp = mission.progressAt ?? state.lastProgressAt
  const stale = minutesSince(progressTimestamp) >= (options?.staleMinutes ?? DEFAULTS.staleMinutes)
  if (mission.currentStage === 'COMPLETED') return { missionId: mission.id, stage: mission.currentStage, action: 'COMPLETED', reason: 'Mission is already completed.', leaderId: handoff?.team ?? null, leaderName: handoff?.leader ?? null, stale: false, capabilityReady: true, artifactRequired: handoff?.artifactRequired ?? null, artifactVerified: handoff?.artifactVerified ?? true, state }
  if (mission.currentStage === 'OWNER_APPROVAL') return { missionId: mission.id, stage: mission.currentStage, action: 'OWNER_APPROVAL', reason: 'Owner approval is a deliberate governance boundary; no autonomous approval is permitted.', leaderId: handoff?.team ?? null, leaderName: handoff?.leader ?? null, stale, capabilityReady: true, artifactRequired: handoff?.artifactRequired ?? 'none', artifactVerified: handoff?.artifactVerified ?? true, state }
  if (!mission.ownerId) return { missionId: mission.id, stage: mission.currentStage, action: 'ESCALATE', reason: 'Mission has no canonical owner identity; autonomous execution is fail-closed.', leaderId: handoff?.team ?? null, leaderName: handoff?.leader ?? null, stale: true, capabilityReady: false, artifactRequired: handoff?.artifactRequired ?? null, artifactVerified: false, state }
  if (!handoff) return { missionId: mission.id, stage: mission.currentStage, action: 'REPLAN_REQUIRED', reason: 'Current mission stage has no registered handoff.', leaderId: null, leaderName: null, stale: true, capabilityReady: false, artifactRequired: null, artifactVerified: false, state }
  const readiness = await assessMissionCapabilityReadiness(mission.currentStage, handoff.team)
  if (!readiness.ready) {
    const policy = evaluateFailurePolicy(state.consecutiveFailures + 1)
    if (policy === 'ESCALATE') return { missionId: mission.id, stage: mission.currentStage, action: 'ESCALATE', reason: `Capability readiness failed after ${state.consecutiveFailures + 1} consecutive failures: ${readiness.missing.join(', ')}.`, leaderId: handoff.team, leaderName: handoff.leader, stale, capabilityReady: false, artifactRequired: handoff.artifactRequired, artifactVerified: handoff.artifactVerified, state }
    const candidate = await findReplacement(mission.currentStage, handoff.team)
    return { missionId: mission.id, stage: mission.currentStage, action: candidate ? 'REPLAN_AND_CONTINUE' : policy === 'REPLAN' ? 'REPLAN_REQUIRED' : 'RETRY_LEADER', reason: candidate ? `Current leader is not ready; compliant replacement ${candidate.id} is available.` : `Leader capability readiness failed: ${readiness.missing.join(', ')}.`, leaderId: handoff.team, leaderName: handoff.leader, stale, capabilityReady: false, artifactRequired: handoff.artifactRequired, artifactVerified: handoff.artifactVerified, state }
  }
  if (handoff.artifactRequired !== 'none' && handoff.artifactValue && !handoff.artifactVerified) return { missionId: mission.id, stage: mission.currentStage, action: evaluateFailurePolicy(state.consecutiveFailures + 1) === 'ESCALATE' ? 'ESCALATE' : 'WAIT_FOR_ARTIFACT', reason: 'Artifact exists but is not verified; do not advance until canonical verification succeeds.', leaderId: handoff.team, leaderName: handoff.leader, stale, capabilityReady: true, artifactRequired: handoff.artifactRequired, artifactVerified: false, state }
  if (handoff.artifactRequired !== 'none' && handoff.artifactVerified) return { missionId: mission.id, stage: mission.currentStage, action: 'ADVANCE_STAGE', reason: 'Required stage artifact is verified.', leaderId: handoff.team, leaderName: handoff.leader, stale: false, capabilityReady: true, artifactRequired: handoff.artifactRequired, artifactVerified: true, state }
  if (state.consecutiveFailures >= FAILURE_THRESHOLDS.escalateAt) return { missionId: mission.id, stage: mission.currentStage, action: 'ESCALATE', reason: `Escalation threshold reached: ${state.consecutiveFailures} consecutive failures.`, leaderId: handoff.team, leaderName: handoff.leader, stale, capabilityReady: true, artifactRequired: handoff.artifactRequired, artifactVerified: handoff.artifactVerified, state }
  if (state.consecutiveFailures > 0) return { missionId: mission.id, stage: mission.currentStage, action: 'RETRY_LEADER', reason: `Retry threshold is active after ${state.consecutiveFailures} consecutive failure(s).`, leaderId: handoff.team, leaderName: handoff.leader, stale, capabilityReady: true, artifactRequired: handoff.artifactRequired, artifactVerified: handoff.artifactVerified, state }
  return { missionId: mission.id, stage: mission.currentStage, action: 'RUN_LEADER', reason: stale ? `Stage is stale (${Math.round(minutesSince(progressTimestamp))}m without mission progress).` : 'Stage is active and has no verified completion artifact yet.', leaderId: handoff.team, leaderName: handoff.leader, stale, capabilityReady: true, artifactRequired: handoff.artifactRequired, artifactVerified: handoff.artifactVerified, state }
}

async function internalCycle(options: { maxMissions?: number; maxLeaderRuns?: number; staleMinutes?: number; executionOwner: string }): Promise<MissionSupervisorRunResult> {
  const startedAt = now()
  const missions = (await listActiveMissionsDB()).slice(0, options.maxMissions ?? DEFAULTS.maxMissions)
  const decisions: MissionSupervisorDecision[] = []
  let acted = 0, blocked = 0, advanced = 0, failures = 0, leaderRuns = 0
  for (const mission of missions) {
    if (!mission.ownerId) { failures++; continue }
    const lease = await acquireMissionExecutionLease(mission.id, options.executionOwner)
    if (!lease) { blocked++; continue }
    try {
      const decision = await inspectMission(mission, { staleMinutes: options.staleMinutes })
      const state: MissionSupervisorState = { ...decision.state, lastHeartbeatAt: now() }
      try {
        if (decision.action === 'ADVANCE_STAGE') {
          const updated = await advanceDurableMission(mission)
          state.lastActionAt = now(); state.lastProgressAt = updated.progressAt; state.lastAction = updated.currentStage === 'COMPLETED' ? 'COMPLETED' : 'ADVANCE_STAGE'; state.totalActions++; state.consecutiveFailures = 0; state.blocker = null; state.nextAction = updated.currentStage === 'COMPLETED' ? null : 'Run the newly active stage leader.'; advanced++; acted++
        } else if (decision.action === 'OWNER_APPROVAL') {
          state.lastActionAt = now(); state.lastAction = 'OWNER_APPROVAL'; state.totalActions++; state.blocker = null; state.nextAction = 'Owner approval is required; no autonomous approval will be performed.'; blocked++; acted++
        } else if (decision.action === 'WAIT_FOR_ARTIFACT') {
          state.lastActionAt = now(); state.lastAction = 'WAIT_FOR_ARTIFACT'; state.totalActions++; state.blocker = handoffFor(mission)?.artifactVerifyError ?? 'Artifact requires verification.'; state.nextAction = 'Verify or replace the stage artifact before advancing.'; blocked++; acted++
        } else if (decision.action === 'RETRY_LEADER' || decision.action === 'RUN_LEADER') {
          if (leaderRuns >= (options.maxLeaderRuns ?? DEFAULTS.maxLeaderRuns)) state.nextAction = 'Wait for the next supervisor heartbeat to preserve bounded execution.'
          else if (!decision.leaderId || !decision.leaderName) throw new Error('Mission leader is missing.')
          else {
            const readiness = await assessMissionCapabilityReadiness(mission.currentStage, decision.leaderId)
            if (!readiness.ready) throw new Error(`Leader capability readiness failed: ${readiness.missing.join(', ')}`)
            try {
              const response = await runLeader(mission, decision.leaderId, decision.leaderName, readiness.requiredTaskType)
              const artifact = await persistLeaderArtifact(mission, response)
              const timestamp = now()
              mission.log.push({ timestamp, actor: decision.leaderName, stage: mission.currentStage, message: `Supervisor execution completed. Artifact ${artifact.artifactId ?? 'none'}: ${artifact.reason}.` })
              mission.updatedAt = timestamp
              if (artifact.verified) {
                state.consecutiveFailures = 0; markMissionProgress(mission, timestamp); state.lastProgressAt = mission.progressAt; state.blocker = null; state.nextAction = 'Advance stage on the next supervisor pass.'
              } else {
                state.consecutiveFailures += 1
                const policy = evaluateFailurePolicy(state.consecutiveFailures)
                state.blocker = artifact.reason
                if (policy === 'RETRY') { recordMissionControlEvent(mission, 'RETRY', 'MISSION_SUPERVISOR', mission.currentStage, artifact.reason, decision.leaderId, decision.leaderId); state.lastAction = 'RETRY_LEADER'; state.nextAction = 'Retry the same leader on the next heartbeat.' }
                else if (policy === 'REPLAN') { const replanned = await applySafeReplan(mission, `Artifact verification failed: ${artifact.reason}`); if (replanned.applied) { state.consecutiveFailures = 0; state.lastProgressAt = mission.progressAt; state.blocker = null; state.lastAction = 'REPLAN_AND_CONTINUE'; state.nextAction = 'Run replacement leader on the next heartbeat.' } else { state.lastAction = 'REPLAN_REQUIRED'; state.nextAction = 'CEO/VID must select a compliant replacement leader.'; blocked++ } }
                else { recordMissionControlEvent(mission, 'ESCALATION', 'MISSION_SUPERVISOR', mission.currentStage, artifact.reason, decision.leaderId, null, 'Failure threshold reached; autonomous retry is stopped.'); state.lastAction = 'ESCALATE'; state.nextAction = 'Escalate to CEO/VID for human-governed resolution.'; blocked++ }
              }
              state.lastActionAt = timestamp; state.totalActions++; leaderRuns++; acted++
              await saveActiveMissionDB(mission)
            } catch (error) {
              state.consecutiveFailures += 1
              const reason = error instanceof Error ? error.message : String(error)
              state.blocker = reason
              const policy = evaluateFailurePolicy(state.consecutiveFailures)
              if (policy === 'RETRY') { recordMissionControlEvent(mission, 'RETRY', 'MISSION_SUPERVISOR', mission.currentStage, reason, decision.leaderId, decision.leaderId); state.lastAction = 'RETRY_LEADER'; state.nextAction = 'Retry the same leader on the next heartbeat.' }
              else if (policy === 'REPLAN') { const replanned = await applySafeReplan(mission, `Leader execution failed: ${reason}`); if (replanned.applied) { state.consecutiveFailures = 0; state.lastProgressAt = mission.progressAt; state.blocker = null; state.lastAction = 'REPLAN_AND_CONTINUE'; state.nextAction = 'Run replacement leader on the next heartbeat.' } else { state.lastAction = 'REPLAN_REQUIRED'; state.nextAction = 'CEO/VID must select a compliant replacement leader.'; blocked++ } }
              else { recordMissionControlEvent(mission, 'ESCALATION', 'MISSION_SUPERVISOR', mission.currentStage, reason, decision.leaderId, null, 'Failure threshold reached; autonomous retry and replan are stopped.'); state.lastAction = 'ESCALATE'; state.nextAction = 'Escalate to CEO/VID for human-governed resolution.'; blocked++ }
              state.lastActionAt = now(); state.totalActions++; failures++; acted++
              await saveActiveMissionDB(mission)
            }
          }
        } else if (decision.action === 'REPLAN_AND_CONTINUE' || decision.action === 'REPLAN_REQUIRED') {
          const replanned = decision.action === 'REPLAN_AND_CONTINUE' ? await applySafeReplan(mission, decision.reason) : { applied: false, reason: decision.reason }
          state.lastActionAt = now(); state.lastAction = replanned.applied ? 'REPLAN_AND_CONTINUE' : 'REPLAN_REQUIRED'; state.totalActions++
          if (replanned.applied) { state.consecutiveFailures = 0; state.lastProgressAt = mission.progressAt; state.blocker = null; state.nextAction = 'Run replacement leader on the next heartbeat.' }
          else { state.consecutiveFailures = Math.min(10, state.consecutiveFailures + 1); state.blocker = replanned.reason; state.nextAction = 'CEO/VID must select a compliant replacement leader or revise the stage requirement.'; blocked++ }
          acted++
        } else if (decision.action === 'ESCALATE') {
          recordMissionControlEvent(mission, 'ESCALATION', 'MISSION_SUPERVISOR', mission.currentStage, decision.reason, decision.leaderId, null, 'Autonomous execution is fail-closed at the escalation threshold.')
          state.lastActionAt = now(); state.lastAction = 'ESCALATE'; state.totalActions++; state.blocker = decision.reason; state.nextAction = 'Escalate to CEO/VID for human-governed resolution.'; blocked++; acted++; failures++
          await saveActiveMissionDB(mission)
        } else if (decision.action === 'COMPLETED') { state.lastAction = 'COMPLETED'; state.nextAction = null }
      } catch (error) {
        failures++
        const reason = error instanceof Error ? error.message : String(error)
        state.lastActionAt = now(); state.lastAction = 'ESCALATE'; state.consecutiveFailures = Math.min(10, state.consecutiveFailures + 1); state.blocker = reason; state.nextAction = 'Escalate after repeated autonomous execution failure.'; blocked++
        recordMissionControlEvent(mission, 'ESCALATION', 'MISSION_SUPERVISOR', mission.currentStage, reason, decision.leaderId, null)
        await saveActiveMissionDB(mission)
      }
      await writeState(mission.ownerId, mission.id, state)
      decisions.push({ ...decision, state })
    } finally { await releaseMissionExecutionLease(mission.id, options.executionOwner) }
  }
  return { startedAt, finishedAt: now(), inspected: missions.length, acted, blocked, advanced, failures, decisions }
}

export async function runMissionSupervisorCycle(options: { maxMissions?: number; maxLeaderRuns?: number; staleMinutes?: number; assumeAutonomyLease?: boolean; executionOwner?: string } = {}): Promise<MissionSupervisorRunResult> {
  if (!options.assumeAutonomyLease) {
    const manager = await runAutonomyManagerTick({ actorId: 'vid', includeMissionSupervisor: true, maxMissionSupervisorMissions: options.maxMissions, maxMissionLeaderRuns: options.maxLeaderRuns, missionStaleMinutes: options.staleMinutes })
    return { startedAt: manager.startedAt, finishedAt: manager.finishedAt, inspected: manager.missionSupervisor?.inspected ?? 0, acted: manager.missionSupervisor?.acted ?? 0, blocked: manager.missionSupervisor?.blocked ?? 0, advanced: manager.missionSupervisor?.advanced ?? 0, failures: manager.missionSupervisor?.failures ?? manager.errors.length, decisions: [] }
  }
  return internalCycle({ maxMissions: options.maxMissions, maxLeaderRuns: options.maxLeaderRuns, staleMinutes: options.staleMinutes, executionOwner: options.executionOwner ?? `mission-supervisor-${Date.now()}` })
}

export async function getMissionSupervisorState(missionId: string, ownerId: string): Promise<MissionSupervisorState> { return readState(ownerId, missionId) }
export async function getMissionSupervisorSnapshot(missionId: string, ownerId: string) {
  const mission = await getActiveMissionDB(missionId, ownerId)
  if (!mission) return null
  const decision = await inspectMission(mission)
  return { missionId, decision, state: await readState(ownerId, missionId), capabilityRequirement: capabilityRequirementForStage(mission.currentStage) ?? null, progressAt: mission.progressAt, controlEventVersion: mission.controlEventVersion, controlEvents: mission.controlEvents }
}
