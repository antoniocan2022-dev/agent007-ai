import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { db } from '../src/lib/db'
import {
  EMPTY_EXECUTIVE_BUSINESS_STATE,
  getExecutiveBusinessState,
  renderExecutiveBusinessStateContext,
  type ExecutiveBusinessState,
} from '../src/lib/ceo-executive-state'

describe('renderExecutiveBusinessStateContext', () => {
  test('honestly reports every unfetched dimension as unavailable, not as empty/zero', () => {
    const rendered = renderExecutiveBusinessStateContext(EMPTY_EXECUTIVE_BUSINESS_STATE)
    expect(rendered).toContain('Strategy: not fetched for this turn.')
    expect(rendered).toContain('Risk/readiness: not evaluated for this turn')
    expect(rendered).toContain('Customer relationships: not evaluated for this turn')
    expect(rendered).toContain('Resources: not evaluated for this turn')
  })

  test('reports a genuinely empty strategy list distinctly from unfetched data', () => {
    const state: ExecutiveBusinessState = { ...EMPTY_EXECUTIVE_BUSINESS_STATE, strategy: { dataAvailable: true, items: [] } }
    expect(renderExecutiveBusinessStateContext(state)).toContain('Strategy: no active strategy items tracked.')
  })

  test('summarizes real strategy, risk, customer and resource data when available', () => {
    const state: ExecutiveBusinessState = {
      vision: { dataAvailable: false },
      strategy: { dataAvailable: true, items: [{ id: 's1', phase: 'growth', title: 'Launch referral program', status: 'in_progress', priority: 'high', progress: 0.4, targetDate: null }] },
      risk: { dataAvailable: true, ventureId: 'venture_001', status: 'READY', score: 100, threshold: 80, missingEvidence: [] },
      customers: { dataAvailable: true, ventureId: 'venture_001', totalCustomersWithState: 12, atRisk: 2, churned: 1, averageHealthScore: 78.5 },
      resources: { dataAvailable: true, ventureId: 'venture_001', grossRevenue: 1000, netRevenue: 900, currency: 'usd', autonomyMode: 'AUTONOMOUS', leaseHealthy: true },
      decisions: { dataAvailable: true, total: 3, open: 1, awaitingOutcome: 1, overdueReview: 0 },
    }
    const rendered = renderExecutiveBusinessStateContext(state)
    expect(rendered).toContain('Launch referral program')
    expect(rendered).toContain('Risk/readiness: READY (score 100/80)')
    expect(rendered).toContain('12 tracked, 2 at risk, 1 churned')
    expect(rendered).toContain('$1000.00 gross / $900.00 net revenue')
    expect(rendered).toContain('autonomy AUTONOMOUS')
    expect(rendered).toContain('Executive decisions: 3 recorded, 1 open, 1 awaiting outcome.')
  })

  test('reports the executive decision ledger honestly for empty, populated and overdue states', () => {
    expect(renderExecutiveBusinessStateContext({ ...EMPTY_EXECUTIVE_BUSINESS_STATE, decisions: { dataAvailable: false, total: 0, open: 0, awaitingOutcome: 0, overdueReview: 0 } })).toContain('Executive decisions: not evaluated for this turn.')
    expect(renderExecutiveBusinessStateContext({ ...EMPTY_EXECUTIVE_BUSINESS_STATE, decisions: { dataAvailable: true, total: 0, open: 0, awaitingOutcome: 0, overdueReview: 0 } })).toContain('Executive decisions: none recorded yet.')
    expect(renderExecutiveBusinessStateContext({ ...EMPTY_EXECUTIVE_BUSINESS_STATE, decisions: { dataAvailable: true, total: 2, open: 1, awaitingOutcome: 1, overdueReview: 1 } })).toContain('1 overdue for review')
  })
})

describe('getExecutiveBusinessState (real database)', () => {
  const suffix = `${Date.now()}_${randomUUID().slice(0, 8)}`
  let userId = ''

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for getExecutiveBusinessState integration tests.')
    const user = await db.user.create({ data: { email: `ci-executive-${suffix}@example.test`, passwordHash: 'ci-only-hash', name: 'CI Executive Test Owner' }, select: { id: true } })
    userId = user.id
    await db.businessStrategy.createMany({
      data: [
        { userId, phase: 'growth', title: 'Active high-priority strategy', description: 'test', status: 'active', priority: 'high', progress: 0.6 },
        { userId, phase: 'foundation', title: 'Planned low-priority strategy', description: 'test', status: 'planned', priority: 'low', progress: 0 },
        { userId, phase: 'foundation', title: 'Completed strategy (should be excluded)', description: 'test', status: 'completed', priority: 'high', progress: 1 },
      ],
    })
  })

  afterAll(async () => {
    if (!userId) return
    await db.businessStrategy.deleteMany({ where: { userId } })
    await db.user.delete({ where: { id: userId } }).catch(() => {})
  })

  test('reads real, active/planned/in_progress BusinessStrategy rows, excluding completed ones, ordered by priority', async () => {
    const state = await getExecutiveBusinessState({ userId })
    expect(state.strategy.dataAvailable).toBe(true)
    expect(state.strategy.items.map((item) => item.title)).toEqual(['Active high-priority strategy', 'Planned low-priority strategy'])
    expect(state.strategy.items.some((item) => item.title.includes('Completed'))).toBe(false)
  })

  test('vision is always honestly unavailable -- no fabricated vision statement exists anywhere in this codebase', async () => {
    const state = await getExecutiveBusinessState({ userId })
    expect(state.vision).toEqual({ dataAvailable: false })
  })

  test('without a ventureId, risk/customers/resources stay honestly unavailable rather than defaulting to a fabricated venture', async () => {
    const state = await getExecutiveBusinessState({ userId })
    expect(state.risk.dataAvailable).toBe(false)
    expect(state.customers.dataAvailable).toBe(false)
    expect(state.resources.dataAvailable).toBe(false)
  })

  test('a user with no strategy rows gets an honest, genuinely-empty list (dataAvailable true, zero items)', async () => {
    const emptyUser = await db.user.create({ data: { email: `ci-executive-empty-${suffix}@example.test`, passwordHash: 'ci-only-hash', name: 'CI Executive Empty Owner' }, select: { id: true } })
    try {
      const state = await getExecutiveBusinessState({ userId: emptyUser.id })
      expect(state.strategy).toEqual({ dataAvailable: true, items: [] })
    } finally {
      await db.user.delete({ where: { id: emptyUser.id } }).catch(() => {})
    }
  })
})
