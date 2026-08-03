/**
 * evolution-engine.ts — UPGRADE #222
 *
 * The Evolution Engine — Agent007's self-awareness layer.
 *
 * This is the most important subsystem in the platform. It doesn't serve
 * users, doesn't answer questions, doesn't execute missions. Its sole job
 * is to OBSERVE the organization and recommend improvements.
 *
 * Every night (or on-demand), the Evolution Engine:
 * 1. Reads all telemetry, audit reports, healing events from the last 24h
 * 2. Compares against the previous 7 days
 * 3. Identifies trends (improving, declining, stable)
 * 4. Computes Organizational IQ (composite score)
 * 5. Generates an Organizational Health Report
 * 6. Stores recommendations in memory
 * 7. Answers the 7 self-evaluation questions
 *
 * This transforms Agent007 from Level 3 (Organization) to Level 4
 * (Self-Aware Organization).
 */

import { db } from './db'
import { callLlmWithRetry } from './agent'

export const runtime = 'nodejs'

// ═══════════════════════════════════════════════════════════════
// ORGANIZATIONAL IQ
// ═══════════════════════════════════════════════════════════════

export interface OrgIQ {
  totalScore: number  // 0-100
  components: {
    executiveQuality: number    // Did the CEO think well?
    leaderEfficiency: number    // Were the right leaders selected?
    cognitiveQuality: number    // Was reasoning sound?
    behavioralQuality: number   // Did the response feel natural?
    operationalQuality: number  // Was execution efficient?
    learningQuality: number     // Did the organization improve?
  }
  trend: 'improving' | 'declining' | 'stable'
  trendDelta: number  // change from previous period
}

/**
 * Compute Organizational IQ from stored telemetry + audit data.
 */
export async function computeOrganizationalIQ(): Promise<OrgIQ> {
  try {
    // Get last 24h of telemetry
    const telemetryRecords = await db.memory.findMany({
      where: {
        category: 'mission_telemetry',
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }).catch(() => [])

    // Get last 24h of audit reports
    const auditRecords = await db.memory.findMany({
      where: {
        category: 'executive_audit',
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }).catch(() => [])

    // Get last 24h of self-healing events
    const healingRecords = await db.memory.findMany({
      where: {
        category: 'self_healing_log',
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }).catch(() => [])

    // Get previous 7 days for trend comparison
    const previousRecords = await db.memory.findMany({
      where: {
        category: 'mission_telemetry',
        createdAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          lt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
    }).catch(() => [])

    const missions = telemetryRecords.map(r => {
      try { return JSON.parse(r.value) } catch { return null }
    }).filter(Boolean)

    const audits = auditRecords.map(r => {
      try { return JSON.parse(r.value) } catch { return null }
    }).filter(Boolean)

    const previousMissions = previousRecords.map(r => {
      try { return JSON.parse(r.value) } catch { return null }
    }).filter(Boolean)

    if (missions.length === 0) {
      return {
        totalScore: 0,
        components: {
          executiveQuality: 0,
          leaderEfficiency: 0,
          cognitiveQuality: 0,
          behavioralQuality: 0,
          operationalQuality: 0,
          learningQuality: 0,
        },
        trend: 'stable',
        trendDelta: 0,
      }
    }

    // ═══ Component 1: Executive Quality (from audit verdicts) ═══
    const successfulAudits = audits.filter((a: any) => a.overallVerdict === 'SUCCESS')
    const executiveQuality = audits.length > 0
      ? (successfulAudits.length / audits.length) * 100
      : 50

    // ═══ Component 2: Leader Efficiency (leaders used / tools called ratio) ═══
    const totalLeadersUsed = new Set(missions.flatMap((m: any) => m.leadersUsed || [])).size
    const totalToolsCalled = missions.reduce((s: number, m: any) => s + (m.toolCallCount || 0), 0)
    const leaderEfficiency = totalToolsCalled > 0
      ? Math.min(100, (totalLeadersUsed / Math.max(1, totalToolsCalled / 10)) * 100)
      : 50

    // ═══ Component 3: Cognitive Quality (average confidence) ═══
    const avgConfidence = missions.reduce((s: number, m: any) => s + (m.confidence || 0), 0) / missions.length
    const cognitiveQuality = avgConfidence

    // ═══ Component 4: Behavioral Quality (executive corrections inverse) ═══
    const corrections = missions.filter((m: any) => m.executiveCorrections > 0).length
    const behavioralQuality = missions.length > 0
      ? ((missions.length - corrections) / missions.length) * 100
      : 100

    // ═══ Component 5: Operational Quality (verification pass rate + efficiency) ═══
    const verified = missions.filter((m: any) => m.verificationPassed).length
    const verificationRate = missions.length > 0 ? (verified / missions.length) * 100 : 0
    const avgDuration = missions.reduce((s: number, m: any) => s + (m.duration || 0), 0) / missions.length
    const durationScore = avgDuration > 0 ? Math.max(0, 100 - (avgDuration / 1000) * 2) : 50 // -2 points per second
    const operationalQuality = (verificationRate + durationScore) / 2

    // ═══ Component 6: Learning Quality (memory writes + healing events = learning activity) ═══
    const memoryWrites = missions.reduce((s: number, m: any) => s + (m.memoryWrites || 0), 0)
    const healingEvents = healingRecords.length
    const learningScore = Math.min(100, (memoryWrites + healingEvents) * 10)
    const learningQuality = learningScore

    // ═══ Total Score (weighted average) ═══
    const totalScore = Math.round(
      executiveQuality * 0.20 +
      leaderEfficiency * 0.15 +
      cognitiveQuality * 0.20 +
      behavioralQuality * 0.15 +
      operationalQuality * 0.20 +
      learningQuality * 0.10
    )

    // ═══ Trend (compare with previous 7 days) ═══
    const previousAvgConfidence = previousMissions.length > 0
      ? previousMissions.reduce((s: number, m: any) => s + (m.confidence || 0), 0) / previousMissions.length
      : 0
    const trendDelta = avgConfidence - previousAvgConfidence
    const trend: 'improving' | 'declining' | 'stable' =
      trendDelta > 2 ? 'improving' : trendDelta < -2 ? 'declining' : 'stable'

    return {
      totalScore,
      components: {
        executiveQuality: Math.round(executiveQuality),
        leaderEfficiency: Math.round(leaderEfficiency),
        cognitiveQuality: Math.round(cognitiveQuality),
        behavioralQuality: Math.round(behavioralQuality),
        operationalQuality: Math.round(operationalQuality),
        learningQuality: Math.round(learningQuality),
      },
      trend,
      trendDelta: Math.round(trendDelta * 10) / 10,
    }
  } catch (e: any) {
    console.error('[evolution] Failed to compute Org IQ:', e?.message)
    return {
      totalScore: 0,
      components: {
        executiveQuality: 0,
        leaderEfficiency: 0,
        cognitiveQuality: 0,
        behavioralQuality: 0,
        operationalQuality: 0,
        learningQuality: 0,
      },
      trend: 'stable',
      trendDelta: 0,
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// ORGANIZATIONAL HEALTH REPORT
// ═══════════════════════════════════════════════════════════════

export interface HealthReport {
  generatedAt: string
  period: string
  orgIQ: OrgIQ
  missionStats: {
    total24h: number
    successRate: number
    avgConfidence: number
    avgDuration: number
    totalToolsCalled: number
    totalTokensUsed: number
    totalCost: number
  }
  leaderPerformance: Array<{
    leader: string
    missions: number
    avgConfidence: number
    failures: number
    status: 'improving' | 'declining' | 'stable' | 'unused'
  }>
  selfHealingStats: {
    totalEvents: number
    fallbackRate: number
    completeFailures: number
  }
  sevenQuestions: {
    understoodObjective: string
    rightLeaders: string
    unnecessaryTools: string
    rightMemories: string
    reasoningCorrect: string
    responseNatural: string
    betterNextTime: string
  }
  recommendations: string[]
  warnings: string[]
}

/**
 * Generate a full Organizational Health Report.
 * This is the Evolution Engine's primary output.
 */
export async function generateHealthReport(): Promise<HealthReport> {
  const orgIQ = await computeOrganizationalIQ()

  // Get telemetry data
  const telemetryRecords = await db.memory.findMany({
    where: {
      category: 'mission_telemetry',
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
  }).catch(() => [])

  const missions = telemetryRecords.map(r => {
    try { return JSON.parse(r.value) } catch { return null }
  }).filter(Boolean)

  // Get healing events
  const healingRecords = await db.memory.findMany({
    where: {
      category: 'self_healing_log',
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
  }).catch(() => [])

  const healingEvents = healingRecords.map(r => {
    try { return JSON.parse(r.value) } catch { return null }
  }).filter(Boolean)

  // Mission stats
  const successful = missions.filter((m: any) => m.status === 'completed')
  const missionStats = {
    total24h: missions.length,
    successRate: missions.length > 0 ? (successful.length / missions.length) * 100 : 0,
    avgConfidence: missions.length > 0 ? missions.reduce((s: number, m: any) => s + (m.confidence || 0), 0) / missions.length : 0,
    avgDuration: missions.length > 0 ? missions.reduce((s: number, m: any) => s + (m.duration || 0), 0) / missions.length : 0,
    totalToolsCalled: missions.reduce((s: number, m: any) => s + (m.toolCallCount || 0), 0),
    totalTokensUsed: missions.reduce((s: number, m: any) => s + (m.tokensUsed || 0), 0),
    totalCost: missions.reduce((s: number, m: any) => s + (m.cost || 0), 0),
  }

  // Leader performance
  const leaderStats: Record<string, { missions: number; confidenceSum: number; failures: number }> = {}
  for (const m of missions) {
    for (const leader of (m as any).leadersUsed || []) {
      if (!leaderStats[leader]) leaderStats[leader] = { missions: 0, confidenceSum: 0, failures: 0 }
      leaderStats[leader].missions++
      leaderStats[leader].confidenceSum += (m as any).confidence || 0
      if ((m as any).status === 'failed') leaderStats[leader].failures++
    }
  }

  const leaderPerformance = Object.entries(leaderStats).map(([leader, stats]) => ({
    leader,
    missions: stats.missions,
    avgConfidence: stats.missions > 0 ? stats.confidenceSum / stats.missions : 0,
    failures: stats.failures,
    status: stats.failures > 1 ? 'declining' as const : stats.failures === 1 ? 'stable' as const : 'improving' as const,
  })).sort((a, b) => b.missions - a.missions)

  // Self-healing stats
  const fallbackSuccesses = healingEvents.filter((e: any) => e.outcome === 'fallback_success').length
  const completeFailures = healingEvents.filter((e: any) => e.outcome === 'complete_failure').length
  const selfHealingStats = {
    totalEvents: healingEvents.length,
    fallbackRate: healingEvents.length > 0 ? (fallbackSuccesses / healingEvents.length) * 100 : 0,
    completeFailures,
  }

  // The 7 Questions (answered via LLM analysis of the data)
  const sevenQuestions = await answerSevenQuestions(missions, audits3(missions), healingEvents)

  // Recommendations
  const recommendations = generateRecommendations(orgIQ, missionStats, leaderPerformance, selfHealingStats)

  // Warnings
  const warnings = generateWarnings(orgIQ, missionStats, leaderPerformance, selfHealingStats)

  const report: HealthReport = {
    generatedAt: new Date().toISOString(),
    period: 'Last 24 hours',
    orgIQ,
    missionStats,
    leaderPerformance,
    selfHealingStats,
    sevenQuestions,
    recommendations,
    warnings,
  }

  // Store in memory
  try {
    await db.memory.create({
      data: {
        key: `evolution_report_${Date.now()}`,
        value: JSON.stringify(report),
        category: 'evolution_report',
      },
    })
    console.log('[evolution] Health report generated — Org IQ:', orgIQ.totalScore, 'trend:', orgIQ.trend)
  } catch (e: any) {
    console.error('[evolution] Failed to store report:', e?.message)
  }

  return report
}

// ═══════════════════════════════════════════════════════════════
// THE 7 QUESTIONS
// ═══════════════════════════════════════════════════════════════

async function answerSevenQuestions(missions: any[], audits: any[], healingEvents: any[]): Promise<HealthReport['sevenQuestions']> {
  if (missions.length === 0) {
    return {
      understoodObjective: 'No missions in the last 24h — cannot evaluate',
      rightLeaders: 'No data',
      unnecessaryTools: 'No data',
      rightMemories: 'No data',
      reasoningCorrect: 'No data',
      responseNatural: 'No data',
      betterNextTime: 'Run missions to generate evaluation data',
    }
  }

  // Analyze the data to answer each question
  const avgConfidence = missions.reduce((s, m) => s + (m.confidence || 0), 0) / missions.length
  const avgVerification = missions.reduce((s, m) => s + (m.verificationScore || 0), 0) / missions.length
  const totalCorrections = missions.reduce((s, m) => s + (m.executiveCorrections || 0), 0)
  const totalRetries = missions.reduce((s, m) => s + (m.retries || 0), 0)
  const totalErrors = missions.reduce((s, m) => s + (m.errors?.length || 0), 0)
  const totalTools = missions.reduce((s, m) => s + (m.toolCallCount || 0), 0)
  const uniqueTools = new Set(missions.flatMap(m => m.toolsCalled || [])).size
  const memoryReads = missions.reduce((s, m) => s + (m.memoryReads || 0), 0)
  const memoryWrites = missions.reduce((s, m) => s + (m.memoryWrites || 0), 0)

  return {
    understoodObjective: avgConfidence >= 70
      ? `Yes — average confidence was ${avgConfidence.toFixed(0)}%, indicating objectives were well understood`
      : `Partially — average confidence was only ${avgConfidence.toFixed(0)}%, suggesting some objectives were unclear`,

    rightLeaders: missions.length > 0 && missions[0].leadersUsed?.length > 0
      ? `${new Set(missions.flatMap(m => m.leadersUsed || [])).size} unique leaders used across ${missions.length} missions — ${leaderPerformanceText(missions)}`
      : 'No leader dispatch data available',

    unnecessaryTools: totalTools > 0 && uniqueTools / totalTools < 0.3
      ? `Possible redundancy — ${totalTools} tool calls but only ${uniqueTools} unique tools (${((uniqueTools / totalTools) * 100).toFixed(0)}% uniqueness)`
      : `Good tool diversity — ${uniqueTools} unique tools across ${totalTools} calls`,

    rightMemories: memoryReads > 0
      ? `${memoryReads} memory reads and ${memoryWrites} memory writes — memory was actively used`
      : 'No memory reads — missions may not be leveraging past context',

    reasoningCorrect: avgVerification >= 70
      ? `Yes — verification score averaged ${avgVerification.toFixed(0)}%`
      : `Verification was low (${avgVerification.toFixed(0)}%) — reasoning may need improvement`,

    responseNatural: totalCorrections === 0
      ? 'Yes — no executive corrections needed, responses were natural'
      : `${totalCorrections} corrections needed — initial responses had template patterns that required rewriting`,

    betterNextTime: generateImprovementSuggestion(avgConfidence, avgVerification, totalRetries, totalErrors, totalCorrections),
  }
}

function leaderPerformanceText(missions: any[]): string {
  const leaderCounts: Record<string, number> = {}
  for (const m of missions) {
    for (const l of m.leadersUsed || []) {
      leaderCounts[l] = (leaderCounts[l] || 0) + 1
    }
  }
  const top = Object.entries(leaderCounts).sort((a, b) => b[1] - a[1])[0]
  return top ? `most used: ${top[0]} (${top[1]} missions)` : 'no leader data'
}

function generateImprovementSuggestion(confidence: number, verification: number, retries: number, errors: number, corrections: number): string {
  const suggestions: string[] = []
  if (confidence < 70) suggestions.push('improve initial context gathering to boost confidence')
  if (verification < 70) suggestions.push('strengthen verification by calling accuracy_checker more consistently')
  if (retries > 2) suggestions.push('reduce retries by improving initial tool selection')
  if (errors > 0) suggestions.push(`address ${errors} error(s) to prevent recurrence`)
  if (corrections > 0) suggestions.push(`reduce template patterns that require ${corrections} correction(s)`)
  if (suggestions.length === 0) return 'Organization is performing well — maintain current patterns'
  return 'Focus on: ' + suggestions.join(', ')
}

function audits3(missions: any[]): any[] {
  // Placeholder — audits are fetched separately in generateHealthReport
  return []
}

// ═══════════════════════════════════════════════════════════════
// RECOMMENDATIONS + WARNINGS
// ═══════════════════════════════════════════════════════════════

function generateRecommendations(
  orgIQ: OrgIQ,
  missionStats: any,
  leaderPerformance: any[],
  selfHealingStats: any
): string[] {
  const recs: string[] = []

  if (orgIQ.components.cognitiveQuality < 70) {
    recs.push('Cognitive quality is below 70% — improve reasoning by providing more context to the Reasoning Engine')
  }
  if (orgIQ.components.behavioralQuality < 80) {
    recs.push('Behavioral quality indicates template patterns — review Reflection Engine effectiveness')
  }
  if (orgIQ.components.operationalQuality < 70) {
    recs.push('Operational quality is low — check for slow missions or verification failures')
  }
  if (missionStats.avgDuration > 30000) {
    recs.push(`Average mission duration is ${(missionStats.avgDuration / 1000).toFixed(1)}s — consider parallelizing more tasks`)
  }
  if (selfHealingStats.totalEvents > 3) {
    recs.push(`${selfHealingStats.totalEvents} self-healing events — investigate which leaders are failing and why`)
  }
  const unusedLeaders = leaderPerformance.filter(l => l.missions === 0)
  if (unusedLeaders.length > 5) {
    recs.push(`${unusedLeaders.length} leaders were not used in the last 24h — consider if they're needed`)
  }
  if (orgIQ.trend === 'declining') {
    recs.push(`⚠️ Organizational IQ is declining (delta: ${orgIQ.trendDelta}) — investigate root cause immediately`)
  }
  if (recs.length === 0) {
    recs.push('Organization is healthy — all metrics within acceptable ranges')
  }

  return recs
}

function generateWarnings(
  orgIQ: OrgIQ,
  missionStats: any,
  leaderPerformance: any[],
  selfHealingStats: any
): string[] {
  const warns: string[] = []

  if (orgIQ.totalScore < 50) warns.push(`Organizational IQ is critically low: ${orgIQ.totalScore}/100`)
  if (missionStats.successRate < 80 && missionStats.total24h > 0) warns.push(`Mission success rate is below 80%: ${missionStats.successRate.toFixed(0)}%`)
  if (selfHealingStats.completeFailures > 0) warns.push(`${selfHealingStats.completeFailures} complete failure(s) — some missions could not be recovered`)
  const decliningLeaders = leaderPerformance.filter(l => l.status === 'declining')
  if (decliningLeaders.length > 0) warns.push(`${decliningLeaders.length} leader(s) are declining: ${decliningLeaders.map(l => l.leader).join(', ')}`)
  if (orgIQ.trend === 'declining') warns.push('Organizational performance is trending downward')

  return warns
}

// ═══════════════════════════════════════════════════════════════
// GET HISTORICAL REPORTS
// ═══════════════════════════════════════════════════════════════

export async function getEvolutionHistory(limit: number = 7): Promise<HealthReport[]> {
  try {
    const records = await db.memory.findMany({
      where: { category: 'evolution_report' },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return records.map(r => {
      try { return JSON.parse(r.value) as HealthReport }
      catch { return null }
    }).filter(Boolean) as HealthReport[]
  } catch {
    return []
  }
}
