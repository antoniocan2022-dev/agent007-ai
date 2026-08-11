import { db } from '../db'
import type { AuditReport } from '../executive-audit-engine'
import type { MissionTelemetry } from '../mission-telemetry'
import { calculateAutonomyScorecard, type AutonomyScorecard } from './autonomy-scorecard'
import { buildOperationalMissionEvidenceFromTelemetry } from './operational-evidence-bridge'

export interface OperationalAutonomySnapshot {
  telemetrySampleSize: number
  scoreableMissionCount: number
  evidenceCoverage: number
  scorecard: AutonomyScorecard
}

/**
 * Build the operational scorecard from already-loaded telemetry and audit rows.
 * Missions without complete explicit evidence are excluded from the scorecard
 * but remain visible through telemetrySampleSize/evidenceCoverage.
 */
export function buildOperationalAutonomySnapshot(
  telemetry: readonly MissionTelemetry[],
  audits: readonly AuditReport[],
): OperationalAutonomySnapshot {
  const auditsByMission = new Map(audits.map((audit) => [audit.missionId, audit]))
  const evidence = telemetry
    .map((mission) => {
      const audit = auditsByMission.get(mission.missionId)
      return audit ? buildOperationalMissionEvidenceFromTelemetry(mission, audit) : null
    })
    .filter((value): value is NonNullable<typeof value> => value !== null)

  return {
    telemetrySampleSize: telemetry.length,
    scoreableMissionCount: evidence.length,
    evidenceCoverage: telemetry.length > 0 ? Number((evidence.length / telemetry.length * 100).toFixed(2)) : 0,
    scorecard: calculateAutonomyScorecard(evidence),
  }
}

/**
 * Read the persisted mission telemetry + executive audits and calculate the
 * current operational autonomy score. This is measurement only; it never
 * grants execution authority and never changes mission state.
 */
export async function getOperationalAutonomySnapshot(): Promise<OperationalAutonomySnapshot> {
  try {
    const [telemetryRows, auditRows] = await Promise.all([
      db.memory.findMany({
        where: { category: 'mission_telemetry' },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      db.memory.findMany({
        where: { category: 'executive_audit' },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
    ])

    const telemetry = telemetryRows.flatMap((row) => {
      try {
        const value = JSON.parse(row.value) as MissionTelemetry
        return value && typeof value.missionId === 'string' ? [value] : []
      } catch {
        return []
      }
    })

    const audits = auditRows.flatMap((row) => {
      try {
        const value = JSON.parse(row.value) as AuditReport
        return value && typeof value.missionId === 'string' ? [value] : []
      } catch {
        return []
      }
    })

    return buildOperationalAutonomySnapshot(telemetry, audits)
  } catch (error) {
    console.error('[operational-autonomy] Failed to build snapshot:', error)
    return buildOperationalAutonomySnapshot([], [])
  }
}
