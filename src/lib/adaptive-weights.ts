/**
 * adaptive-weights.ts — UPGRADE #225
 *
 * Finding 4: Adaptive Weights for Organizational IQ.
 *
 * The 6 IQ components have fixed weights (Executive 20%, Leader 15%, etc.).
 * This module makes them ADAPTIVE — if Behavioral Quality becomes the
 * biggest weakness, it automatically carries more weight in the total score.
 *
 * The system learns which components matter most based on which ones
 * correlate with mission success.
 */

import { db } from './db'

export const runtime = 'nodejs'

export interface AdaptiveWeights {
  executiveQuality: number
  leaderEfficiency: number
  cognitiveQuality: number
  behavioralQuality: number
  operationalQuality: number
  learningQuality: number
  lastUpdated: string
  reasoning: string
}

const DEFAULT_WEIGHTS: AdaptiveWeights = {
  executiveQuality: 0.20,
  leaderEfficiency: 0.15,
  cognitiveQuality: 0.20,
  behavioralQuality: 0.15,
  operationalQuality: 0.20,
  learningQuality: 0.10,
  lastUpdated: '',
  reasoning: 'Default weights — no historical data yet',
}

const WEIGHTS_KEY = 'adaptive_iq_weights'
const MIN_WEIGHT = 0.05
const MAX_WEIGHT = 0.35

/**
 * Get the current adaptive weights.
 * If no weights are stored, returns defaults.
 */
export async function getAdaptiveWeights(): Promise<AdaptiveWeights> {
  try {
    const record = await db.memory.findFirst({
      where: { key: WEIGHTS_KEY },
      orderBy: { createdAt: 'desc' },
    })
    if (record) {
      return JSON.parse(record.value)
    }
  } catch {}
  return { ...DEFAULT_WEIGHTS, lastUpdated: new Date().toISOString() }
}

/**
 * Recalculate weights based on historical mission data.
 *
 * Logic:
 * 1. Get last 50 missions with telemetry
 * 2. For each component, compute its correlation with mission success
 * 3. Components that correlate more with success get higher weights
 * 4. Normalize so all weights sum to 1.0
 * 5. Clamp each weight to [MIN_WEIGHT, MAX_WEIGHT]
 * 6. Store in DB
 */
export async function recalculateWeights(): Promise<AdaptiveWeights> {
  try {
    const records = await db.memory.findMany({
      where: { category: 'mission_telemetry' },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }).catch(() => [])

    const missions = records.map(r => {
      try { return JSON.parse(r.value) }
      catch { return null }
    }).filter(Boolean)

    if (missions.length < 5) {
      // Not enough data to adapt — use defaults
      const weights = { ...DEFAULT_WEIGHTS, lastUpdated: new Date().toISOString(), reasoning: `Insufficient data (${missions.length} missions, need 5+). Using defaults.` }
      await storeWeights(weights)
      return weights
    }

    // Compute component scores for each mission
    // Then compute how well each component correlates with mission success
    const componentKeys = ['executiveQuality', 'leaderEfficiency', 'cognitiveQuality', 'behavioralQuality', 'operationalQuality', 'learningQuality']

    // For each component, compute average score for successful vs failed missions
    const successful = missions.filter((m: any) => m.status === 'completed')
    const failed = missions.filter((m: any) => m.status === 'failed')

    const componentCorrelations: Record<string, number> = {}

    for (const key of componentKeys) {
      // Compute component score for each mission
      const successScores = successful.map((m: any) => computeComponentScore(key, m))
      const failScores = failed.map((m: any) => computeComponentScore(key, m))

      const avgSuccess = successScores.length > 0 ? successScores.reduce((a: number, b: number) => a + b, 0) / successScores.length : 0
      const avgFail = failScores.length > 0 ? failScores.reduce((a: number, b: number) => a + b, 0) / failScores.length : 0

      // Correlation = how much this component differs between success and failure
      // Higher difference = this component matters more for success
      const correlation = avgSuccess - avgFail
      componentCorrelations[key] = Math.abs(correlation)
    }

    // If all correlations are 0 (all missions succeeded or all failed), use defaults
    const totalCorrelation = Object.values(componentCorrelations).reduce((a, b) => a + b, 0)
    if (totalCorrelation === 0) {
      const weights = { ...DEFAULT_WEIGHTS, lastUpdated: new Date().toISOString(), reasoning: `No correlation data (all ${missions.length} missions had same outcome). Using defaults.` }
      await storeWeights(weights)
      return weights
    }

    // Convert correlations to weights (normalized to sum to 1.0)
    const rawWeights: Record<string, number> = {}
    for (const key of componentKeys) {
      rawWeights[key] = componentCorrelations[key] / totalCorrelation
    }

    // Clamp to [MIN_WEIGHT, MAX_WEIGHT] and renormalize
    const clamped: Record<string, number> = {}
    let sum = 0
    for (const key of componentKeys) {
      clamped[key] = Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, rawWeights[key]))
      sum += clamped[key]
    }
    // Renormalize
    for (const key of componentKeys) {
      clamped[key] = clamped[key] / sum
    }

    // Round to 2 decimal places
    const weights: AdaptiveWeights = {
      executiveQuality: Math.round(clamped.executiveQuality * 100) / 100,
      leaderEfficiency: Math.round(clamped.leaderEfficiency * 100) / 100,
      cognitiveQuality: Math.round(clamped.cognitiveQuality * 100) / 100,
      behavioralQuality: Math.round(clamped.behavioralQuality * 100) / 100,
      operationalQuality: Math.round(clamped.operationalQuality * 100) / 100,
      learningQuality: Math.round(clamped.learningQuality * 100) / 100,
      lastUpdated: new Date().toISOString(),
      reasoning: `Adapted from ${missions.length} missions. Weights based on component correlation with mission success. Key driver: ${Object.entries(componentCorrelations).sort((a, b) => b[1] - a[1])[0][0]}.`,
    }

    await storeWeights(weights)
    console.log('[adaptive-weights] Recalculated:', weights)
    return weights
  } catch (e: any) {
    console.error('[adaptive-weights] Failed:', e?.message)
    return { ...DEFAULT_WEIGHTS, lastUpdated: new Date().toISOString(), reasoning: `Error: ${e?.message}. Using defaults.` }
  }
}

function computeComponentScore(component: string, mission: any): number {
  switch (component) {
    case 'executiveQuality':
      return mission.confidence >= 70 ? 100 : mission.confidence
    case 'leaderEfficiency':
      return mission.leadersUsed?.length > 0 ? 80 : 50
    case 'cognitiveQuality':
      return mission.confidence || 0
    case 'behavioralQuality':
      return mission.executiveCorrections === 0 ? 100 : Math.max(0, 100 - mission.executiveCorrections * 20)
    case 'operationalQuality':
      return mission.verificationPassed ? 100 : (mission.verificationScore || 0)
    case 'learningQuality':
      return (mission.memoryReads > 0 || mission.memoryWrites > 0) ? 80 : 20
    default:
      return 50
  }
}

async function storeWeights(weights: AdaptiveWeights): Promise<void> {
  try {
    await db.memory.create({
      data: {
        key: WEIGHTS_KEY,
        value: JSON.stringify(weights),
        category: 'adaptive_weights',
      },
    })
  } catch (e: any) {
    console.error('[adaptive-weights] Failed to store:', e?.message)
  }
}
