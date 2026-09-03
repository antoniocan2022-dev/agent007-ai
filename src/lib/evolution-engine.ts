/**
 * evolution-engine.ts — canonical organizational observation layer.
 *
 * The governed improvement lifecycle lives in ceo-continuous-loop.ts and
 * closed-loop-improvement.ts. This module owns organizational observation,
 * health reporting, policy definitions, and historical reporting only.
 */

import { db } from './db'

export const runtime = 'nodejs'

export interface OrgIQ {
  totalScore: number
  components: {
    executiveQuality: number
    leaderEfficiency: number
    cognitiveQuality: number
    behavioralQuality: number
    operationalQuality: number
    learningQuality: number
  }
  trend: 'improving' | 'declining' | 'stable'
  trendDelta: number
}

type JsonRecord = Record<string, any>

function parseRecords(records: Array<{ value: string }>): JsonRecord[] {
  return records
    .map((record) => {
      try { return JSON.parse(record.value) as JsonRecord } catch { return null }
    })
    .filter((record): record is JsonRecord => record !== null)
}

function emptyOrgIQ(): OrgIQ {
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

export async function computeOrganizationalIQ(): Promise<OrgIQ> {
  try {
    const now = Date.now()
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000)
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000)

    const [telemetryRecords, auditRecords, learningRecords, previousRecords] = await Promise.all([
      db.memory.findMany({ where: { category: 'mission_telemetry', createdAt: { gte: dayAgo } } }).catch(() => []),
      db.memory.findMany({ where: { category: 'executive_audit', createdAt: { gte: dayAgo } } }).catch(() => []),
      db.memory.findMany({ where: { category: 'behavioral_learning_candidate', createdAt: { gte: dayAgo } } }).catch(() => []),
      db.memory.findMany({ where: { category: 'mission_telemetry', createdAt: { gte: weekAgo, lt: dayAgo } } }).catch(() => []),
    ])

    const missions = parseRecords(telemetryRecords)
    const audits = parseRecords(auditRecords)
    const learningCandidates = parseRecords(learningRecords)
    const previousMissions = parseRecords(previousRecords)

    if (missions.length === 0) return emptyOrgIQ()

    const successfulAudits = audits.filter((audit) => audit.overallVerdict === 'SUCCESS')
    const executiveQuality = audits.length > 0 ? (successfulAudits.length / audits.length) * 100 : 50

    const totalLeadersUsed = new Set(missions.flatMap((mission) => mission.leadersUsed ?? [])).size
    const totalToolsCalled = missions.reduce((sum, mission) => sum + Number(mission.toolCallCount ?? 0), 0)
    const leaderEfficiency = totalToolsCalled > 0
      ? Math.min(100, (totalLeadersUsed / Math.max(1, totalToolsCalled / 10)) * 100)
      : 50

    const avgConfidence = missions.reduce((sum, mission) => sum + Number(mission.confidence ?? 0), 0) / missions.length
    const cognitiveQuality = avgConfidence

    const corrections = missions.filter((mission) => Number(mission.executiveCorrections ?? 0) > 0).length
    const behavioralQuality = ((missions.length - corrections) / missions.length) * 100

    const verified = missions.filter((mission) => mission.verificationPassed === true).length
    const verificationRate = (verified / missions.length) * 100
    const avgDuration = missions.reduce((sum, mission) => sum + Number(mission.duration ?? 0), 0) / missions.length
    const durationScore = avgDuration > 0 ? Math.max(0, 100 - (avgDuration / 1000) * 2) : 50
    const operationalQuality = (verificationRate + durationScore) / 2

    // Learning quality is now evidence-based: only persisted learning candidates
    // that actually passed validation and were promoted count as learning.
    const validatedLearning = learningCandidates.filter((candidate) =>
      candidate.validation?.result === 'PASS' && candidate.status === 'PROMOTED'
    ).length
    const learningQuality = Math.min(100, validatedLearning * 20)

    const totalScore = Math.round(
      executiveQuality * 0.20 +
      leaderEfficiency * 0.15 +
      cognitiveQuality * 0.20 +
      behavioralQuality * 0.15 +
      operationalQuality * 0.20 +
      learningQuality * 0.10
    )

    const previousAvgConfidence = previousMissions.length > 0
      ? previousMissions.reduce((sum, mission) => sum + Number(mission.confidence ?? 0), 0) / previousMissions.length
      : avgConfidence
    const trendDelta = avgConfidence - previousAvgConfidence

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
      trend: trendDelta > 2 ? 'improving' : trendDelta < -2 ? 'declining' : 'stable',
      trendDelta: Math.round(trendDelta * 10) / 10,
    }
  } catch (error: any) {
    console.error('[evolution] Failed to compute Org IQ:', error?.message)
    return emptyOrgIQ()
  }
}

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

export async function generateHealthReport(): Promise<HealthReport> {
  const now = Date.now()
  const since = new Date(now - 24 * 60 * 60 * 1000)

  const [orgIQ, telemetryRecords, auditRecords, healingRecords] = await Promise.all([
    computeOrganizationalIQ(),
    db.memory.findMany({ where: { category: 'mission_telemetry', createdAt: { gte: since } } }).catch(() => []),
    db.memory.findMany({ where: { category: 'executive_audit', createdAt: { gte: since } } }).catch(() => []),
    db.memory.findMany({ where: { category: 'self_healing_log', createdAt: { gte: since } } }).catch(() => []),
  ])

  const missions = parseRecords(telemetryRecords)
  const audits = parseRecords(auditRecords)
  const healingEvents = parseRecords(healingRecords)

  const successful = missions.filter((mission) => mission.status === 'completed')
  const missionStats = {
    total24h: missions.length,
    successRate: missions.length ? (successful.length / missions.length) * 100 : 0,
    avgConfidence: missions.length ? missions.reduce((sum, mission) => sum + Number(mission.confidence ?? 0), 0) / missions.length : 0,
    avgDuration: missions.length ? missions.reduce((sum, mission) => sum + Number(mission.duration ?? 0), 0) / missions.length : 0,
    totalToolsCalled: missions.reduce((sum, mission) => sum + Number(mission.toolCallCount ?? 0), 0),
    totalTokensUsed: missions.reduce((sum, mission) => sum + Number(mission.tokensUsed ?? 0), 0),
    totalCost: missions.reduce((sum, mission) => sum + Number(mission.cost ?? 0), 0),
  }

  const leaderStats: Record<string, { missions: number; confidenceSum: number; failures: number }> = {}
  for (const mission of missions) {
    for (const leader of mission.leadersUsed ?? []) {
      if (!leaderStats[leader]) leaderStats[leader] = { missions: 0, confidenceSum: 0, failures: 0 }
      leaderStats[leader].missions += 1
      leaderStats[leader].confidenceSum += Number(mission.confidence ?? 0)
      if (mission.status === 'failed') leaderStats[leader].failures += 1
    }
  }

  const leaderPerformance = Object.entries(leaderStats)
    .map(([leader, stats]) => ({
      leader,
      missions: stats.missions,
      avgConfidence: stats.missions ? stats.confidenceSum / stats.missions : 0,
      failures: stats.failures,
      status: stats.failures > 1 ? 'declining' as const : stats.failures === 1 ? 'stable' as const : 'improving' as const,
    }))
    .sort((a, b) => b.missions - a.missions)

  const fallbackSuccesses = healingEvents.filter((event) => event.outcome === 'fallback_success').length
  const completeFailures = healingEvents.filter((event) => event.outcome === 'complete_failure').length
  const selfHealingStats = {
    totalEvents: healingEvents.length,
    fallbackRate: healingEvents.length ? (fallbackSuccesses / healingEvents.length) * 100 : 0,
    completeFailures,
  }

  const sevenQuestions = answerSevenQuestions(missions, audits, healingEvents)
  const recommendations = generateRecommendations(orgIQ, missionStats, leaderPerformance, selfHealingStats)
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

  try {
    await db.memory.create({
      data: {
        key: `evolution_report_${Date.now()}`,
        value: JSON.stringify(report),
        category: 'evolution_report',
      },
    })
  } catch (error: any) {
    console.error('[evolution] Failed to store report:', error?.message)
  }

  return report
}

function answerSevenQuestions(missions: JsonRecord[], audits: JsonRecord[], _healingEvents: JsonRecord[]): HealthReport['sevenQuestions'] {
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

  const avgConfidence = missions.reduce((sum, mission) => sum + Number(mission.confidence ?? 0), 0) / missions.length
  const avgVerification = missions.reduce((sum, mission) => sum + Number(mission.verificationScore ?? 0), 0) / missions.length
  const totalCorrections = missions.reduce((sum, mission) => sum + Number(mission.executiveCorrections ?? 0), 0)
  const totalRetries = missions.reduce((sum, mission) => sum + Number(mission.retries ?? 0), 0)
  const totalErrors = missions.reduce((sum, mission) => sum + (Array.isArray(mission.errors) ? mission.errors.length : 0), 0)
  const totalTools = missions.reduce((sum, mission) => sum + Number(mission.toolCallCount ?? 0), 0)
  const uniqueTools = new Set(missions.flatMap((mission) => mission.toolsCalled ?? [])).size
  const memoryReads = missions.reduce((sum, mission) => sum + Number(mission.memoryReads ?? 0), 0)
  const memoryWrites = missions.reduce((sum, mission) => sum + Number(mission.memoryWrites ?? 0), 0)
  const auditSuccessRate = audits.length ? (audits.filter((audit) => audit.overallVerdict === 'SUCCESS').length / audits.length) * 100 : null

  return {
    understoodObjective: avgConfidence >= 70 ? `Yes — average confidence was ${avgConfidence.toFixed(0)}%` : `Partially — average confidence was only ${avgConfidence.toFixed(0)}%`,
    rightLeaders: `${new Set(missions.flatMap((mission) => mission.leadersUsed ?? [])).size} unique leaders used across ${missions.length} missions — ${leaderPerformanceText(missions)}`,
    unnecessaryTools: totalTools > 0 && uniqueTools / totalTools < 0.3
      ? `Possible redundancy — ${totalTools} tool calls but only ${uniqueTools} unique tools`
      : `Good tool diversity — ${uniqueTools} unique tools across ${totalTools} calls`,
    rightMemories: memoryReads > 0 ? `${memoryReads} memory reads and ${memoryWrites} memory writes — memory was actively used` : 'No memory reads — missions may not be leveraging past context',
    reasoningCorrect: auditSuccessRate !== null
      ? `Audit success rate was ${auditSuccessRate.toFixed(0)}%; verification score averaged ${avgVerification.toFixed(0)}%`
      : avgVerification >= 70 ? `Yes — verification score averaged ${avgVerification.toFixed(0)}%` : `Verification was low (${avgVerification.toFixed(0)}%)`,
    responseNatural: totalCorrections === 0 ? 'Yes — no executive corrections needed' : `${totalCorrections} corrections needed`,
    betterNextTime: generateImprovementSuggestion(avgConfidence, avgVerification, totalRetries, totalErrors, totalCorrections),
  }
}

function leaderPerformanceText(missions: JsonRecord[]): string {
  const counts: Record<string, number> = {}
  for (const mission of missions) for (const leader of mission.leadersUsed ?? []) counts[leader] = (counts[leader] ?? 0) + 1
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return top ? `most used: ${top[0]} (${top[1]} missions)` : 'no leader data'
}

function generateImprovementSuggestion(confidence: number, verification: number, retries: number, errors: number, corrections: number): string {
  const suggestions: string[] = []
  if (confidence < 70) suggestions.push('improve initial context gathering to boost confidence')
  if (verification < 70) suggestions.push('strengthen verification by calling the canonical verification path more consistently')
  if (retries > 2) suggestions.push('reduce retries by improving initial tool selection')
  if (errors > 0) suggestions.push(`address ${errors} error(s) to prevent recurrence`)
  if (corrections > 0) suggestions.push(`reduce response corrections (${corrections})`)
  return suggestions.length ? `Focus on: ${suggestions.join(', ')}` : 'Organization is performing well — maintain current patterns'
}

function generateRecommendations(orgIQ: OrgIQ, missionStats: HealthReport['missionStats'], leaderPerformance: HealthReport['leaderPerformance'], selfHealingStats: HealthReport['selfHealingStats']): string[] {
  const recs: string[] = []
  if (orgIQ.components.cognitiveQuality < 70) recs.push('Cognitive quality is below 70% — improve reasoning context')
  if (orgIQ.components.behavioralQuality < 80) recs.push('Behavioral quality indicates response corrections — review reflection effectiveness')
  if (orgIQ.components.operationalQuality < 70) recs.push('Operational quality is low — inspect slow missions or verification failures')
  if (missionStats.avgDuration > 30000) recs.push(`Average mission duration is ${(missionStats.avgDuration / 1000).toFixed(1)}s — consider more parallel execution`)
  if (selfHealingStats.totalEvents > 3) recs.push(`${selfHealingStats.totalEvents} self-healing events — investigate recurring failure causes`)
  if (leaderPerformance.filter((leader) => leader.failures > 1).length > 0) recs.push('One or more leaders show repeated failures — inspect their execution paths')
  if (orgIQ.trend === 'declining') recs.push(`Organizational IQ is declining (delta: ${orgIQ.trendDelta}) — investigate root cause`)
  return recs.length ? recs : ['Organization is healthy — all tracked metrics are within acceptable ranges']
}

function generateWarnings(orgIQ: OrgIQ, missionStats: HealthReport['missionStats'], leaderPerformance: HealthReport['leaderPerformance'], selfHealingStats: HealthReport['selfHealingStats']): string[] {
  const warnings: string[] = []
  if (orgIQ.totalScore < 50) warnings.push(`Organizational IQ is critically low: ${orgIQ.totalScore}/100`)
  if (missionStats.successRate < 80 && missionStats.total24h > 0) warnings.push(`Mission success rate is below 80%: ${missionStats.successRate.toFixed(0)}%`)
  if (selfHealingStats.completeFailures > 0) warnings.push(`${selfHealingStats.completeFailures} complete failure(s) — some missions could not be recovered`)
  const declining = leaderPerformance.filter((leader) => leader.status === 'declining')
  if (declining.length) warnings.push(`${declining.length} leader(s) are declining: ${declining.map((leader) => leader.leader).join(', ')}`)
  if (orgIQ.trend === 'declining') warnings.push('Organizational performance is trending downward')
  return warnings
}

export async function getEvolutionHistory(limit = 7): Promise<HealthReport[]> {
  try {
    const records = await db.memory.findMany({ where: { category: 'evolution_report' }, orderBy: { createdAt: 'desc' }, take: limit })
    return records.map((record) => {
      try { return JSON.parse(record.value) as HealthReport } catch { return null }
    }).filter((report): report is HealthReport => report !== null)
  } catch {
    return []
  }
}

export type PolicyEnforcement = 'block' | 'warn' | 'enforce'

export interface OrgPolicy {
  id: string
  name: string
  rule: string
  description: string
  enforcement: PolicyEnforcement
  check: (context: PolicyContext) => boolean
}

export interface PolicyContext {
  missionGoal: string
  proposedLeaders: string[]
  hasDebate: boolean
  isFinancial: boolean
  riskScore: number
  hasMemoryRetry: boolean
  hasWebSearchFirst: boolean
}

export const ORG_POLICIES: OrgPolicy[] = [
  {
    id: 'policy_1',
    name: 'Financial Verification Required',
    rule: 'Always verify financial advice',
    description: 'Financial advice and monetary decisions require verification before the response.',
    enforcement: 'block',
    check: (ctx) => ctx.isFinancial && !ctx.proposedLeaders.includes('echo') && !ctx.proposedLeaders.includes('qa_monitor'),
  },
  {
    id: 'policy_2',
    name: 'Debate Required Above Risk Score 8',
    rule: 'Debate required above risk score 8',
    description: 'High-risk decisions require a leader debate before execution.',
    enforcement: 'block',
    check: (ctx) => ctx.riskScore >= 8 && !ctx.hasDebate,
  },
  {
    id: 'policy_3',
    name: 'Retry Memory Before Web Search',
    rule: 'Retry memory once before web search',
    description: 'Attempt canonical memory recall before external search when the workflow permits it.',
    enforcement: 'enforce',
    check: (ctx) => ctx.hasWebSearchFirst && !ctx.hasMemoryRetry,
  },
]

export function checkPolicies(ctx: PolicyContext): Array<{ policyId: string; policyName: string; rule: string; enforcement: PolicyEnforcement; reason: string }> {
  return ORG_POLICIES.filter((policy) => policy.check(ctx)).map((policy) => ({
    policyId: policy.id,
    policyName: policy.name,
    rule: policy.rule,
    enforcement: policy.enforcement,
    reason: `Policy "${policy.name}" violated: ${policy.description}`,
  }))
}

export function getOrgPolicies(): OrgPolicy[] { return ORG_POLICIES }

export interface ConversationalHealthSignal {
  windowHours: number
  incidentCount: number
  byInputClass: Record<string, number>
  byInvariant: Record<string, number>
  mostFrequentClass: string | null
}

export function aggregateConversationalHealthSignal(records: { value: string }[], windowHours: number): ConversationalHealthSignal {
  const byInputClass: Record<string, number> = {}
  const byInvariant: Record<string, number> = {}
  for (const record of records) {
    try {
      const candidate = JSON.parse(record.value) as { inputClass?: string; invariant?: string }
      if (candidate.inputClass) byInputClass[candidate.inputClass] = (byInputClass[candidate.inputClass] ?? 0) + 1
      if (candidate.invariant) byInvariant[candidate.invariant] = (byInvariant[candidate.invariant] ?? 0) + 1
    } catch {
      // Ignore isolated malformed incident records.
    }
  }
  const mostFrequentClass = Object.entries(byInputClass).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  return { windowHours, incidentCount: records.length, byInputClass, byInvariant, mostFrequentClass }
}

export async function getConversationalHealthSignal(windowHours = 24): Promise<ConversationalHealthSignal> {
  try {
    const records = await db.memory.findMany({ where: { category: 'ceo_conversation_incident', createdAt: { gte: new Date(Date.now() - windowHours * 60 * 60 * 1000) } } }).catch(() => [])
    return aggregateConversationalHealthSignal(records, windowHours)
  } catch {
    return { windowHours, incidentCount: 0, byInputClass: {}, byInvariant: {}, mostFrequentClass: null }
  }
}
