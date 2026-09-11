import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { db } from '../src/lib/db'
import { createActiveMissionDB, saveActiveMissionDB } from '../src/lib/active-missions-db'
import { appendMissionControlEvent } from '../src/lib/active-missions'
import type { ActiveMission } from '../src/lib/active-missions'
import { getLeaderPerformanceRecord, getLeadershipPerformanceLedger, renderLeadershipPerformanceContext } from '../src/lib/ceo-leadership-performance'

describe('renderLeadershipPerformanceContext', () => {
  test('reports no history honestly rather than fabricating a ledger', () => {
    expect(renderLeadershipPerformanceContext([])).toBe('No cross-mission leadership performance history recorded yet.')
  })

  test('summarizes real records', () => {
    const rendered = renderLeadershipPerformanceContext([
      { leaderId: 'aurora', mandate: { mission: 'test', class: 'creation', riskLevel: 'medium' }, missionsInvolved: 3, stagesAdvanced: 4, retries: 1, escalations: 1, timesReplaced: 0, reliabilityScore: 0.8, lastActiveAt: null },
    ])
    expect(rendered).toContain('aurora (creation): 3 mission(s), 4 stage(s) advanced, 1 retr(y/ies), 1 escalation(s), 0 replacement(s), reliability 80%')
  })
})

describe('leadership performance ledger (real database)', () => {
  const suffix = `${Date.now()}_${randomUUID().slice(0, 8)}`
  let userId = ''
  const missions: ActiveMission[] = []

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for leadership performance integration tests.')
    const user = await db.user.create({ data: { email: `ci-leadership-${suffix}@example.test`, passwordHash: 'ci-only-hash', name: 'CI Leadership Test Owner' }, select: { id: true } })
    userId = user.id

    // Mission A: aurora advances a stage cleanly (a real success signal).
    const missionA = await createActiveMissionDB({ ownerId: userId, title: 'Mission A', description: 'test' })
    if (!missionA) throw new Error('createActiveMissionDB returned null')
    appendMissionControlEvent(missionA, { type: 'STAGE_ADVANCE', actor: 'Aurora', stage: 'REVIEW', fromLeader: 'aurora', toLeader: 'echo', reason: 'Stage completed with required artifact verification.' })
    await saveActiveMissionDB(missionA)
    missions.push(missionA)

    // Mission B: aurora is escalated (a real failure signal), then separately replaced via REPLAN
    // (whose fromLeader/toLeader carry the composite "id/DisplayName" string this module must parse).
    const missionB = await createActiveMissionDB({ ownerId: userId, title: 'Mission B', description: 'test' })
    if (!missionB) throw new Error('createActiveMissionDB returned null')
    appendMissionControlEvent(missionB, { type: 'ESCALATION', actor: 'MISSION_SUPERVISOR', stage: 'IN_PROGRESS', fromLeader: 'aurora', toLeader: null, reason: 'Failure threshold reached.' })
    appendMissionControlEvent(missionB, { type: 'REPLAN', actor: 'MISSION_SUPERVISOR', stage: 'IN_PROGRESS', fromLeader: 'aurora/Aurora', toLeader: 'hunt/Hunt', reason: 'Replacement selected.' })
    await saveActiveMissionDB(missionB)
    missions.push(missionB)
  })

  afterAll(async () => {
    if (!userId) return
    for (const mission of missions) await db.userSetting.deleteMany({ where: { userId, key: { contains: mission.id } } })
    await db.user.delete({ where: { id: userId } }).catch(() => {})
  })

  test('folds real control events from multiple missions into one persistent per-leader record', async () => {
    const record = await getLeaderPerformanceRecord(userId, 'aurora')
    expect(record.missionsInvolved).toBe(2)
    expect(record.stagesAdvanced).toBe(1)
    expect(record.escalations).toBe(1)
    expect(record.timesReplaced).toBe(1)
  })

  test('the composite "id/DisplayName" string REPLAN events use is parsed to the plain id, not mis-keyed', async () => {
    const ledger = await getLeadershipPerformanceLedger(userId)
    expect(ledger.some((record) => record.leaderId === 'aurora/Aurora')).toBe(false)
    expect(ledger.some((record) => record.leaderId === 'aurora')).toBe(true)
  })

  test('reliability score is stagesAdvanced over resolved outcomes (advances + escalations + replacements)', async () => {
    const record = await getLeaderPerformanceRecord(userId, 'aurora')
    // 1 advance / (1 advance + 1 escalation + 1 replacement) = 1/3
    expect(record.reliabilityScore).toBeCloseTo(1 / 3, 3)
  })

  test('a leader with a real governance mandate carries it through; one with none stays honestly null', async () => {
    const aurora = await getLeaderPerformanceRecord(userId, 'aurora')
    expect(aurora.mandate?.class).toBe('creation')
    const unknown = await getLeaderPerformanceRecord(userId, 'not-a-real-leader')
    expect(unknown.mandate).toBeNull()
    expect(unknown.missionsInvolved).toBe(0)
    expect(unknown.reliabilityScore).toBe(0)
  })
})
