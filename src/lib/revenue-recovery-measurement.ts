import { db } from './db'
import type { FunnelSnapshot, FunnelSnapshotInput } from './revenue-recovery-contract'

function count(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0 }
function money(value: number): number { return Number.isFinite(value) ? Math.max(0, value) : 0 }
function rate(numerator: number, denominator: number): number { return denominator > 0 ? Math.max(0, Math.min(1, numerator / denominator)) : 0 }
function clean(value: string): string { return value.trim().replace(/\s+/g, ' ') }

function snapshotKey(tenantId: string, customerId: string, observedAt: string): string {
  return `revenue_recovery_snapshot:${tenantId}:${customerId}:${observedAt}`
}

export function buildFunnelSnapshot(input: FunnelSnapshotInput): FunnelSnapshot {
  if (!clean(input.tenantId) || !clean(input.customerId) || !clean(input.source)) throw new Error('tenantId, customerId and source are required.')
  const leads = count(input.leadCount)
  const contacted = count(input.contactedCount)
  const booked = count(input.bookedCount)
  const shows = count(input.showCount)
  const noShows = count(input.noShowCount)
  const won = count(input.wonCount)
  if (contacted > leads || booked > contacted || shows > booked || noShows > booked || won > shows) throw new Error('Funnel counts violate stage ordering.')
  if (leads > 0 && money(input.averageTransactionValue) <= 0) throw new Error('averageTransactionValue must be positive when leads exist.')
  const confidence = Math.round((0.55 * Math.min(1, leads / 30) + 0.30 * (clean(input.source).length >= 4 ? 1 : 0) + 0.15 * (leads > 0 ? 1 : 0.2)) * 100) / 100
  return {
    ...input,
    tenantId: clean(input.tenantId), customerId: clean(input.customerId), source: clean(input.source),
    leadCount: leads, contactedCount: contacted, bookedCount: booked, showCount: shows, noShowCount: noShows, wonCount: won,
    staleOpportunityCount: count(input.staleOpportunityCount), missedCallCount: count(input.missedCallCount), averageTransactionValue: money(input.averageTransactionValue),
    averageResponseMinutes: input.averageResponseMinutes !== null && Number.isFinite(input.averageResponseMinutes) ? input.averageResponseMinutes : null,
    grossMarginPercent: input.grossMarginPercent !== null && Number.isFinite(input.grossMarginPercent) ? input.grossMarginPercent : null,
    snapshotId: `rrs_${Buffer.from(`${input.tenantId}:${input.customerId}:${input.observedAt}`).toString('base64url')}`,
    contactRate: rate(contacted, leads), bookingRateAmongContacted: rate(booked, contacted), showRateAmongBooked: rate(shows, booked), closeRateAmongShows: rate(won, shows), confidence,
    createdAt: new Date().toISOString(),
  }
}

export async function persistFunnelSnapshot(snapshot: FunnelSnapshot): Promise<{ created: boolean; snapshot: FunnelSnapshot }> {
  const key = snapshotKey(snapshot.tenantId, snapshot.customerId, snapshot.observedAt)
  const existing = await db.memory.findUnique({ where: { key } })
  if (existing) return { created: false, snapshot: JSON.parse(existing.value) as FunnelSnapshot }
  await db.memory.create({ data: { key, category: 'revenue_recovery_snapshot', value: JSON.stringify(snapshot) } })
  return { created: true, snapshot }
}

export async function getLatestFunnelSnapshot(tenantId: string, customerId: string): Promise<FunnelSnapshot | null> {
  const records = await db.memory.findMany({ where: { category: 'revenue_recovery_snapshot' }, orderBy: { createdAt: 'desc' }, take: 1000 })
  for (const record of records) {
    try {
      const snapshot = JSON.parse(record.value) as FunnelSnapshot
      if (snapshot.tenantId === tenantId && snapshot.customerId === customerId) return snapshot
    } catch { /* corrupted records are ignored by the read path and surfaced by integrity audits */ }
  }
  return null
}
