import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { db } from '../src/lib/db'
import {
  classifyPartnerHealth,
  EMPTY_PARTNER_INTELLIGENCE,
  getPartnerIntelligence,
  renderPartnerIntelligenceContext,
  type PartnerIntelligenceSummary,
} from '../src/lib/ceo-partner-intelligence'

describe('classifyPartnerHealth', () => {
  test('an active, recently-touched partnership with revenue is thriving', () => {
    expect(classifyPartnerHealth('active', 10, 500)).toBe('thriving')
  })

  test('an active, recently-touched partnership with no revenue yet is stable, not thriving', () => {
    expect(classifyPartnerHealth('active', 10, 0)).toBe('stable')
  })

  test('an active partnership untouched for a moderate period is stable', () => {
    expect(classifyPartnerHealth('active', 60, 1000)).toBe('stable')
  })

  test('an active partnership untouched for a long period is at_risk', () => {
    expect(classifyPartnerHealth('active', 120, 1000)).toBe('at_risk')
  })

  test('a non-active partnership touched recently is at_risk, not immediately dormant', () => {
    expect(classifyPartnerHealth('proposed', 5, 0)).toBe('at_risk')
  })

  test('a non-active partnership untouched for a long period is dormant', () => {
    expect(classifyPartnerHealth('paused', 90, 0)).toBe('dormant')
  })
})

describe('renderPartnerIntelligenceContext', () => {
  test('honestly reports unfetched data as unavailable, not as zero partners', () => {
    expect(renderPartnerIntelligenceContext(EMPTY_PARTNER_INTELLIGENCE)).toBe('Partner relationship data was not fetched for this turn.')
  })

  test('reports a genuinely empty partner list distinctly from unfetched data', () => {
    const summary: PartnerIntelligenceSummary = { ...EMPTY_PARTNER_INTELLIGENCE, dataAvailable: true }
    expect(renderPartnerIntelligenceContext(summary)).toBe('No partnerships tracked yet.')
  })

  test('summarizes real partner data, including at-risk partners', () => {
    const summary: PartnerIntelligenceSummary = {
      dataAvailable: true,
      totalPartners: 2,
      activePartners: 1,
      atRiskCount: 1,
      dormantCount: 0,
      totalRevenueGenerated: 500,
      topPartners: [{ id: '1', partnerName: 'Acme Co', partnerType: 'referral', status: 'active', revenueGenerated: 500, commissionRate: 15, daysSinceUpdate: 5, health: 'thriving' }],
      atRiskPartners: [{ id: '2', partnerName: 'Stale Partner', partnerType: 'affiliate', status: 'active', revenueGenerated: 0, commissionRate: 10, daysSinceUpdate: 100, health: 'at_risk' }],
    }
    const rendered = renderPartnerIntelligenceContext(summary)
    expect(rendered).toContain('2 partnership(s) tracked')
    expect(rendered).toContain('Acme Co')
    expect(rendered).toContain('At risk: Stale Partner')
  })
})

describe('getPartnerIntelligence (real database)', () => {
  const suffix = `${Date.now()}_${randomUUID().slice(0, 8)}`
  let userId = ''

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for getPartnerIntelligence integration tests.')
    const user = await db.user.create({ data: { email: `ci-partner-${suffix}@example.test`, passwordHash: 'ci-only-hash', name: 'CI Partner Test Owner' }, select: { id: true } })
    userId = user.id
    const now = new Date()
    const old = new Date(now.getTime() - 120 * 86_400_000)
    await db.partnership.createMany({
      data: [
        { userId, partnerName: 'Thriving Referral Co', partnerType: 'referral', status: 'active', revenueGenerated: 1200, commissionRate: 15, updatedAt: now },
        { userId, partnerName: 'Stale Active Partner', partnerType: 'affiliate', status: 'active', revenueGenerated: 0, commissionRate: 10, updatedAt: old },
        { userId, partnerName: 'Ended Partnership', partnerType: 'reseller', status: 'ended', revenueGenerated: 50, commissionRate: 5, updatedAt: old },
      ],
    })
  })

  afterAll(async () => {
    if (!userId) return
    await db.partnership.deleteMany({ where: { userId } })
    await db.user.delete({ where: { id: userId } }).catch(() => {})
  })

  test('a user with no partnerships gets an honest, genuinely-empty summary (dataAvailable true, zero counts)', async () => {
    const emptyUser = await db.user.create({ data: { email: `ci-partner-empty-${suffix}@example.test`, passwordHash: 'ci-only-hash', name: 'CI Partner Empty Owner' }, select: { id: true } })
    try {
      const summary = await getPartnerIntelligence(emptyUser.id)
      expect(summary).toEqual({ ...EMPTY_PARTNER_INTELLIGENCE, dataAvailable: true })
    } finally {
      await db.user.delete({ where: { id: emptyUser.id } }).catch(() => {})
    }
  })

  test('real partnership rows are classified and aggregated from actual database state', async () => {
    const summary = await getPartnerIntelligence(userId)
    expect(summary.dataAvailable).toBe(true)
    expect(summary.totalPartners).toBe(3)
    expect(summary.activePartners).toBe(2)
    expect(summary.totalRevenueGenerated).toBe(1250)
    expect(summary.topPartners[0]?.partnerName).toBe('Thriving Referral Co')
    expect(summary.topPartners[0]?.health).toBe('thriving')
    const staleSignal = summary.topPartners.find((signal) => signal.partnerName === 'Stale Active Partner')
    expect(staleSignal?.health).toBe('at_risk')
    expect(summary.atRiskPartners.some((signal) => signal.partnerName === 'Stale Active Partner')).toBe(true)
    const endedSignal = summary.topPartners.find((signal) => signal.partnerName === 'Ended Partnership')
    expect(endedSignal?.health).toBe('dormant')
    expect(summary.dormantCount).toBe(1)
  })
})
