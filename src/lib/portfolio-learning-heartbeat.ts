import { db } from './db'
import { runContinuousPortfolioLearningCycle, type PortfolioLearningCycleResult } from './portfolio-learning'
import { getDueWork, markDueWorkCompleted } from './autonomy-due-work'

const LEASE_KEY = 'portfolio-intelligence:heartbeat:lease'
const LAST_RESULT_KEY = 'portfolio-intelligence:heartbeat:last'
const LEASE_TTL_MS = 15 * 60 * 1000
const COOLDOWN_MS = 45 * 60 * 1000
const DUE_INTERVAL_MS = 45 * 60 * 1000

export interface PortfolioLearningHeartbeatResult {
  status: 'ran' | 'skipped'
  reason: string
  cycle?: PortfolioLearningCycleResult
}

export async function runPortfolioLearningHeartbeat(): Promise<PortfolioLearningHeartbeatResult> {
  const now = Date.now()
  const due = await getDueWork('portfolio-learning', DUE_INTERVAL_MS, now)
  if (!due.due) return { status: 'skipped', reason: 'portfolio-learning-not-due' }

  const existing = await db.memory.findUnique({ where: { key: LEASE_KEY }, select: { value: true } })
  if (existing) {
    try {
      const lease = JSON.parse(existing.value) as { startedAt?: number }
      if (typeof lease.startedAt === 'number' && now - lease.startedAt < LEASE_TTL_MS) {
        return { status: 'skipped', reason: 'portfolio-learning-lease-held' }
      }
      await db.memory.delete({ where: { key: LEASE_KEY } }).catch(() => {})
    } catch {
      await db.memory.delete({ where: { key: LEASE_KEY } }).catch(() => {})
    }
  }

  const previous = await db.memory.findUnique({ where: { key: LAST_RESULT_KEY }, select: { value: true } })
  if (previous) {
    try {
      const last = JSON.parse(previous.value) as { completedAt?: number }
      if (typeof last.completedAt === 'number' && now - last.completedAt < COOLDOWN_MS) {
        return { status: 'skipped', reason: 'portfolio-learning-cooldown' }
      }
    } catch {
      // Malformed telemetry is non-authoritative; the due-work gate remains authoritative.
    }
  }

  try {
    await db.memory.create({
      data: {
        key: LEASE_KEY,
        category: 'portfolio_intelligence_heartbeat_lease',
        value: JSON.stringify({ startedAt: now }),
      },
    })
  } catch {
    return { status: 'skipped', reason: 'portfolio-learning-lease-contended' }
  }

  try {
    const cycle = await runContinuousPortfolioLearningCycle()
    await db.memory.upsert({
      where: { key: LAST_RESULT_KEY },
      update: { category: 'portfolio_intelligence_heartbeat', value: JSON.stringify({ completedAt: Date.now(), measured: cycle.measured, completedExperiments: cycle.completedExperiments.length, replanned: Boolean(cycle.replan) }) },
      create: { key: LAST_RESULT_KEY, category: 'portfolio_intelligence_heartbeat', value: JSON.stringify({ completedAt: Date.now(), measured: cycle.measured, completedExperiments: cycle.completedExperiments.length, replanned: Boolean(cycle.replan) }) },
    })
    await markDueWorkCompleted('portfolio-learning', Date.now())
    return { status: 'ran', reason: 'portfolio-learning-cycle-completed', cycle }
  } finally {
    await db.memory.delete({ where: { key: LEASE_KEY } }).catch(() => {})
  }
}
