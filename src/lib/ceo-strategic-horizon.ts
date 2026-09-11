import { db } from './db'
import { listActiveMissionsDB } from './active-missions-db'
import type { ActiveMission } from './active-missions'

const horizonKey = (userId: string) => `strategic_horizon:${userId}`

export interface StrategicHorizonState {
  // A single long-term statement, or null when the CEO has never been given one -- never a
  // fabricated default. Set via setVision(); read verbatim, never inferred from prompt text.
  vision: string | null
  // Each keyed by its own period label (e.g. annual by "2026", quarterly by "2026-Q1", monthly by
  // "2026-09") so entries persist across periods rather than only ever holding "the current one".
  annual: Record<string, string[]>
  quarterly: Record<string, string[]>
  monthly: Record<string, string[]>
  updatedAt: string | null
}

const EMPTY_HORIZON_STATE: StrategicHorizonState = { vision: null, annual: {}, quarterly: {}, monthly: {}, updatedAt: null }

export function currentYearLabel(now: Date = new Date()): string { return String(now.getUTCFullYear()) }
export function currentQuarterLabel(now: Date = new Date()): string { return `${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}` }
export function currentMonthLabel(now: Date = new Date()): string { return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}` }

async function readHorizonState(userId: string): Promise<StrategicHorizonState> {
  const row = await db.memory.findUnique({ where: { key: horizonKey(userId) } })
  if (!row) return EMPTY_HORIZON_STATE
  try { return { ...EMPTY_HORIZON_STATE, ...(JSON.parse(row.value) as Partial<StrategicHorizonState>) } } catch { return EMPTY_HORIZON_STATE }
}

async function writeHorizonState(userId: string, state: StrategicHorizonState): Promise<StrategicHorizonState> {
  const next: StrategicHorizonState = { ...state, updatedAt: new Date().toISOString() }
  const value = JSON.stringify(next)
  await db.memory.upsert({ where: { key: horizonKey(userId) }, update: { value, category: 'strategic_horizon' }, create: { key: horizonKey(userId), value, category: 'strategic_horizon' } })
  return next
}

export async function getStrategicHorizonState(userId: string): Promise<StrategicHorizonState> { return readHorizonState(userId) }

export async function setVision(userId: string, text: string): Promise<StrategicHorizonState> {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('A vision statement cannot be empty.')
  const state = await readHorizonState(userId)
  return writeHorizonState(userId, { ...state, vision: trimmed })
}

function addToPeriod(record: Record<string, string[]>, period: string, text: string): Record<string, string[]> {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('A strategy entry cannot be empty.')
  const existing = record[period] ?? []
  if (existing.includes(trimmed)) return record
  return { ...record, [period]: [...existing, trimmed] }
}

export async function addAnnualStrategy(userId: string, year: string, text: string): Promise<StrategicHorizonState> {
  const state = await readHorizonState(userId)
  return writeHorizonState(userId, { ...state, annual: addToPeriod(state.annual, year, text) })
}

export async function addQuarterlyObjective(userId: string, quarter: string, text: string): Promise<StrategicHorizonState> {
  const state = await readHorizonState(userId)
  return writeHorizonState(userId, { ...state, quarterly: addToPeriod(state.quarterly, quarter, text) })
}

export async function addMonthlyPriority(userId: string, month: string, text: string): Promise<StrategicHorizonState> {
  const state = await readHorizonState(userId)
  return writeHorizonState(userId, { ...state, monthly: addToPeriod(state.monthly, month, text) })
}

export interface WeeklyMissionBridgeItem { id: string; title: string; stage: ActiveMission['currentStage']; createdAt: string }

function isoWeekStart(now: Date): Date {
  const day = (now.getUTCDay() + 6) % 7 // Monday = 0
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day))
  return start
}

// A real bridge to mission-supervisor.ts's own persisted missions -- "this week's missions" is
// derived from actual ActiveMission rows created this week, never a separately-maintained list
// that could drift from what missions genuinely exist.
export async function getWeeklyMissionsBridge(userId: string, now: Date = new Date()): Promise<readonly WeeklyMissionBridgeItem[]> {
  const weekStart = isoWeekStart(now).getTime()
  const missions = await listActiveMissionsDB(userId)
  return missions
    .filter((mission) => Date.parse(mission.createdAt) >= weekStart)
    .map((mission) => ({ id: mission.id, title: mission.title, stage: mission.currentStage, createdAt: mission.createdAt }))
}

export interface TodaysActionBridgeItem { missionId: string; title: string; nextAction: string | null }

// mission-supervisor.ts already computes exactly this signal per mission (MissionSupervisorState
// .nextAction) -- reading its persisted state directly here (same db.userSetting key it writes,
// stateKey = `mission_supervisor_state_${ownerId}:${missionId}`) rather than importing
// mission-supervisor.ts itself, whose module graph pulls in autonomy-manager.ts's next-auth
// dependency and is otherwise unrelated to this read-only bridge.
async function readMissionNextAction(userId: string, missionId: string): Promise<string | null> {
  const row = await db.userSetting.findFirst({ where: { userId, key: `mission_supervisor_state_${userId}:${missionId}` } })
  if (!row) return null
  try { return (JSON.parse(row.value) as { nextAction?: string | null }).nextAction ?? null } catch { return null }
}

export async function getTodaysActionsBridge(userId: string): Promise<readonly TodaysActionBridgeItem[]> {
  const missions = await listActiveMissionsDB(userId)
  const active = missions.filter((mission) => mission.currentStage !== 'COMPLETED')
  const items = await Promise.all(active.map(async (mission) => ({ missionId: mission.id, title: mission.title, nextAction: await readMissionNextAction(userId, mission.id) })))
  return items.filter((item) => item.nextAction)
}

export interface StrategicHorizonView {
  vision: string | null
  annualStrategy: readonly string[]
  quarterlyObjectives: readonly string[]
  monthlyPriorities: readonly string[]
  weeklyMissions: readonly WeeklyMissionBridgeItem[]
  todaysActions: readonly TodaysActionBridgeItem[]
}

// The full vision -> annual -> quarterly -> monthly -> weekly -> daily bridge: the top 4 levels
// are whatever has genuinely been persisted for the CURRENT period (empty, honestly, when nothing
// has been set for it), and the bottom 2 levels are live bridges into mission-supervisor.ts's own
// real mission and next-action state -- never a second, separately-maintained copy of it.
export async function getStrategicHorizonView(userId: string, now: Date = new Date()): Promise<StrategicHorizonView> {
  const [state, weeklyMissions, todaysActions] = await Promise.all([
    readHorizonState(userId),
    getWeeklyMissionsBridge(userId, now),
    getTodaysActionsBridge(userId),
  ])
  return {
    vision: state.vision,
    annualStrategy: state.annual[currentYearLabel(now)] ?? [],
    quarterlyObjectives: state.quarterly[currentQuarterLabel(now)] ?? [],
    monthlyPriorities: state.monthly[currentMonthLabel(now)] ?? [],
    weeklyMissions,
    todaysActions,
  }
}

export function renderStrategicHorizonContext(view: StrategicHorizonView): string {
  const lines = [
    `Vision: ${view.vision ?? 'not set.'}`,
    `Annual strategy: ${view.annualStrategy.length ? view.annualStrategy.join('; ') : 'none set for this year.'}`,
    `Quarterly objectives: ${view.quarterlyObjectives.length ? view.quarterlyObjectives.join('; ') : 'none set for this quarter.'}`,
    `Monthly priorities: ${view.monthlyPriorities.length ? view.monthlyPriorities.join('; ') : 'none set for this month.'}`,
    `This week's missions: ${view.weeklyMissions.length ? view.weeklyMissions.map((mission) => `${mission.title} (${mission.stage})`).join('; ') : 'none created this week.'}`,
    `Today's actions: ${view.todaysActions.length ? view.todaysActions.map((action) => `${action.title}: ${action.nextAction}`).join('; ') : 'no pending next actions recorded.'}`,
  ]
  return lines.join('\n')
}
