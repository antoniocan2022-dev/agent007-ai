import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { db } from '../src/lib/db'
import { createActiveMissionDB, saveActiveMissionDB } from '../src/lib/active-missions-db'
import type { ActiveMission } from '../src/lib/active-missions'
import {
  addAnnualStrategy,
  addMonthlyPriority,
  addQuarterlyObjective,
  currentMonthLabel,
  currentQuarterLabel,
  currentYearLabel,
  getStrategicHorizonState,
  getStrategicHorizonView,
  getTodaysActionsBridge,
  getWeeklyMissionsBridge,
  renderStrategicHorizonContext,
  setVision,
  type StrategicHorizonView,
} from '../src/lib/ceo-strategic-horizon'

describe('period labels', () => {
  test('currentYearLabel/currentQuarterLabel/currentMonthLabel derive from the real date, not a hardcoded value', () => {
    expect(currentYearLabel(new Date('2026-09-11T00:00:00Z'))).toBe('2026')
    expect(currentQuarterLabel(new Date('2026-09-11T00:00:00Z'))).toBe('2026-Q3')
    expect(currentQuarterLabel(new Date('2026-01-01T00:00:00Z'))).toBe('2026-Q1')
    expect(currentMonthLabel(new Date('2026-09-11T00:00:00Z'))).toBe('2026-09')
  })
})

describe('renderStrategicHorizonContext', () => {
  test('honestly reports every unset level instead of fabricating content', () => {
    const view: StrategicHorizonView = { vision: null, annualStrategy: [], quarterlyObjectives: [], monthlyPriorities: [], weeklyMissions: [], todaysActions: [], openDecisions: { total: 0, open: 0, awaitingOutcome: 0, overdueReview: 0 } }
    const rendered = renderStrategicHorizonContext(view)
    expect(rendered).toContain('Vision: not set.')
    expect(rendered).toContain('Annual strategy: none set for this year.')
    expect(rendered).toContain("This week's missions: none created this week.")
    expect(rendered).toContain("Today's actions: no pending next actions recorded.")
    expect(rendered).toContain('Executive decisions: none recorded yet.')
  })

  test('renders real populated content', () => {
    const view: StrategicHorizonView = {
      vision: 'Build a self-sustaining autonomous venture portfolio.',
      annualStrategy: ['Reach profitability'],
      quarterlyObjectives: ['Launch venture_002'],
      monthlyPriorities: ['Close partner integrations'],
      weeklyMissions: [{ id: 'm1', title: 'Ship affiliate tracker fix', stage: 'IN_PROGRESS', createdAt: new Date().toISOString() }],
      todaysActions: [{ missionId: 'm1', title: 'Ship affiliate tracker fix', nextAction: 'Run the newly active stage leader.' }],
      openDecisions: { total: 4, open: 2, awaitingOutcome: 2, overdueReview: 1 },
    }
    const rendered = renderStrategicHorizonContext(view)
    expect(rendered).toContain('Build a self-sustaining autonomous venture portfolio.')
    expect(rendered).toContain('Ship affiliate tracker fix (IN_PROGRESS)')
    expect(rendered).toContain('Ship affiliate tracker fix: Run the newly active stage leader.')
    expect(rendered).toContain('Executive decisions: 4 recorded, 2 open, 2 awaiting outcome, 1 overdue for review.')
  })
})

describe('strategic horizon (real database)', () => {
  const suffix = `${Date.now()}_${randomUUID().slice(0, 8)}`
  let userId = ''
  const missions: ActiveMission[] = []

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for strategic horizon integration tests.')
    const user = await db.user.create({ data: { email: `ci-horizon-${suffix}@example.test`, passwordHash: 'ci-only-hash', name: 'CI Horizon Test Owner' }, select: { id: true } })
    userId = user.id
  })

  afterAll(async () => {
    if (!userId) return
    await db.memory.deleteMany({ where: { key: `strategic_horizon:${userId}` } })
    for (const mission of missions) await db.userSetting.deleteMany({ where: { userId, key: { contains: mission.id } } })
    await db.user.delete({ where: { id: userId } }).catch(() => {})
  })

  test('a user with no persisted horizon gets the honest empty default', async () => {
    const state = await getStrategicHorizonState(userId)
    expect(state.vision).toBeNull()
    expect(state.annual).toEqual({})
  })

  test('setVision and addAnnualStrategy/addQuarterlyObjective/addMonthlyPriority persist real, period-scoped entries', async () => {
    await setVision(userId, 'Build a self-sustaining autonomous venture portfolio.')
    const now = new Date()
    await addAnnualStrategy(userId, currentYearLabel(now), 'Reach profitability')
    await addQuarterlyObjective(userId, currentQuarterLabel(now), 'Launch venture_002')
    await addMonthlyPriority(userId, currentMonthLabel(now), 'Close partner integrations')

    const view = await getStrategicHorizonView(userId, now)
    expect(view.vision).toBe('Build a self-sustaining autonomous venture portfolio.')
    expect(view.annualStrategy).toEqual(['Reach profitability'])
    expect(view.quarterlyObjectives).toEqual(['Launch venture_002'])
    expect(view.monthlyPriorities).toEqual(['Close partner integrations'])
  })

  test('adding the same entry twice does not duplicate it', async () => {
    const now = new Date()
    await addAnnualStrategy(userId, currentYearLabel(now), 'Reach profitability')
    const view = await getStrategicHorizonView(userId, now)
    expect(view.annualStrategy).toEqual(['Reach profitability'])
  })

  test('an entry set for a different period does not leak into the current one', async () => {
    await addAnnualStrategy(userId, '2099', 'A far-future entry')
    const view = await getStrategicHorizonView(userId, new Date())
    expect(view.annualStrategy).not.toContain('A far-future entry')
  })

  test('weekly missions bridge reflects real ActiveMission rows created this week, not a separately-maintained list', async () => {
    const mission = await createActiveMissionDB({ ownerId: userId, title: 'Horizon Bridge Mission', description: 'test' })
    if (!mission) throw new Error('createActiveMissionDB returned null')
    missions.push(mission)
    const bridge = await getWeeklyMissionsBridge(userId)
    expect(bridge.some((item) => item.id === mission.id)).toBe(true)
  })

  test("today's actions bridge reads mission-supervisor.ts's own persisted nextAction, and omits missions with none recorded", async () => {
    const mission = await createActiveMissionDB({ ownerId: userId, title: 'Mission With Next Action', description: 'test' })
    if (!mission) throw new Error('createActiveMissionDB returned null')
    missions.push(mission)
    await db.userSetting.create({ data: { userId, key: `mission_supervisor_state_${userId}:${mission.id}`, value: JSON.stringify({ nextAction: 'Verify the stage artifact.' }) } })

    const bridge = await getTodaysActionsBridge(userId)
    const entry = bridge.find((item) => item.missionId === mission.id)
    expect(entry?.nextAction).toBe('Verify the stage artifact.')
  })

  test("a completed mission is excluded from today's actions", async () => {
    const mission = await createActiveMissionDB({ ownerId: userId, title: 'Completed Mission', description: 'test' })
    if (!mission) throw new Error('createActiveMissionDB returned null')
    mission.currentStage = 'COMPLETED'
    await saveActiveMissionDB(mission)
    missions.push(mission)
    await db.userSetting.create({ data: { userId, key: `mission_supervisor_state_${userId}:${mission.id}`, value: JSON.stringify({ nextAction: 'Should never appear.' }) } })

    const bridge = await getTodaysActionsBridge(userId)
    expect(bridge.some((item) => item.missionId === mission.id)).toBe(false)
  })
})
