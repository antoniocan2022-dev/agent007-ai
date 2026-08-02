/**
 * executive-audit-engine.ts — UPGRADE #219
 *
 * The Executive Audit Engine — every completed mission automatically
 * produces an internal audit report with REAL data.
 *
 * This transforms Agent007 from a system that simply executes into one
 * that AUDITS ITS OWN EXECUTION. Over time, these audit records become
 * invaluable for debugging, performance tuning, and continuous improvement.
 *
 * Every audit report contains:
 *   - Mission ID + Goal
 *   - Pipeline completed? (all 8 stages?)
 *   - Leaders used
 *   - Debate triggered?
 *   - Memory updated?
 *   - Verification passed? (score)
 *   - Confidence
 *   - Warnings
 *   - Lessons learned
 *   - Duration, tokens, cost
 *   - Timestamps
 */

import { db } from './db'
import type { MissionTelemetry } from './mission-telemetry'

export const runtime = 'nodejs'

export interface AuditReport {
  auditId: string
  missionId: string
  goal: string
  timestamp: string

  // Pipeline status
  pipelineCompleted: boolean
  stagesCompleted: string[]
  stagesFailed: string[]

  // Execution details
  leadersUsed: string[]
  debateTriggered: boolean
  memoryUpdated: boolean

  // Quality
  verificationPassed: boolean
  verificationScore: number
  confidence: number

  // Issues
  warnings: string[]
  errors: string[]
  retries: number

  // Resources
  durationMs: number
  tokensUsed: number
  cost: number
  toolsCalled: string[]

  // Learning
  lessonsLearned: string
  executiveCorrections: number

  // Verdict
  overallVerdict: 'SUCCESS' | 'PARTIAL' | 'FAILURE'
  qualityScore: number  // 0-100, computed from verification + confidence + errors
}

/**
 * Generate an audit report from a completed mission's telemetry.
 * Stores the report in the DB and returns it.
 */
export async function generateAuditReport(
  telemetry: MissionTelemetry,
  stagesCompleted: string[] = [],
  stagesFailed: string[] = []
): Promise<AuditReport> {
  const auditId = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  // Determine pipeline completion
  const expectedStages = ['UNDERSTAND', 'PLAN', 'CONTEXT', 'DISPATCH', 'EXECUTE', 'VERIFY', 'DECIDE', 'LEARN']
  const pipelineCompleted = stagesCompleted.length >= 6 && stagesFailed.length === 0

  // Determine memory updated
  const memoryUpdated = telemetry.memoryWrites > 0

  // Generate warnings
  const warnings: string[] = []
  if (telemetry.retries > 0) warnings.push(`${telemetry.retries} retry/retries required`)
  if (telemetry.debateTriggered) warnings.push('Leader debate was triggered')
  if (telemetry.executiveCorrections > 0) warnings.push(`${telemetry.executiveCorrections} executive correction(s) applied`)
  if (telemetry.errors.length > 0) warnings.push(`${telemetry.errors.length} error(s) encountered`)
  if (telemetry.confidence < 70) warnings.push(`Low confidence: ${telemetry.confidence}%`)
  if (!telemetry.verificationPassed) warnings.push(`Verification failed (score: ${telemetry.verificationScore}%)`)
  if (telemetry.duration && telemetry.duration > 60000) warnings.push(`Long duration: ${(telemetry.duration / 1000).toFixed(1)}s`)

  // Generate lessons learned
  let lessons = 'No specific lessons extracted.'
  if (telemetry.errors.length > 0) {
    lessons = `Errors encountered: ${telemetry.errors.slice(0, 2).join('; ')}. Avoid similar patterns in future missions.`
  } else if (telemetry.confidence >= 85 && telemetry.verificationPassed) {
    lessons = 'Mission completed successfully with high confidence. Approach validated for similar future missions.'
  } else if (telemetry.retries > 2) {
    lessons = `Required ${telemetry.retries} retries. Consider improving initial tool selection or context gathering.`
  } else if (telemetry.executiveCorrections > 0) {
    lessons = `Response was rewritten ${telemetry.executiveCorrections} time(s) by Reflection Engine. Initial response had template patterns.`
  }

  // Compute overall verdict
  let overallVerdict: 'SUCCESS' | 'PARTIAL' | 'FAILURE' = 'SUCCESS'
  if (!telemetry.verificationPassed || telemetry.confidence < 50) overallVerdict = 'FAILURE'
  else if (telemetry.errors.length > 0 || telemetry.retries > 1 || telemetry.confidence < 70) overallVerdict = 'PARTIAL'

  // Compute quality score (0-100)
  let qualityScore = 0
  qualityScore += telemetry.verificationPassed ? 30 : 0
  qualityScore += Math.min(30, telemetry.confidence * 0.3)
  qualityScore += telemetry.errors.length === 0 ? 20 : Math.max(0, 20 - telemetry.errors.length * 5)
  qualityScore += telemetry.retries === 0 ? 10 : Math.max(0, 10 - telemetry.retries * 3)
  qualityScore += pipelineCompleted ? 10 : 0
  qualityScore = Math.min(100, Math.round(qualityScore))

  const report: AuditReport = {
    auditId,
    missionId: telemetry.missionId,
    goal: telemetry.goal,
    timestamp: new Date().toISOString(),

    pipelineCompleted,
    stagesCompleted,
    stagesFailed,

    leadersUsed: telemetry.leadersUsed,
    debateTriggered: telemetry.debateTriggered,
    memoryUpdated,

    verificationPassed: telemetry.verificationPassed,
    verificationScore: telemetry.verificationScore,
    confidence: telemetry.confidence,

    warnings,
    errors: telemetry.errors,
    retries: telemetry.retries,

    durationMs: telemetry.duration || 0,
    tokensUsed: telemetry.tokensUsed,
    cost: telemetry.cost,
    toolsCalled: telemetry.toolsCalled,

    lessonsLearned: lessons,
    executiveCorrections: telemetry.executiveCorrections,

    overallVerdict,
    qualityScore,
  }

  // Store in DB
  try {
    await db.memory.create({
      data: {
        key: auditId,
        value: JSON.stringify(report),
        category: 'executive_audit',
      },
    })
    console.log(`[audit-engine] Audit report generated: ${auditId} — verdict: ${overallVerdict}, quality: ${qualityScore}%`)
  } catch (e: any) {
    console.error('[audit-engine] Failed to store audit report:', e?.message)
  }

  return report
}

/**
 * Get recent audit reports.
 */
export async function getRecentAuditReports(limit: number = 20): Promise<AuditReport[]> {
  try {
    const records = await db.memory.findMany({
      where: { category: 'executive_audit' },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return records.map(r => {
      try { return JSON.parse(r.value) as AuditReport }
      catch { return null }
    }).filter(Boolean) as AuditReport[]
  } catch {
    return []
  }
}

/**
 * Get aggregate audit metrics.
 */
export async function getAuditMetrics(): Promise<{
  totalAudits: number
  successRate: number
  partialRate: number
  failureRate: number
  averageQualityScore: number
  averageConfidence: number
  averageVerificationScore: number
  totalWarnings: number
  totalErrors: number
  totalRetries: number
  commonWarnings: Array<{ warning: string; count: number }>
}> {
  try {
    const records = await db.memory.findMany({
      where: { category: 'executive_audit' },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })

    if (records.length === 0) {
      return {
        totalAudits: 0,
        successRate: 0,
        partialRate: 0,
        failureRate: 0,
        averageQualityScore: 0,
        averageConfidence: 0,
        averageVerificationScore: 0,
        totalWarnings: 0,
        totalErrors: 0,
        totalRetries: 0,
        commonWarnings: [],
      }
    }

    const reports: AuditReport[] = records.map(r => {
      try { return JSON.parse(r.value) as AuditReport }
      catch { return null }
    }).filter(Boolean) as AuditReport[]

    const total = reports.length
    const successes = reports.filter(r => r.overallVerdict === 'SUCCESS')
    const partials = reports.filter(r => r.overallVerdict === 'PARTIAL')
    const failures = reports.filter(r => r.overallVerdict === 'FAILURE')

    // Count warning patterns
    const warningCounts: Record<string, number> = {}
    for (const r of reports) {
      for (const w of r.warnings) {
        // Normalize warning text (remove numbers)
        const normalized = w.replace(/\d+/g, 'N').trim()
        warningCounts[normalized] = (warningCounts[normalized] || 0) + 1
      }
    }

    const commonWarnings = Object.entries(warningCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([warning, count]) => ({ warning, count }))

    return {
      totalAudits: total,
      successRate: total > 0 ? (successes.length / total) * 100 : 0,
      partialRate: total > 0 ? (partials.length / total) * 100 : 0,
      failureRate: total > 0 ? (failures.length / total) * 100 : 0,
      averageQualityScore: reports.reduce((s, r) => s + r.qualityScore, 0) / total,
      averageConfidence: reports.reduce((s, r) => s + r.confidence, 0) / total,
      averageVerificationScore: reports.reduce((s, r) => s + r.verificationScore, 0) / total,
      totalWarnings: reports.reduce((s, r) => s + r.warnings.length, 0),
      totalErrors: reports.reduce((s, r) => s + r.errors.length, 0),
      totalRetries: reports.reduce((s, r) => s + r.retries, 0),
      commonWarnings,
    }
  } catch {
    return {
      totalAudits: 0,
      successRate: 0,
      partialRate: 0,
      failureRate: 0,
      averageQualityScore: 0,
      averageConfidence: 0,
      averageVerificationScore: 0,
      totalWarnings: 0,
      totalErrors: 0,
      totalRetries: 0,
      commonWarnings: [],
    }
  }
}
