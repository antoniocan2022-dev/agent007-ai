/** Durable Active Mission store. */
import { db } from './db'
import type { ActiveMission, MissionStage, StageHandoff, LeaderThread, LeaderMessage } from './active-missions'

const MISSION_INDEX_KEY = 'active_mission_index'
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

async function getOperatorUserId(): Promise<string | null> {
  try { return (await db.user.findFirst({ orderBy: { createdAt: 'asc' } }))?.id ?? null } catch { return null }
}

async function readSetting(userId: string, key: string): Promise<string | null> {
  const row = await db.userSetting.findFirst({ where: { userId, key } })
  return row?.value ?? null
}

async function writeSetting(userId: string, key: string, value: string): Promise<void> {
  const existing = await db.userSetting.findFirst({ where: { userId, key } })
  if (existing) await db.userSetting.update({ where: { id: existing.id }, data: { value } })
  else await db.userSetting.create({ data: { userId, key, value } })
}

export async function listActiveMissionsDB(): Promise<ActiveMission[]> {
  const userId = await getOperatorUserId()
  if (!userId) throw new Error('Operator user is not available; mission persistence cannot be established.')
  const indexJson = await readSetting(userId, MISSION_INDEX_KEY)
  if (!indexJson) return []
  const ids = JSON.parse(indexJson) as string[]
  const missions: ActiveMission[] = []
  for (const id of ids) {
    const json = await readSetting(userId, `active_mission_${id}`)
    if (!json) continue
    try { missions.push(JSON.parse(json) as ActiveMission) } catch { /* malformed records are ignored */ }
  }
  return missions
}

export async function getActiveMissionDB(id: string): Promise<ActiveMission | null> {
  const userId = await getOperatorUserId()
  if (!userId) throw new Error('Operator user is not available; mission persistence cannot be established.')
  const json = await readSetting(userId, `active_mission_${id}`)
  if (!json) return null
  try { return JSON.parse(json) as ActiveMission } catch { return null }
}

export async function saveActiveMissionDB(mission: ActiveMission): Promise<void> {
  const userId = await getOperatorUserId()
  if (!userId) throw new Error('Operator user is not available; mission persistence cannot be established.')
  await writeSetting(userId, `active_mission_${mission.id}`, JSON.stringify(mission))
  const indexJson = await readSetting(userId, MISSION_INDEX_KEY)
  let ids: string[] = []
  if (indexJson) {
    try { ids = JSON.parse(indexJson) as string[] } catch { ids = [] }
  }
  if (!ids.includes(mission.id)) {
    ids.unshift(mission.id)
    await writeSetting(userId, MISSION_INDEX_KEY, JSON.stringify(ids))
  }
}

export async function appendLeaderMessageDB(missionId: string, leaderId: string, from: 'OWNER' | 'LEADER', text: string): Promise<ActiveMission | null> {
  const m = await getActiveMissionDB(missionId)
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

export async function getLeaderForCurrentStageDB(missionId: string): Promise<{ leaderId: string; leaderName: string; stage: MissionStage } | null> {
  const m = await getActiveMissionDB(missionId)
  if (!m) return null
  const handoff = m.chain.find((c) => c.stage === m.currentStage)
  if (!handoff) return null
  return { leaderId: handoff.team, leaderName: handoff.leader, stage: m.currentStage }
}

export async function createActiveMissionDB(input: { title: string; description: string; revenueTarget?: number; priority?: ActiveMission['priority']; category?: string }): Promise<ActiveMission | null> {
  const { DEFAULT_CHAIN } = await import('./active-missions')
  const mission: ActiveMission = {
    id: uid('mission'), title: input.title, description: input.description, revenueTarget: input.revenueTarget ?? 0,
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
