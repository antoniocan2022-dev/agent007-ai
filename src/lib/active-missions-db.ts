/** Durable Active Mission store. Mission ownership is canonical and tenant-safe. */
import { db } from './db'
import type { ActiveMission, MissionStage, StageHandoff, LeaderMessage } from './active-missions'

const MISSION_KEY_PREFIX = 'active_mission_'
const MISSION_INDEX_PREFIX = 'active_mission_index'
const POD_LEADER_MAP: Record<string, { leader: string; name: string }> = {
  scout: { leader: 'SCOUT', name: 'Intelligence & Research' },
  aurora: { leader: 'AURORA', name: 'Creation & Design' },
  echo: { leader: 'ECHO', name: 'Quality Assurance' },
  forge: { leader: 'FORGE', name: 'Engineering' },
  pulse: { leader: 'PULSE', name: 'Monitoring & Ops' },
  developer: { leader: 'Developer', name: 'System Health' },
  cybersecurity_r: { leader: 'Cybersecurity R', name: 'Compliance & Security' },
  revenue: { leader: 'QUANTUM + AURORA', name: 'Revenue (Passive Income)' },
}

function uid(prefix: string) { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}` }
function nowIso() { return new Date().toISOString() }
function missionKey(id: string) { return `${MISSION_KEY_PREFIX}${id}` }
function normalizeOwnerId(ownerId: string): string { const value = ownerId.trim(); if (!value) throw new Error('Canonical mission owner identity is required.'); return value }
function hydrateMission(value: string, rowOwnerId: string): ActiveMission | null {
  try {
    const mission = JSON.parse(value) as Partial<ActiveMission>
    const createdAt = mission.createdAt ?? nowIso()
    return {
      ...mission,
      ownerId: mission.ownerId ?? rowOwnerId,
      createdAt,
      updatedAt: mission.updatedAt ?? createdAt,
      progressAt: mission.progressAt ?? createdAt,
      controlEventVersion: mission.controlEventVersion ?? 0,
      controlEvents: mission.controlEvents ?? [],
      chain: mission.chain ?? [],
      log: mission.log ?? [],
      threads: mission.threads ?? [],
    } as ActiveMission
  } catch { return null }
}
async function readSetting(userId: string, key: string): Promise<{ userId: string; value: string } | null> { const row = await db.userSetting.findFirst({ where: { userId, key } }); return row ? { userId: row.userId, value: row.value } : null }
async function writeSetting(userId: string, key: string, value: string): Promise<void> { const existing = await db.userSetting.findFirst({ where: { userId, key } }); if (existing) await db.userSetting.update({ where: { id: existing.id }, data: { value } }); else await db.userSetting.create({ data: { userId, key, value } }) }

export async function listActiveMissionsDB(ownerId?: string): Promise<ActiveMission[]> {
  const ownerFilter = ownerId?.trim()
  if (ownerFilter === '') throw new Error('Invalid mission owner identity.')
  const rows = await db.userSetting.findMany({ where: { key: { startsWith: MISSION_KEY_PREFIX } }, take: 5000 })
  const missions: ActiveMission[] = []
  for (const row of rows) {
    if (ownerFilter && row.userId !== ownerFilter) continue
    const mission = hydrateMission(row.value, row.userId)
    if (mission) missions.push(mission)
  }
  return missions
}

export async function getActiveMissionDB(id: string, ownerId?: string): Promise<ActiveMission | null> {
  const normalizedOwner = ownerId ? normalizeOwnerId(ownerId) : undefined
  const rows = await db.userSetting.findMany({ where: { key: missionKey(id) }, take: 20 })
  for (const row of rows) {
    if (normalizedOwner && row.userId !== normalizedOwner) continue
    return hydrateMission(row.value, row.userId)
  }
  return null
}

export async function saveActiveMissionDB(mission: ActiveMission): Promise<void> {
  const ownerId = normalizeOwnerId(mission.ownerId ?? '')
  mission.ownerId = ownerId
  mission.updatedAt = mission.updatedAt || nowIso()
  mission.progressAt = mission.progressAt || mission.createdAt || mission.updatedAt
  mission.controlEventVersion = mission.controlEventVersion ?? 0
  mission.controlEvents = mission.controlEvents ?? []
  await writeSetting(ownerId, missionKey(mission.id), JSON.stringify(mission))
  const index = await readSetting(ownerId, MISSION_INDEX_PREFIX)
  let ids: string[] = []
  if (index?.value) { try { ids = JSON.parse(index.value) as string[] } catch { ids = [] } }
  if (!ids.includes(mission.id)) { ids.unshift(mission.id); await writeSetting(ownerId, MISSION_INDEX_PREFIX, JSON.stringify(ids)) }
}

export async function appendLeaderMessageDB(missionId: string, leaderId: string, from: 'OWNER' | 'LEADER', text: string, ownerId?: string): Promise<ActiveMission | null> {
  const m = await getActiveMissionDB(missionId, ownerId)
  if (!m) return null
  const currentHandoff = m.chain.find((c) => c.stage === m.currentStage)
  const targetLeader = leaderId || currentHandoff?.team || ''
  const leaderInfo = { leader: currentHandoff?.leader || targetLeader.toUpperCase(), name: targetLeader }
  let thread = m.threads.find((t) => t.leaderId === targetLeader && t.stage === m.currentStage)
  if (!thread) { thread = { id: uid('thread'), missionId: m.id, leaderId: targetLeader, leaderName: leaderInfo.leader, stage: m.currentStage, messages: [] }; m.threads.push(thread) }
  const msg: LeaderMessage = { id: uid('msg'), from, author: from === 'OWNER' ? 'Owner' : leaderInfo.leader, text, timestamp: nowIso() }
  thread.messages.push(msg)
  const at = nowIso(); m.log.push({ timestamp: at, actor: from === 'OWNER' ? 'OWNER' : leaderInfo.leader, stage: m.currentStage, message: text.slice(0, 200) }); m.updatedAt = at
  await saveActiveMissionDB(m)
  return m
}

export async function getLeaderForCurrentStageDB(missionId: string, ownerId?: string): Promise<{ leaderId: string; leaderName: string; stage: MissionStage } | null> {
  const m = await getActiveMissionDB(missionId, ownerId); if (!m) return null; const handoff = m.chain.find((c) => c.stage === m.currentStage); if (!handoff) return null; return { leaderId: handoff.team, leaderName: handoff.leader, stage: handoff.stage }
}

export async function createActiveMissionDB(input: { ownerId: string; title: string; description: string; revenueTarget?: number; priority?: ActiveMission['priority']; category?: string }): Promise<ActiveMission | null> {
  const ownerId = normalizeOwnerId(input.ownerId)
  const { DEFAULT_CHAIN } = await import('./active-missions')
  const created = nowIso()
  const mission: ActiveMission = {
    id: uid('mission'), ownerId, title: input.title, description: input.description, revenueTarget: input.revenueTarget ?? 0,
    createdAt: created, updatedAt: created, progressAt: created, currentStage: 'PLANNED', priority: input.priority ?? 'medium', category: input.category ?? 'General',
    controlEventVersion: 0, controlEvents: [],
    chain: DEFAULT_CHAIN.map(({ stage, team, artifact }, i) => { const pod = POD_LEADER_MAP[team] || { leader: team.toUpperCase(), name: team }; const started = i === 0 ? created : null; const handoff: StageHandoff = { stage, team, leader: pod.leader, status: i === 0 ? 'active' : 'pending', startedAt: started, completedAt: null, notes: i === 0 ? 'Mission initiated — first team is working.' : '', artifacts: [], artifactRequired: artifact, artifactValue: null, artifactVerified: false, artifactVerifiedAt: null, artifactVerifyError: null }; return handoff }),
    log: [{ timestamp: created, actor: 'CEO', stage: 'PLANNED', message: `New mission created: ${input.title}. Target: $${input.revenueTarget ?? 0}/month.` }],
    threads: [],
  }
  await saveActiveMissionDB(mission)
  return mission
}
