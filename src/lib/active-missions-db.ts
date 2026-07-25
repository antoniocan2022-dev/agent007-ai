/**
 * active-missions-db.ts — UPGRADE #143 (Issue B fix — DB-persisted Active Missions)
 * ===================================================================
 * The original `active-missions.ts` used an in-memory `store: ActiveMission[]`
 * which is PER-VERCEL-INSTANCE. When the owner sends a message to a leader:
 *   1. POST hits instance A → appends message → dispatches leader → appends response → returns
 *   2. UI re-renders with the response ✅
 *   3. 60s polling fires → GET hits instance B → B's `seed()` creates fresh
 *      missions with EMPTY threads → response vanishes ❌
 *
 * This module provides DB-backed equivalents of the in-memory functions,
 * storing missions as JSON in the `UserSetting` table (key = `active_mission_<id>`).
 * This survives across Vercel instances and cold starts.
 *
 * Used by /api/mission-active/route.ts and /api/mission-active/[missionId]/route.ts.
 */

import { db } from './db'
import type {
  ActiveMission,
  MissionStage,
  StageHandoff,
  LeaderThread,
  LeaderMessage,
} from './active-missions'

const MISSION_INDEX_KEY = 'active_mission_index'

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function nowIso() { return new Date().toISOString() }

/**
 * Get the operator user (first user by createdAt).
 */
async function getOperatorUserId(): Promise<string | null> {
  try {
    const user = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
    return user?.id ?? null
  } catch {
    return null
  }
}

/**
 * Read a single UserSetting value by key.
 */
async function readSetting(userId: string, key: string): Promise<string | null> {
  try {
    const row = await db.userSetting.findFirst({ where: { userId, key } })
    return row?.value ?? null
  } catch {
    return null
  }
}

/**
 * Upsert a single UserSetting value by key.
 */
async function writeSetting(userId: string, key: string, value: string): Promise<void> {
  try {
    const existing = await db.userSetting.findFirst({ where: { userId, key } })
    if (existing) {
      await db.userSetting.update({ where: { id: existing.id }, data: { value } })
    } else {
      await db.userSetting.create({ data: { userId, key, value } })
    }
  } catch (e: any) {
    console.warn('[active-missions-db] writeSetting failed:', e?.message?.slice(0, 100))
  }
}

/**
 * List all DB-persisted active missions.
 * Falls back to in-memory seeds if DB is empty (first run).
 */
export async function listActiveMissionsDB(): Promise<ActiveMission[]> {
  const userId = await getOperatorUserId()
  if (!userId) return []
  const indexJson = await readSetting(userId, MISSION_INDEX_KEY)
  if (!indexJson) return []
  try {
    const ids = JSON.parse(indexJson) as string[]
    const missions: ActiveMission[] = []
    for (const id of ids) {
      const mJson = await readSetting(userId, `active_mission_${id}`)
      if (mJson) {
        try { missions.push(JSON.parse(mJson) as ActiveMission) } catch {}
      }
    }
    return missions
  } catch {
    return []
  }
}

/**
 * Get a single DB-persisted mission by ID.
 */
export async function getActiveMissionDB(id: string): Promise<ActiveMission | null> {
  const userId = await getOperatorUserId()
  if (!userId) return null
  const json = await readSetting(userId, `active_mission_${id}`)
  if (!json) return null
  try { return JSON.parse(json) as ActiveMission } catch { return null }
}

/**
 * Persist a mission to DB. Also updates the index of mission IDs.
 */
export async function saveActiveMissionDB(mission: ActiveMission): Promise<void> {
  const userId = await getOperatorUserId()
  if (!userId) return
  await writeSetting(userId, `active_mission_${mission.id}`, JSON.stringify(mission))

  // Update the index (list of mission IDs)
  const indexJson = await readSetting(userId, MISSION_INDEX_KEY)
  let ids: string[] = []
  if (indexJson) {
    try { ids = JSON.parse(indexJson) as string[] } catch {}
  }
  if (!ids.includes(mission.id)) {
    ids.unshift(mission.id)  // newest first
    await writeSetting(userId, MISSION_INDEX_KEY, JSON.stringify(ids))
  }
}

/**
 * Append a leader message to a mission's thread.
 * Reads → modifies → writes back to DB.
 *
 * Returns the updated mission (or null if not found).
 */
export async function appendLeaderMessageDB(
  missionId: string,
  leaderId: string,
  from: 'OWNER' | 'LEADER',
  text: string
): Promise<ActiveMission | null> {
  const m = await getActiveMissionDB(missionId)
  if (!m) return null

  const currentHandoff = m.chain.find((c) => c.stage === m.currentStage)
  const targetLeader = leaderId || currentHandoff?.team || ''
  const leaderInfo = {
    leader: currentHandoff?.leader || targetLeader.toUpperCase(),
    name: targetLeader,
  }

  let thread = m.threads.find((t) => t.leaderId === targetLeader && t.stage === m.currentStage)
  if (!thread) {
    thread = {
      id: uid('thread'),
      missionId: m.id,
      leaderId: targetLeader,
      leaderName: leaderInfo.leader,
      stage: m.currentStage,
      messages: [],
    }
    m.threads.push(thread)
  }

  const msg: LeaderMessage = {
    id: uid('msg'),
    from,
    author: from === 'OWNER' ? 'Owner (Antonio)' : leaderInfo.leader,
    text,
    timestamp: nowIso(),
  }
  thread.messages.push(msg)

  m.log.push({
    timestamp: nowIso(),
    actor: from === 'OWNER' ? 'OWNER' : leaderInfo.leader,
    stage: m.currentStage,
    message: text.slice(0, 200),
  })

  m.updatedAt = nowIso()
  await saveActiveMissionDB(m)
  return m
}

/**
 * Get the leader for the current stage of a mission.
 */
export async function getLeaderForCurrentStageDB(
  missionId: string
): Promise<{ leaderId: string; leaderName: string; stage: MissionStage } | null> {
  const m = await getActiveMissionDB(missionId)
  if (!m) return null
  const handoff = m.chain.find((c) => c.stage === m.currentStage)
  if (!handoff) return null
  return { leaderId: handoff.team, leaderName: handoff.leader, stage: m.currentStage }
}

/**
 * Create a new DB-persisted mission.
 * Initializes with the default chain (Scout → Aurora → Echo → Forge → Pulse → Owner).
 */
export async function createActiveMissionDB(input: {
  title: string
  description: string
  revenueTarget?: number
  priority?: ActiveMission['priority']
  category?: string
}): Promise<ActiveMission | null> {
  const { DEFAULT_CHAIN, POD_LEADER_MAP } = await import('./active-missions')
  const mission: ActiveMission = {
    id: uid('mission'),
    title: input.title,
    description: input.description,
    revenueTarget: input.revenueTarget ?? 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    currentStage: 'PLANNED',
    priority: input.priority ?? 'medium',
    category: input.category ?? 'General',
    chain: DEFAULT_CHAIN.map(({ stage, team, artifact }, i) => {
      const pod = POD_LEADER_MAP[team] || { leader: team.toUpperCase(), name: team }
      const handoff: StageHandoff = {
        stage,
        team,
        leader: pod.leader,
        status: i === 0 ? 'active' : 'pending',
        startedAt: i === 0 ? nowIso() : null,
        completedAt: null,
        notes: i === 0 ? 'Mission initiated — first team is working.' : '',
        artifacts: [],
        artifactRequired: artifact,
        artifactValue: null,
        artifactVerified: false,
        artifactVerifiedAt: null,
        artifactVerifyError: null,
      }
      return handoff
    }),
    log: [
      {
        timestamp: nowIso(),
        actor: 'CEO',
        stage: 'PLANNED',
        message: `New mission created: ${input.title}. Target: $${input.revenueTarget ?? 0}/month.`,
      },
    ],
    threads: [],
  }
  await saveActiveMissionDB(mission)
  return mission
}
