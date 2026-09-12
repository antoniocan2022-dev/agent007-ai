import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { db } from '../src/lib/db'
import {
  recordCeoRecommendation,
  recordObservedRecommendationOutcome,
  linkRecommendationToMission,
  listMissionsForRecommendation,
  summarizeRecommendationLedger,
  closeRecommendationWithSustainedOutcome,
  listOpenRecommendationsForVenture,
} from '../src/lib/ceo-outcome-learning'

function fakeSnapshot(overrides: { netRevenue: number; syntheticRevenueDetected: boolean }) {
  return { outcomes: { netRevenue: overrides.netRevenue }, controlHealth: { syntheticRevenueDetected: overrides.syntheticRevenueDetected } }
}

async function seedKpiWindows(ventureId: string, count: number, overrides: { netRevenue: number; syntheticRevenueDetected: boolean }) {
  for (let i = 0; i < count; i++) {
    await db.memory.create({ data: { key: `operational-kpi:${ventureId}:win-${i}-${randomUUID().slice(0, 6)}`, category: 'operational_kpi_snapshot', value: JSON.stringify(fakeSnapshot(overrides)) } })
  }
}

describe('executive decision ledger (real database)', () => {
  const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const ventureA = `ci-ledger-venture-a-${runId}`
  const ventureB = `ci-ledger-venture-b-${runId}`
  const createdRecommendationIds: string[] = []
  const createdMissionIds: string[] = []

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for executive-decision-ledger integration tests.')
  })

  async function cleanup() {
    if (!process.env.DATABASE_URL) return
    await db.memory.deleteMany({ where: { category: 'operational_kpi_snapshot', key: { startsWith: 'operational-kpi:ci-ledger-venture-' } } })
    for (const id of createdRecommendationIds) {
      await db.memory.deleteMany({ where: { key: `ceo_recommendation_${id}` } })
      await db.memory.deleteMany({ where: { category: 'ceo_recommendation_action', key: { contains: id } } })
      await db.memory.deleteMany({ where: { category: 'ceo_observed_outcome', key: { contains: '' }, value: { contains: id } } }).catch(() => {})
      await db.recommendationMissionLink.deleteMany({ where: { recommendationId: id } }).catch(() => {})
    }
  }

  afterEach(cleanup)
  afterAll(cleanup)

  async function seedRecommendation(overrides: { ventureId?: string; objective?: string } = {}) {
    const rec = await recordCeoRecommendation({
      correlationId: `ci-ledger-rec-${randomUUID()}`,
      objective: overrides.objective ?? 'Increase venture net revenue.',
      responseAction: 'decide',
      ventureId: overrides.ventureId,
    })
    createdRecommendationIds.push(rec.recommendationId)
    return rec
  }

  test('recording a recommendation twice with identical fields is idempotent and writes no duplicate', async () => {
    const correlationId = `ci-ledger-idempotent-${randomUUID()}`
    const first = await recordCeoRecommendation({ correlationId, objective: 'Idempotency check.', responseAction: 'decide', ventureId: ventureA })
    createdRecommendationIds.push(first.recommendationId)
    const second = await recordCeoRecommendation({ correlationId, objective: 'Idempotency check.', responseAction: 'decide', ventureId: ventureA })
    expect(second.recommendationId).toBe(first.recommendationId)
    const rows = await db.memory.findMany({ where: { key: `ceo_recommendation_${correlationId}` } })
    expect(rows.length).toBe(1)
  })

  test('conflicting immutable fields on the same correlationId are rejected', async () => {
    const correlationId = `ci-ledger-conflict-${randomUUID()}`
    const rec = await recordCeoRecommendation({ correlationId, objective: 'Original objective.', responseAction: 'decide', ventureId: ventureA })
    createdRecommendationIds.push(rec.recommendationId)
    await expect(recordCeoRecommendation({ correlationId, objective: 'A completely different objective.', responseAction: 'decide', ventureId: ventureA })).rejects.toThrow('Conflicting CEO recommendation')
  })

  test('two open decisions on the same venture do not cross-close: explicit correlation is required', async () => {
    const recOne = await seedRecommendation({ ventureId: ventureB })
    const recTwo = await seedRecommendation({ ventureId: ventureB })
    await seedKpiWindows(ventureB, 3, { netRevenue: 100, syntheticRevenueDetected: false })
    const closure = await closeRecommendationWithSustainedOutcome({ recommendationId: recOne.recommendationId, ventureId: ventureB })
    expect(closure).not.toBeNull()
    expect(closure!.recommendationId).toBe(recOne.recommendationId)
    const openForVenture = await listOpenRecommendationsForVenture(ventureB)
    const stillOpenIds = openForVenture.map((r) => r.recommendationId)
    expect(stillOpenIds).toContain(recTwo.recommendationId)
    expect(stillOpenIds).not.toContain(recOne.recommendationId)
  })

  test('closeRecommendationWithSustainedOutcome requires both recommendationId and ventureId', async () => {
    await expect(closeRecommendationWithSustainedOutcome({ recommendationId: '', ventureId: ventureA })).rejects.toThrow('recommendationId and ventureId')
    await expect(closeRecommendationWithSustainedOutcome({ recommendationId: 'x', ventureId: '' })).rejects.toThrow('recommendationId and ventureId')
  })

  test('closing the same recommendation twice is idempotent and writes no duplicate outcome record', async () => {
    const rec = await seedRecommendation({ ventureId: ventureA })
    await seedKpiWindows(ventureA, 3, { netRevenue: 100, syntheticRevenueDetected: false })
    const first = await closeRecommendationWithSustainedOutcome({ recommendationId: rec.recommendationId, ventureId: ventureA })
    const second = await closeRecommendationWithSustainedOutcome({ recommendationId: rec.recommendationId, ventureId: ventureA })
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(second!.outcome.outcomeId).toBe(first!.outcome.outcomeId)
    expect(second!.sustained).toBe(first!.sustained)
    const outcomeRows = await db.memory.findMany({ where: { category: 'ceo_observed_outcome' } })
    const matchingRows = outcomeRows.filter((row) => row.value.includes(rec.recommendationId) && row.value.includes('ceo_sustained_outcome_assessment'))
    expect(matchingRows.length).toBe(1)
  })

  test('a single good KPI window (fewer than requested) stays pending, not sustained, and is not force-closed', async () => {
    const rec = await seedRecommendation({ ventureId: ventureA })
    await seedKpiWindows(ventureA, 1, { netRevenue: 100, syntheticRevenueDetected: false })
    const closure = await closeRecommendationWithSustainedOutcome({ recommendationId: rec.recommendationId, ventureId: ventureA, windows: 3 })
    expect(closure).not.toBeNull()
    expect(closure!.sustained).toBe(false)
    expect(closure!.outcome.actualResult).toContain('1/1 positive windows')
  })

  test('zero KPI windows found writes nothing (fail-closed, never guesses)', async () => {
    const rec = await seedRecommendation({ ventureId: `ci-ledger-empty-venture-${randomUUID()}` })
    const closure = await closeRecommendationWithSustainedOutcome({ recommendationId: rec.recommendationId, ventureId: rec.ventureId! })
    expect(closure).toBeNull()
    const correlation = await db.memory.findMany({ where: { category: 'ceo_observed_outcome' } })
    const wroteForThisRec = correlation.some((row) => row.value.includes(rec.recommendationId))
    expect(wroteForThisRec).toBe(false)
  })

  test('a regression after a prior positive window is reflected honestly as not sustained', async () => {
    const rec = await seedRecommendation({ ventureId: ventureA })
    await db.memory.create({ data: { key: `operational-kpi:${ventureA}:good-${randomUUID().slice(0, 6)}`, category: 'operational_kpi_snapshot', value: JSON.stringify(fakeSnapshot({ netRevenue: 100, syntheticRevenueDetected: false })) } })
    await db.memory.create({ data: { key: `operational-kpi:${ventureA}:bad-${randomUUID().slice(0, 6)}`, category: 'operational_kpi_snapshot', value: JSON.stringify(fakeSnapshot({ netRevenue: -50, syntheticRevenueDetected: false })) } })
    await db.memory.create({ data: { key: `operational-kpi:${ventureA}:good2-${randomUUID().slice(0, 6)}`, category: 'operational_kpi_snapshot', value: JSON.stringify(fakeSnapshot({ netRevenue: 100, syntheticRevenueDetected: false })) } })
    const closure = await closeRecommendationWithSustainedOutcome({ recommendationId: rec.recommendationId, ventureId: ventureA, windows: 3 })
    expect(closure).not.toBeNull()
    expect(closure!.sustained).toBe(false)
    expect(closure!.outcome.observedOutcome).toContain('did not confirm a sustained')
  })

  test('closing a recommendation records an observed outcome linked by explicit recommendationId', async () => {
    const rec = await seedRecommendation({ ventureId: ventureA })
    await seedKpiWindows(ventureA, 3, { netRevenue: 100, syntheticRevenueDetected: false })
    const closure = await closeRecommendationWithSustainedOutcome({ recommendationId: rec.recommendationId, ventureId: ventureA })
    expect(closure).not.toBeNull()
    expect(closure!.outcome.recommendationId).toBe(rec.recommendationId)
    expect(closure!.sustained).toBe(true)
    const stillOpen = await listOpenRecommendationsForVenture(ventureA)
    expect(stillOpen.map((r) => r.recommendationId)).not.toContain(rec.recommendationId)
  })

  test('listOpenRecommendationsForVenture never returns recommendations from other ventures', async () => {
    const recA = await seedRecommendation({ ventureId: ventureA })
    const recB = await seedRecommendation({ ventureId: ventureB })
    const openA = await listOpenRecommendationsForVenture(ventureA)
    const openB = await listOpenRecommendationsForVenture(ventureB)
    expect(openA.map((r) => r.recommendationId)).toContain(recA.recommendationId)
    expect(openA.map((r) => r.recommendationId)).not.toContain(recB.recommendationId)
    expect(openB.map((r) => r.recommendationId)).toContain(recB.recommendationId)
    expect(openB.map((r) => r.recommendationId)).not.toContain(recA.recommendationId)
  })

  test('linkRecommendationToMission is idempotent under upsert and requires both ids', async () => {
    const rec = await seedRecommendation({ ventureId: ventureA })
    const missionId = `ci-ledger-mission-${randomUUID()}`
    createdMissionIds.push(missionId)
    const first = await linkRecommendationToMission({ recommendationId: rec.recommendationId, missionId })
    const second = await linkRecommendationToMission({ recommendationId: rec.recommendationId, missionId })
    expect(second.id).toBe(first.id)
    const links = await listMissionsForRecommendation(rec.recommendationId)
    expect(links.length).toBe(1)
    expect(links[0].relation).toBe('implements')
    await expect(linkRecommendationToMission({ recommendationId: '', missionId })).rejects.toThrow('requires recommendationId and missionId')
  })

  test('a legacy mission with no recommendation link stays honestly unlinked (no backfill)', async () => {
    const links = await listMissionsForRecommendation('ci-ledger-nonexistent-recommendation-id')
    expect(links).toEqual([])
  })

  test('summarizeRecommendationLedger counts open and awaiting-outcome decisions honestly, scoped by venture', async () => {
    const scopedVenture = `ci-ledger-summary-venture-${randomUUID()}`
    const recOpen = await seedRecommendation({ ventureId: scopedVenture })
    const recClosed = await seedRecommendation({ ventureId: scopedVenture })
    await recordObservedRecommendationOutcome({
      recommendationId: recClosed.recommendationId,
      observedOutcome: 'Manually observed outcome for summary test.',
      actualResult: 'Positive result confirmed.',
      source: 'test_fixture',
    })
    const summary = await summarizeRecommendationLedger({ ventureId: scopedVenture })
    expect(summary.total).toBe(2)
    expect(summary.open).toBe(1)
    expect(summary.awaitingOutcome).toBe(1)
  })

  test('summarizeRecommendationLedger with an unrelated venture filter reports zero, never fabricates data', async () => {
    const summary = await summarizeRecommendationLedger({ ventureId: `ci-ledger-nonexistent-venture-${randomUUID()}` })
    expect(summary.total).toBe(0)
    expect(summary.open).toBe(0)
    expect(summary.awaitingOutcome).toBe(0)
    expect(summary.overdueReview).toBe(0)
  })
})
