/**
 * predicted-iq.ts — UPGRADE #224
 *
 * Finding 1: Predicted IQ — forecast mission quality BEFORE execution.
 * Finding 6: Executive Simulation — model strategies before committing.
 *
 * Before a mission starts, the system can:
 * 1. Predict the likely quality (confidence, duration, risk)
 * 2. Simulate 3 different strategies (fast, high-confidence, low-cost)
 * 3. Let the CEO choose the best strategy based on the mission's priority
 *
 * This transforms IQ from retrospective (measuring past performance) to
 * predictive (forecasting future quality before committing resources).
 */

import { db } from './db'
import { callLlmWithRetry } from './agent'

export const runtime = 'nodejs'

export interface PredictedIQ {
  predictedConfidence: number  // 0-100
  predictedDuration: number  // ms
  predictedRisk: 'low' | 'medium' | 'high'
  predictedLeaderQuality: number  // 0-100
  predictedVerificationScore: number  // 0-100
  basedOnPastMissions: number  // how many historical missions were used
  reasoning: string
}

export interface MissionStrategy {
  name: string
  description: string
  leaders: string[]
  useDebate: boolean
  useFullVerification: boolean
  maxToolCalls: number
  predicted: PredictedIQ
  tradeoffs: string[]
}

/**
 * Predict mission quality based on historical data.
 * Uses past mission telemetry to forecast likely outcomes.
 */
export async function predictMissionQuality(
  goal: string,
  proposedLeaders: string[]
): Promise<PredictedIQ> {
  // Get historical missions with similar characteristics
  const historicalRecords = await db.memory.findMany({
    where: { category: 'mission_telemetry' },
    orderBy: { createdAt: 'desc' },
    take: 50,
  }).catch(() => [])

  const historicalMissions = historicalRecords.map(r => {
    try { return JSON.parse(r.value) }
    catch { return null }
  }).filter(Boolean)

  if (historicalMissions.length === 0) {
    // No historical data — use defaults
    return {
      predictedConfidence: 70,
      predictedDuration: 25000,
      predictedRisk: 'medium',
      predictedLeaderQuality: 75,
      predictedVerificationScore: 70,
      basedOnPastMissions: 0,
      reasoning: 'No historical data available. Using conservative default predictions. Quality will improve as more missions are completed.',
    }
  }

  // Find missions that used similar leaders
  const similarMissions = historicalMissions.filter((m: any) => {
    const usedLeaders = m.leadersUsed || []
    return proposedLeaders.some(l => usedLeaders.includes(l))
  })

  const referenceSet = similarMissions.length > 0 ? similarMissions : historicalMissions

  // Compute predictions from historical averages
  const avgConfidence = referenceSet.reduce((s: number, m: any) => s + (m.confidence || 0), 0) / referenceSet.length
  const avgDuration = referenceSet.reduce((s: number, m: any) => s + (m.duration || 25000), 0) / referenceSet.length
  const avgVerification = referenceSet.reduce((s: number, m: any) => s + (m.verificationScore || 0), 0) / referenceSet.length
  const errorRate = referenceSet.filter((m: any) => m.errors?.length > 0).length / referenceSet.length
  const retryRate = referenceSet.filter((m: any) => m.retries > 0).length / referenceSet.length

  // Predict risk based on error rate + retry rate
  const predictedRisk: 'low' | 'medium' | 'high' =
    errorRate > 0.3 || retryRate > 0.4 ? 'high' :
    errorRate > 0.15 || retryRate > 0.2 ? 'medium' : 'low'

  return {
    predictedConfidence: Math.round(avgConfidence),
    predictedDuration: Math.round(avgDuration),
    predictedRisk,
    predictedLeaderQuality: Math.round(avgConfidence * 0.7 + avgVerification * 0.3),
    predictedVerificationScore: Math.round(avgVerification),
    basedOnPastMissions: referenceSet.length,
    reasoning: `Based on ${referenceSet.length} historical missions${similarMissions.length > 0 ? ` using similar leaders (${proposedLeaders.join(', ')})` : ''}. Average confidence: ${avgConfidence.toFixed(0)}%, average duration: ${(avgDuration / 1000).toFixed(1)}s, error rate: ${(errorRate * 100).toFixed(0)}%.`,
  }
}

/**
 * Simulate 3 different mission strategies before execution.
 * The CEO can choose the best one based on the mission's priority.
 *
 * Strategy A: Fast — fewer leaders, less verification, minimal debate
 * Strategy B: High Confidence — debate + full verification + more leaders
 * Strategy C: Low Cost — minimal tool calls, no debate, basic verification
 */
export async function simulateStrategies(
  goal: string,
  proposedLeaders: string[]
): Promise<MissionStrategy[]> {
  // Get base prediction
  const basePrediction = await predictMissionQuality(goal, proposedLeaders)

  // Strategy A: Fast
  const fastLeaders = proposedLeaders.slice(0, 1) // only 1 leader
  const fastPrediction = await predictMissionQuality(goal, fastLeaders)
  const fastStrategy: MissionStrategy = {
    name: 'Strategy A: Fast',
    description: 'Single leader, basic verification, no debate. Optimized for speed.',
    leaders: fastLeaders,
    useDebate: false,
    useFullVerification: false,
    maxToolCalls: 3,
    predicted: {
      ...fastPrediction,
      predictedDuration: Math.round(fastPrediction.predictedDuration * 0.5), // faster
      predictedConfidence: Math.max(50, fastPrediction.predictedConfidence - 10), // slightly lower
      reasoning: `Fast strategy: 1 leader, no debate, basic verification. Predicted ${Math.round(fastPrediction.predictedDuration * 0.5 / 1000)}s duration. Lower confidence due to no debate.`,
    },
    tradeoffs: ['+ 50% faster', '- 10% lower confidence', '- No debate (single perspective)'],
  }

  // Strategy B: High Confidence
  const confidenceLeaders = [...proposedLeaders, 'echo'] // add QA
  const confidencePrediction = await predictMissionQuality(goal, confidenceLeaders)
  const confidenceStrategy: MissionStrategy = {
    name: 'Strategy B: High Confidence',
    description: 'Full debate + complete verification + extra QA leader. Optimized for quality.',
    leaders: confidenceLeaders,
    useDebate: true,
    useFullVerification: true,
    maxToolCalls: 8,
    predicted: {
      ...confidencePrediction,
      predictedDuration: Math.round(confidencePrediction.predictedDuration * 1.5), // slower
      predictedConfidence: Math.min(100, confidencePrediction.predictedConfidence + 15), // higher
      predictedVerificationScore: Math.min(100, confidencePrediction.predictedVerificationScore + 10),
      reasoning: `High-confidence strategy: ${confidenceLeaders.length} leaders, debate enabled, full verification. Predicted ${Math.round(confidencePrediction.predictedDuration * 1.5 / 1000)}s. Higher confidence due to debate + QA.`,
    },
    tradeoffs: ['+ 15% higher confidence', '+ 10% better verification', '- 50% slower', '- More tokens used'],
  }

  // Strategy C: Low Cost
  const costLeaders = proposedLeaders.slice(0, 2) // 2 leaders max
  const costPrediction = await predictMissionQuality(goal, costLeaders)
  const costStrategy: MissionStrategy = {
    name: 'Strategy C: Low Cost',
    description: 'Minimal tool calls, no debate, basic verification. Optimized for token efficiency.',
    leaders: costLeaders,
    useDebate: false,
    useFullVerification: false,
    maxToolCalls: 2,
    predicted: {
      ...costPrediction,
      predictedDuration: Math.round(costPrediction.predictedDuration * 0.7),
      predictedConfidence: Math.max(45, costPrediction.predictedConfidence - 5),
      reasoning: `Low-cost strategy: ${costLeaders.length} leaders, no debate, minimal tools. Predicted ${Math.round(costPrediction.predictedDuration * 0.7 / 1000)}s. Lower cost but reduced verification.`,
    },
    tradeoffs: ['+ 30% fewer tokens', '+ Faster than high-confidence', '- 5% lower confidence', '- No debate'],
  }

  return [fastStrategy, confidenceStrategy, costStrategy]
}

/**
 * Get the recommended strategy based on mission priority.
 */
export function recommendStrategy(
  strategies: MissionStrategy[],
  priority: 'speed' | 'quality' | 'cost'
): MissionStrategy {
  switch (priority) {
    case 'speed':
      return strategies[0] // Fast
    case 'quality':
      return strategies[1] // High Confidence
    case 'cost':
      return strategies[2] // Low Cost
    default:
      return strategies[1] // default to quality
  }
}
