import { db } from './db'
import type { OperationalKpiSnapshot } from './operational-kpi-engine'

export interface SustainedBusinessOutcomeEvidence {
  ventureId: string
  windowsRequested: number
  windowsFound: number
  positiveWindows: number
  regressedWindows: number
  // true only when every found window (up to windowsRequested) was independently verified
  // (real, non-synthetic) revenue-positive -- a single good day is not "sustained."
  sustained: boolean
}

// Reads the KPI snapshots venture-operation-loop.ts already persists on every heartbeat
// (persistOperationalKpiSnapshot, category 'operational_kpi_snapshot') -- this never computes a
// new metric, it only asks whether the metric already being recorded stayed good across several
// independent windows in a row, which is the actual difference between "it worked once" and "this
// is a sustained business outcome."
export async function assessSustainedBusinessOutcome(ventureId: string, windows = 3): Promise<SustainedBusinessOutcomeEvidence> {
  const trimmed = ventureId.trim()
  if (!trimmed) throw new Error('ventureId is required to assess sustained business outcome.')
  if (!Number.isInteger(windows) || windows < 1) throw new Error('windows must be a positive integer.')
  const rows = await db.memory.findMany({ where: { category: 'operational_kpi_snapshot', key: { startsWith: `operational-kpi:${trimmed}:` } }, orderBy: { createdAt: 'desc' }, take: windows })
  const snapshots = rows
    .map((row) => { try { return JSON.parse(row.value) as OperationalKpiSnapshot } catch { return null } })
    .filter((snapshot): snapshot is OperationalKpiSnapshot => Boolean(snapshot))
  const positiveWindows = snapshots.filter((snapshot) => snapshot.outcomes.netRevenue > 0 && !snapshot.controlHealth.syntheticRevenueDetected).length
  const regressedWindows = snapshots.length - positiveWindows
  return {
    ventureId: trimmed,
    windowsRequested: windows,
    windowsFound: snapshots.length,
    positiveWindows,
    regressedWindows,
    sustained: snapshots.length >= windows && regressedWindows === 0,
  }
}
