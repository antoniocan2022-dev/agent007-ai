/**
 * mission-telemetry.ts — UPGRADE #218
 *
 * Mission Telemetry + Observability Engine.
 * Tracks REAL data for every mission and provides aggregate analytics.
 *
 * Telemetry (per-mission):
 *   Mission ID, Duration, Leaders used, Tools called, Retries,
 *   Memory reads, Memory writes, Confidence, Verification score,
 *   Errors, Cost, Tokens, Latency
 *
 * Observability (aggregate):
 *   Mission Success rate, Average Latency, Verification Failures,
 *   Leader Debate Usage, Memory Hits, Average Confidence,
 *   Executive Corrections
 */

import { db } from './db'

export const runtime = 'nodejs'

// ═══════════════════════════════════════════════════════════════
// TELEMETRY DATA MODEL
// ═══════════════════════════════════════════════════════════════

export interface MissionTelemetry {
  missionId: string
  goal: string
  startedAt: number
  completedAt: number | null
  duration: number | null  // ms
  status: 'running' | 'completed' | 'failed'
  leadersUsed: string[]
  toolsCalled: string[]
  toolCallCount: number
  retries: number
  memoryReads: number
  memoryWrites: number
  confidence: number  // 0-100
  verificationScore: number  // 0-100
  verificationPassed: boolean
  errors: string[]
  cost: number  // estimated USD
  tokensUsed: number
  latencyMs: number  // first-response latency
  debateTriggered: boolean
  executiveCorrections: number
}

/**
 * Start tracking a new mission. Returns the telemetry object.
 */
export function startMissionTelemetry(goal: string): MissionTelemetry {
  return {
    missionId: `mission_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    goal: goal.slice(0, 200),
    startedAt: Date.now(),
    completedAt: null,
    duration: null,
    status: 'running',
    leadersUsed: [],
    toolsCalled: [],
    toolCallCount: 0,
    retries: 0,
    memoryReads: 0,
    memoryWrites: 0,
    confidence: 0,
    verificationScore: 0,
    verificationPassed: false,
    errors: [],
    cost: 0,
    tokensUsed: 0,
    latencyMs: 0,
    debateTriggered: false,
    executiveCorrections: 0,
  }
}

/**
 * Record a tool call in the telemetry.
 */
export function recordToolCall(telemetry: MissionTelemetry, toolName: string, tokensUsed: number = 0, cost: number = 0) {
  if (!telemetry.toolsCalled.includes(toolName)) {
    telemetry.toolsCalled.push(toolName)
  }
  telemetry.toolCallCount++
  telemetry.tokensUsed += tokensUsed
  telemetry.cost += cost
}

/**
 * Record a leader dispatch in the telemetry.
 */
export function recordLeaderDispatch(telemetry: MissionTelemetry, leaderId: string) {
  if (!telemetry.leadersUsed.includes(leaderId)) {
    telemetry.leadersUsed.push(leaderId)
  }
}

/**
 * Record a memory operation in the telemetry.
 */
export function recordMemoryOp(telemetry: MissionTelemetry, type: 'read' | 'write') {
  if (type === 'read') telemetry.memoryReads++
  else telemetry.memoryWrites++
}

/**
 * Record a retry in the telemetry.
 */
export function recordRetry(telemetry: MissionTelemetry) {
  telemetry.retries++
}

/**
 * Record an error in the telemetry.
 */
export function recordError(telemetry: MissionTelemetry, error: string) {
  telemetry.errors.push(error.slice(0, 200))
}

/**
 * Record verification result in the telemetry.
 */
export function recordVerification(telemetry: MissionTelemetry, score: number, passed: boolean) {
  telemetry.verificationScore = score
  telemetry.verificationPassed = passed
}

/**
 * Record confidence in the telemetry.
 */
export function recordConfidence(telemetry: MissionTelemetry, confidence: number) {
  telemetry.confidence = confidence
}

/**
 * Record a debate in the telemetry.
 */
export function recordDebate(telemetry: MissionTelemetry) {
  telemetry.debateTriggered = true
}

/**
 * Record an executive correction (Reflection Engine rewrote the response).
 */
export function recordExecutiveCorrection(telemetry: MissionTelemetry) {
  telemetry.executiveCorrections++
}

/**
 * Complete the mission telemetry and store it in the DB.
 */
export async function completeMissionTelemetry(
  telemetry: MissionTelemetry,
  status: 'completed' | 'failed' = 'completed'
): Promise<MissionTelemetry> {
  telemetry.completedAt = Date.now()
  telemetry.duration = telemetry.completedAt - telemetry.startedAt
  telemetry.status = status

  // Store in DB (Memory table with category 'mission_telemetry')
  try {
    await db.memory.create({
      data: {
        key: telemetry.missionId,
        value: JSON.stringify(telemetry),
        category: 'mission_telemetry',
      },
    })
    console.log(`[telemetry] Mission ${telemetry.missionId} stored: ${telemetry.duration}ms, ${telemetry.toolCallCount} tools, confidence=${telemetry.confidence}%`)
  } catch (e: any) {
    console.error('[telemetry] Failed to store:', e?.message)
  }

  return telemetry
}

// ═══════════════════════════════════════════════════════════════
// OBSERVABILITY ENGINE (Aggregate Analytics)
// ═══════════════════════════════════════════════════════════════

export interface ObservabilityMetrics {
  totalMissions: number
  missionSuccessRate: number  // percentage
  averageLatencyMs: number
  averageDurationMs: number
  verificationFailureRate: number  // percentage
  leaderDebateUsage: number  // percentage
  memoryHitRate: number  // percentage (missions that used memory)
  averageConfidence: number
  executiveCorrectionRate: number  // percentage
  totalToolsCalled: number
  totalTokensUsed: number
  totalCost: number
  topLeaders: Array<{ leader: string; missions: number }>
  topTools: Array<{ tool: string; calls: number }>
  recentMissions: Array<MissionTelemetry>
}

/**
 * Get aggregate observability metrics from all stored mission telemetry.
 */
export async function getObservabilityMetrics(): Promise<ObservabilityMetrics> {
  try {
    const telemetryRecords = await db.memory.findMany({
      where: { category: 'mission_telemetry' },
      orderBy: { createdAt: 'desc' },
      take: 500,  // last 500 missions
    })

    if (telemetryRecords.length === 0) {
      return {
        totalMissions: 0,
        missionSuccessRate: 0,
        averageLatencyMs: 0,
        averageDurationMs: 0,
        verificationFailureRate: 0,
        leaderDebateUsage: 0,
        memoryHitRate: 0,
        averageConfidence: 0,
        executiveCorrectionRate: 0,
        totalToolsCalled: 0,
        totalTokensUsed: 0,
        totalCost: 0,
        topLeaders: [],
        topTools: [],
        recentMissions: [],
      }
    }

    const missions: MissionTelemetry[] = telemetryRecords.map(r => {
      try { return JSON.parse(r.value) } catch { return null }
    }).filter(Boolean)

    const total = missions.length
    const successful = missions.filter(m => m.status === 'completed')
    const withDebate = missions.filter(m => m.debateTriggered)
    const withMemory = missions.filter(m => m.memoryReads > 0 || m.memoryWrites > 0)
    const withCorrections = missions.filter(m => m.executiveCorrections > 0)
    const verificationFailed = missions.filter(m => !m.verificationPassed)

    // Aggregate leaders + tools
    const leaderCounts: Record<string, number> = {}
    const toolCounts: Record<string, number> = {}
    for (const m of missions) {
      for (const l of m.leadersUsed) {
        leaderCounts[l] = (leaderCounts[l] || 0) + 1
      }
      for (const t of m.toolsCalled) {
        toolCounts[t] = (toolCounts[t] || 0) + 1
      }
    }

    const topLeaders = Object.entries(leaderCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([leader, missions]) => ({ leader, missions }))

    const topTools = Object.entries(toolCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tool, calls]) => ({ tool, calls }))

    return {
      totalMissions: total,
      missionSuccessRate: total > 0 ? (successful.length / total) * 100 : 0,
      averageLatencyMs: missions.reduce((s, m) => s + (m.latencyMs || 0), 0) / total,
      averageDurationMs: missions.reduce((s, m) => s + (m.duration || 0), 0) / total,
      verificationFailureRate: total > 0 ? (verificationFailed.length / total) * 100 : 0,
      leaderDebateUsage: total > 0 ? (withDebate.length / total) * 100 : 0,
      memoryHitRate: total > 0 ? (withMemory.length / total) * 100 : 0,
      averageConfidence: missions.reduce((s, m) => s + (m.confidence || 0), 0) / total,
      executiveCorrectionRate: total > 0 ? (withCorrections.length / total) * 100 : 0,
      totalToolsCalled: missions.reduce((s, m) => s + m.toolCallCount, 0),
      totalTokensUsed: missions.reduce((s, m) => s + m.tokensUsed, 0),
      totalCost: missions.reduce((s, m) => s + m.cost, 0),
      topLeaders,
      topTools,
      recentMissions: missions.slice(0, 10),
    }
  } catch (e: any) {
    console.error('[observability] Failed:', e?.message)
    return {
      totalMissions: 0,
      missionSuccessRate: 0,
      averageLatencyMs: 0,
      averageDurationMs: 0,
      verificationFailureRate: 0,
      leaderDebateUsage: 0,
      memoryHitRate: 0,
      averageConfidence: 0,
      executiveCorrectionRate: 0,
      totalToolsCalled: 0,
      totalTokensUsed: 0,
      totalCost: 0,
      topLeaders: [],
      topTools: [],
      recentMissions: [],
    }
  }
}
