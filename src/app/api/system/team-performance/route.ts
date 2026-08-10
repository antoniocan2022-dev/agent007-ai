import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAllPersistentMemory } from '@/lib/persistent-memory'
import { getAutonomyTelemetrySummary } from '@/lib/mission-telemetry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * GET /api/system/team-performance
 *
 * Team performance dashboard plus the canonical evidence-driven autonomy
 * summary. The autonomy result is diagnostic only; authority remains governed
 * by the Autonomy Governor.
 */

const SUCCESS_THRESHOLD = 92

export async function GET() {
  const startTime = Date.now()

  try {
    let toolMessages: any[] = []
    try {
      toolMessages = await db.message.findMany({
        where: { role: 'tool', toolName: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 500,
      })
    } catch {}

    let learnings: any[] = []
    try {
      learnings = await getAllPersistentMemory()
    } catch {}

    const selfLearnings = learnings.filter(m => m.category === 'self_learning')

    let subagents: any[] = []
    try {
      const { SUBAGENTS } = await import('@/lib/subagents')
      subagents = SUBAGENTS.filter(s => s.enabled !== false)
    } catch {}

    const agentPerformance = subagents.map(agent => {
      const agentLearnings = selfLearnings.filter(m => m.key.includes(`learning_${agent.id}_`))
      const scores = agentLearnings.map(m => m.score).filter(s => typeof s === 'number')
      const successCount = scores.filter(s => s >= SUCCESS_THRESHOLD).length
      const failCount = scores.filter(s => s < 70).length
      const avgScore = scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 0
      const successRate = scores.length > 0
        ? Math.round((successCount / scores.length) * 100)
        : 0

      const recentOutcomes = agentLearnings
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 5)
        .map(m => ({
          score: m.score,
          success: m.score >= SUCCESS_THRESHOLD,
          task: m.value.split('\n')[0].replace('Task: ', '').slice(0, 80),
          age: Math.round((Date.now() - m.createdAt) / (1000 * 60 * 60)) + 'h ago',
        }))

      let rating = '🔴 NEEDS IMPROVEMENT'
      if (avgScore >= 92 && successRate >= 80) rating = '🟢 EXCELLENT'
      else if (avgScore >= 85 && successRate >= 60) rating = '🟡 GOOD'
      else if (avgScore >= 70) rating = '🟠 FAIR'

      return {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        specialty: agent.specialty,
        metrics: {
          total_tasks: scores.length,
          avg_quality_score: avgScore,
          success_rate_percent: successRate,
          success_threshold: SUCCESS_THRESHOLD,
          successful_tasks: successCount,
          failed_tasks: failCount,
          rating,
        },
        recent_outcomes: recentOutcomes,
        allowed_tools_count: agent.allowedTools?.length ?? 0,
      }
    })

    const totalTasks = agentPerformance.reduce((sum, a) => sum + a.metrics.total_tasks, 0)
    const teamAvgScore = agentPerformance.length > 0
      ? Math.round(agentPerformance.reduce((sum, a) => sum + a.metrics.avg_quality_score, 0) / agentPerformance.length)
      : 0
    const teamSuccessRate = agentPerformance.length > 0
      ? Math.round(agentPerformance.reduce((sum, a) => sum + a.metrics.success_rate_percent, 0) / agentPerformance.length)
      : 0

    let teamRating = '🔴 NEEDS IMPROVEMENT'
    if (teamAvgScore >= 92 && teamSuccessRate >= 80) teamRating = '🟢 EXCELLENT (10/10)'
    else if (teamAvgScore >= 85 && teamSuccessRate >= 60) teamRating = '🟡 GOOD (7-8/10)'
    else if (teamAvgScore >= 70) teamRating = '🟠 FAIR (5-6/10)'

    const autonomy = await getAutonomyTelemetrySummary()

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      elapsed_ms: Date.now() - startTime,
      success_threshold: SUCCESS_THRESHOLD,
      threshold_note: 'Score ≥ 92 = SUCCESS. Below 70 = auto-retry triggered. 70-91 = needs improvement.',
      team_summary: {
        total_agents: agentPerformance.length,
        total_tasks_completed: totalTasks,
        team_avg_quality_score: teamAvgScore,
        team_success_rate_percent: teamSuccessRate,
        team_rating: teamRating,
        target_score: 92,
        gap_to_target: Math.max(0, 92 - teamAvgScore),
      },
      autonomy: {
        score: autonomy.index.score,
        passed: autonomy.index.passed,
        confidence: autonomy.index.confidence,
        failing_gates: autonomy.index.failingGates,
        evidence_coverage: autonomy.evidenceCoverage,
        eligible_missions: autonomy.eligibleMissions,
      },
      agents: agentPerformance,
      recommendations: generateRecommendations(agentPerformance, teamAvgScore, totalTasks, autonomy.index.passed),
    })
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: e?.message ?? 'Failed to generate team performance report',
      elapsed_ms: Date.now() - startTime,
    }, { status: 500 })
  }
}

function generateRecommendations(agents: any[], teamAvg: number, totalTasks: number, autonomyPassed: boolean): string[] {
  const recs: string[] = []

  if (totalTasks === 0) {
    recs.push('📊 No task data yet. Run 3 real missions to start accumulating performance data.')
  }

  if (teamAvg < 92) {
    recs.push(`🎯 Team average is ${teamAvg}/100. Target is 92. Gap: ${92 - teamAvg} points. Focus on the lowest-scoring agents first.`)
  }

  const weakAgents = agents.filter(a => a.metrics.avg_quality_score > 0 && a.metrics.avg_quality_score < 92)
  if (weakAgents.length > 0) {
    recs.push(`⚠️ ${weakAgents.length} agent(s) below 92 threshold: ${weakAgents.map(a => `${a.name} (${a.metrics.avg_quality_score})`).join(', ')}`)
  }

  const noDataAgents = agents.filter(a => a.metrics.total_tasks === 0)
  if (noDataAgents.length > 0) {
    recs.push(`📭 ${noDataAgents.length} agent(s) have no task data: ${noDataAgents.map(a => a.name).join(', ')}.`)
  }

  const strongAgents = agents.filter(a => a.metrics.avg_quality_score >= 92)
  if (strongAgents.length > 0) {
    recs.push(`✅ ${strongAgents.length} agent(s) meeting 92+ threshold: ${strongAgents.map(a => `${a.name} (${a.metrics.avg_quality_score})`).join(', ')}`)
  }

  if (!autonomyPassed) {
    recs.push('🛡️ Autonomy gate is not passed. Treat the system as evidence-incomplete and do not expand autonomous authority.')
  }

  return recs
}
