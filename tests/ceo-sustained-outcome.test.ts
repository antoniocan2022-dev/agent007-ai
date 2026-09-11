import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { db } from '../src/lib/db'
import { assessSustainedBusinessOutcome } from '../src/lib/ceo-sustained-outcome'

function fakeSnapshot(overrides: { netRevenue: number; syntheticRevenueDetected: boolean }) {
  return { outcomes: { netRevenue: overrides.netRevenue }, controlHealth: { syntheticRevenueDetected: overrides.syntheticRevenueDetected } }
}

describe('assessSustainedBusinessOutcome (real database)', () => {
  const ventureId = `ci-sustained-outcome-${Date.now()}-${randomUUID().slice(0, 8)}`

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for sustained-outcome integration tests.')
  })

  afterEach(async () => {
    if (!process.env.DATABASE_URL) return
    await db.memory.deleteMany({ where: { category: 'operational_kpi_snapshot', key: { startsWith: `operational-kpi:${ventureId}:` } } })
  })

  afterAll(async () => {
    if (!process.env.DATABASE_URL) return
    await db.memory.deleteMany({ where: { category: 'operational_kpi_snapshot', key: { startsWith: `operational-kpi:${ventureId}:` } } })
  })

  test('rejects a non-positive windows argument', async () => {
    await expect(assessSustainedBusinessOutcome(ventureId, 0)).rejects.toThrow('windows must be a positive integer')
  })

  test('with no persisted KPI history, sustained is honestly false rather than assumed true', async () => {
    const result = await assessSustainedBusinessOutcome(ventureId)
    expect(result.windowsFound).toBe(0)
    expect(result.sustained).toBe(false)
  })

  test('3 consecutive real revenue-positive, non-synthetic windows are reported as sustained', async () => {
    for (let i = 0; i < 3; i++) {
      await db.memory.create({ data: { key: `operational-kpi:${ventureId}:win-${i}`, category: 'operational_kpi_snapshot', value: JSON.stringify(fakeSnapshot({ netRevenue: 100, syntheticRevenueDetected: false })) } })
    }
    const result = await assessSustainedBusinessOutcome(ventureId, 3)
    expect(result.windowsFound).toBe(3)
    expect(result.positiveWindows).toBe(3)
    expect(result.regressedWindows).toBe(0)
    expect(result.sustained).toBe(true)
  })

  test('a single non-positive or synthetic window among several breaks sustained status', async () => {
    await db.memory.create({ data: { key: `operational-kpi:${ventureId}:good-1`, category: 'operational_kpi_snapshot', value: JSON.stringify(fakeSnapshot({ netRevenue: 100, syntheticRevenueDetected: false })) } })
    await db.memory.create({ data: { key: `operational-kpi:${ventureId}:bad`, category: 'operational_kpi_snapshot', value: JSON.stringify(fakeSnapshot({ netRevenue: -10, syntheticRevenueDetected: false })) } })
    await db.memory.create({ data: { key: `operational-kpi:${ventureId}:good-2`, category: 'operational_kpi_snapshot', value: JSON.stringify(fakeSnapshot({ netRevenue: 100, syntheticRevenueDetected: false })) } })
    const result = await assessSustainedBusinessOutcome(ventureId, 3)
    expect(result.regressedWindows).toBe(1)
    expect(result.sustained).toBe(false)
  })

  test('synthetic revenue disqualifies a window even when netRevenue is positive', async () => {
    for (let i = 0; i < 3; i++) {
      await db.memory.create({ data: { key: `operational-kpi:${ventureId}:synthetic-${i}`, category: 'operational_kpi_snapshot', value: JSON.stringify(fakeSnapshot({ netRevenue: 500, syntheticRevenueDetected: true })) } })
    }
    const result = await assessSustainedBusinessOutcome(ventureId, 3)
    expect(result.positiveWindows).toBe(0)
    expect(result.sustained).toBe(false)
  })

  test('fewer windows found than requested is honestly not sustained, even if all found ones were positive', async () => {
    await db.memory.create({ data: { key: `operational-kpi:${ventureId}:only-one`, category: 'operational_kpi_snapshot', value: JSON.stringify(fakeSnapshot({ netRevenue: 100, syntheticRevenueDetected: false })) } })
    const result = await assessSustainedBusinessOutcome(ventureId, 3)
    expect(result.windowsFound).toBe(1)
    expect(result.regressedWindows).toBe(0)
    expect(result.sustained).toBe(false)
  })
})
