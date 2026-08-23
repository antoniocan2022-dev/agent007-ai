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

function normalizeOwnerId(ownerId: string): string {
  const value = ownerId.trim()
  if (!value) throw new Error('Canonical mission owner identity is required.')
  return value
}

async function readSetting(userId: string, key: string): Promise<{ userId: string; value: string } | null> {
  const row = await db.userSetting.findFirst({ where: { userId, key } })
  return row ? { userId: row.userId, value: row.value } : null
}

async function writeSetting(userId: string, key: string, value: string): Promise<void> {
  const existing = await db.userSetting.findFirst({ where: { userId, key } })
  if (existing) await db.userSetting.update({ where: { id: existing.id }, data: { value } })
  else await db.userSetting.create({ data: { userId, key, value } })
}

/**
 * Lists missions across all authenticated owners. The previous implementation
 * selected the oldest user, which was unsafe for ownership and background autonomy.
 * Legacy records are assigned to the setting-row owner during hydration.
 */
export async function listActiveMissionsDB(ownerId?: string): Promise<ActiveMission[]> {
  const ownerFilter = ownerId?.trim()
  if (ownerFilter === '') throw new Error('Invalid mission owner identity.')
  const rows = await db.userSetting.findMany({ where: { key: { startsWith: MISSION_KEY_PREFIX } }, take: 5000 })
  const missions: ActiveMission[] = []
  for (const row of rows) {
    if (ownerFilter && row.userId !== ownerFilter) continue
    try {
      const mission = JSON.parse(row.value) as ActiveMission
      mission.ownerId = mission.ownerId ?? row.userId
      missions.push(mission)
    } catch {
      // Corrupt mission records are excluded from autonomous execution.
    }
  }
  return missions
}

export async function getActiveMissionDB(id: string, ownerId?: string): Promise<ActiveMission | null> {
  const normalizedOwner = ownerId ? normalizeOwnerId(ownerId) : undefined
  const rows = await db.userSetting.findMany({ where: { key: missionKey(id) }, take: 20 })
  for (const row of rows) {
    if (normalizedOwner && row.userId !== normalizedOwner) continue
    try {
      const mission = JSON.parse(row.value) as ActiveMission
      mission.ownerId = mission.ownerId ?? row.userId
      return mission
    } catch {
      return null
    }
  }
  return null
}

export async function saveActiveMissionDB(mission: ActiveMission): Promise<void> {
  const ownerId = normalizeOwnerId(mission.ownerId ?? '')
  mission.ownerId = ownerId
  await writeSetting(ownerId, missionKey(mission.id), JSON.stringify(mission))
  const index = await readSetting(ownerId, MISSION_INDEX_PREFIX)
  let ids: string[] = []
  if (index?.value) { try { ids = JSON.parse(index.value) as string[] } catch { ids = [] } }
  if (!ids.includes(mission.id)) {
    ids.unshift(mission.id)
    await writeSetting(ownerId, MISSION_INDEX_PREFIX, JSON.stringify(ids))
  }
}

export async function appendLeaderMessageDB(missionId: string, leaderId: string, from: 'OWNER' | 'LEADER', text: string, ownerId?: string): Promise<ActiveMission | null> {
  const m = await getActiveMissionDB(missionId, ownerId)
  if (!m) return null
  const currentHandoff = m.chain.find((c) => c.stage === m.currentStage)
  const targetLeader = leaderId || currentHandoff?.team || ''
  const leaderInfo = { leader: currentHandoff?.leader || targetLeader.toUpperCase(), name: targetLeader }
  let thread = m.threads.find((t) => t.leaderId === targetLeader && t.stage === m.currentStage)
  if (!thread) {
    thread = { id: uid('thread'), missionId: m.id, leaderId: targetLeader, leaderName: leaderInfo.leader, stage: m.currentStage, messages: [] }
    m.threads.push(thread)
  }
  const msg: LeaderMessage = { id: uid('msg'), from, author: from === 'OWNER' ? 'Owner' : leaderInfo.leader, text, timestamp: nowIso() }
  thread.messages.push(msg)
  m.log.push({ timestamp: nowIso(), actor: from === 'OWNER' ? 'OWNER' : leaderInfo.leader, stage: m.currentStage, message: text.slice(0, 200) })
  m.updatedAt = nowIso()
  await saveActiveMissionDB(m)
  return m
}

export async function getLeaderForCurrentStageDB(missionId: string, ownerId?: string): Promise<{ leaderId: string; leaderName: string; stage: MissionStage } | null> {
  const m = await getActiveMissionDB(missionId, ownerId)
  if (!m) return null
  const handoff = m.chain.find((c) => c.stage === m.currentStage)
  if (!handoff) return null
  return { leaderId: handoff.team, leaderName: handoff.leader, stage: m.currentStage }
}

export async function createActiveMissionDB(input: { ownerId: string; title: string; description: string; revenueTarget?: number; priority?: ActiveMission['priority']; category?: string }): Promise<ActiveMission | null> {
  const ownerId = normalizeOwnerId(input.ownerId)
  const { DEFAULT_CHAIN } = await import('./active-missions')
  const mission: ActiveMission = {
    id: uid('mission'), ownerId, title: input.title, description: input.description, revenueTarget: input.revenueTarget ?? 0,
    createdAt: nowIso(), updatedAt: nowIso(), currentStage: 'PLANNED', priority: input.priority ?? 'medium', category: input.category ?? 'General',
    chain: DEFAULT_CHAIN.map(({ stage, team, artifact }, i) => {
      const pod = POD_LEADER_MAP[team] || { leader: team.toUpperCase(), name: team }
      const handoff: StageHandoff = { stage, team, leader: pod.leader, status: i === 0 ? 'active' : 'pending', startedAt: i === 0 ? nowIso() : null, completedAt: null, notes: i === 0 ? 'Mission initiated — first team is working.' : '', artifacts: [], artifactRequired: artifact, artifactValue: null, artifactVerified: false, artifactVerifiedAt: null, artifactVerifyError: null }
      return handoff
    }),
    log: [{ timestamp: nowIso(), actor: 'CEO', stage: 'PLANNED', message: `New mission created: ${input.title}. Target: $${input.revenueTarget ?? 0}/month.` }],
    threads: [],
  }
  await saveActiveMissionDB(mission)
  return mission
}
