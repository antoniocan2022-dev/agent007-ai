/**
 * closed-loop-improvement.ts — UPGRADE #223
 *
 * Finding 7: Closed-Loop Improvement Cycle
 *
 * Transforms recommendations from passive observations into tracked
 * improvement initiatives that are:
 *   1. Created (from Evolution Engine recommendations)
 *   2. Assigned (to a specific metric/behavior to improve)
 *   3. Implemented (via configuration changes)
 *   4. Measured (against the metric before/after)
 *   5. Verified (did it actually improve?)
 *   6. Kept or Rejected (permanent policy or reverted)
 *
 * Flow:
 *   Recommendation → Initiative → Applied → Measured → Verified → Kept/Rejected
 *
 * This prevents recommendations from accumulating without proof of value.
 */

import { db } from './db'
import type { MissionTelemetry } from './mission-telemetry'
import type { AuditReport } from './executive-audit-engine'

export const runtime = 'nodejs'

export type InitiativeStatus = 'proposed' | 'active' | 'measuring' | 'verified' | 'rejected'

export interface ImprovementInitiative {
  initiativeId: string
  recommendation: string
  source: string  // 'evolution_engine' | 'audit_report' | 'manual'
  status: InitiativeStatus
  createdAt: string
  appliedAt: string | null
  measuredAt: string | null
  verifiedAt: string | null

  // What metric does this target?
  targetMetric: string  // e.g., 'confidence', 'duration', 'corrections'
  targetDirection: 'increase' | 'decrease'

  // Baseline (measured before the initiative was applied)
  baselineValue: number | null

  // Post-implementation measurement
  postValue: number | null

  // Did it work?
  improvementDelta: number | null
  verdict: 'improved' | 'no_change' | 'worsened' | null

  // Missions used to measure
  baselineMissionIds: string[]
  postMissionIds: string[]
}

/**
 * Create an improvement initiative from a recommendation.
 */
export async function createInitiative(
  recommendation: string,
  source: string,
  targetMetric: string,
  targetDirection: 'increase' | 'decrease'
): Promise<ImprovementInitiative> {
  const initiative: ImprovementInitiative = {
    initiativeId: `initiative_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    recommendation,
    source,
    status: 'proposed',
    createdAt: new Date().toISOString(),
    appliedAt: null,
    measuredAt: null,
    verifiedAt: null,
    targetMetric,
    targetDirection,
    baselineValue: null,
    postValue: null,
    improvementDelta: null,
    verdict: null,
    baselineMissionIds: [],
    postMissionIds: [],
  }

  // Compute baseline from recent missions
  const recentMissions = await getRecentMissionMetrics(10)
  if (recentMissions.length > 0) {
    initiative.baselineValue = computeMetricAverage(recentMissions, targetMetric)
    initiative.baselineMissionIds = recentMissions.map(m => m.missionId)
  }

  // Store in DB
  try {
    await db.memory.create({
      data: {
        key: initiative.initiativeId,
        value: JSON.stringify(initiative),
        category: 'improvement_initiative',
      },
    })
    console.log(`[closed-loop] Initiative created: ${initiative.initiativeId} — target: ${targetMetric} ${targetDirection}`)
  } catch (e: any) {
    console.error('[closed-loop] Failed to store initiative:', e?.message)
  }

  return initiative
}

/**
 * Check recommendations from previous evolution reports against
 * the outcome of a new mission. This is called after every mission
 * completes (from mission-os.ts LEARN stage).
 *
 * If an active initiative exists, record this mission's metrics
 * as post-implementation data. Once enough post-missions are collected,
 * verify whether the initiative actually improved the target metric.
 */
export async function checkRecommendationsAgainstMission(
  telemetry: MissionTelemetry,
  auditReport: AuditReport
): Promise<void> {
  try {
    // Find active initiatives (status = 'active' or 'measuring')
    const initiatives = await db.memory.findMany({
      where: { category: 'improvement_initiative' },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }).catch(() => [])

    for (const record of initiatives) {
      let initiative: ImprovementInitiative
      try { initiative = JSON.parse(record.value) }
      catch { continue }

      if (initiative.status !== 'active' && initiative.status !== 'measuring') continue

      // Add this mission to the post-implementation set
      if (!initiative.postMissionIds.includes(telemetry.missionId)) {
        initiative.postMissionIds.push(telemetry.missionId)
      }

      // If we have enough post-missions (3+), verify the initiative
      if (initiative.postMissionIds.length >= 3) {
        const postMissions = await getMissionsByIds(initiative.postMissionIds)
        if (postMissions.length > 0) {
          initiative.postValue = computeMetricAverage(postMissions, initiative.targetMetric)

          if (initiative.baselineValue !== null && initiative.postValue !== null) {
            initiative.improvementDelta = initiative.postValue - initiative.baselineValue

            // Determine verdict based on target direction
            if (initiative.targetDirection === 'increase') {
              initiative.verdict = initiative.improvementDelta > 1 ? 'improved' : initiative.improvementDelta < -1 ? 'worsened' : 'no_change'
            } else {
              initiative.verdict = initiative.improvementDelta < -1 ? 'improved' : initiative.improvementDelta > 1 ? 'worsened' : 'no_change'
            }

            initiative.status = 'verified'
            initiative.verifiedAt = new Date().toISOString()
            initiative.measuredAt = initiative.verifiedAt

            console.log(`[closed-loop] Initiative ${initiative.initiativeId} VERIFIED: ${initiative.verdict} (delta: ${initiative.improvementDelta})`)

            // Store learning
            await storeLearningFromInitiative(initiative)
          } else {
            initiative.status = 'measuring'
            initiative.measuredAt = new Date().toISOString()
          }
        }
      } else {
        initiative.status = 'measuring'
      }

      // Update the initiative in DB
      await db.memory.update({
        where: { id: record.id },
        data: { value: JSON.stringify(initiative) },
      }).catch(() => {})
    }
  } catch (e: any) {
    console.error('[closed-loop] Check failed:', e?.message)
  }
}

/**
 * Get all improvement initiatives.
 */
export async function getInitiatives(limit: number = 20): Promise<ImprovementInitiative[]> {
  try {
    const records = await db.memory.findMany({
      where: { category: 'improvement_initiative' },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return records.map(r => {
      try { return JSON.parse(r.value) as ImprovementInitiative }
      catch { return null }
    }).filter(Boolean) as ImprovementInitiative[]
  } catch {
    return []
  }
}

// ═══ Helpers ═══

async function getRecentMissionMetrics(limit: number): Promise<MissionTelemetry[]> {
  try {
    const records = await db.memory.findMany({
      where: { category: 'mission_telemetry' },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    return records.map(r => {
      try { return JSON.parse(r.value) as MissionTelemetry }
      catch { return null }
    }).filter(Boolean) as MissionTelemetry[]
  } catch {
    return []
  }
}

async function getMissionsByIds(ids: string[]): Promise<MissionTelemetry[]> {
  try {
    const records = await db.memory.findMany({
      where: {
        category: 'mission_telemetry',
        key: { in: ids },
      },
    })
    return records.map(r => {
      try { return JSON.parse(r.value) as MissionTelemetry }
      catch { return null }
    }).filter(Boolean) as MissionTelemetry[]
  } catch {
    return []
  }
}

function computeMetricAverage(missions: MissionTelemetry[], metric: string): number {
  if (missions.length === 0) return 0
  const values = missions.map(m => {
    switch (metric) {
      case 'confidence': return m.confidence || 0
      case 'duration': return m.duration || 0
      case 'verificationScore': return m.verificationScore || 0
      case 'corrections': return m.executiveCorrections || 0
      case 'retries': return m.retries || 0
      case 'errors': return m.errors?.length || 0
      case 'tokens': return m.tokensUsed || 0
      case 'cost': return m.cost || 0
      case 'tools': return m.toolCallCount || 0
      default: return 0
    }
  })
  return values.reduce((a, b) => a + b, 0) / values.length
}

async function storeLearningFromInitiative(initiative: ImprovementInitiative): Promise<void> {
  try {
    const learning = `Initiative ${initiative.initiativeId} — "${initiative.recommendation}" — VERDICT: ${initiative.verdict}. Baseline: ${initiative.baselineValue}, Post: ${initiative.postValue}, Delta: ${initiative.improvementDelta}.`

    await db.memory.create({
      data: {
        key: `learning_${initiative.initiativeId}`,
        value: learning,
        category: 'organizational_learning',
      },
    })

    console.log(`[closed-loop] Learning stored: ${initiative.verdict} for "${initiative.recommendation.slice(0, 60)}"`)
  } catch (e: any) {
    console.error('[closed-loop] Failed to store learning:', e?.message)
  }
}
