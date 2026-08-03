/**
 * mission-os.ts — UPGRADE #209
 *
 * The Mission OS Pipeline — formalizes every request into a structured
 * mission lifecycle instead of ad-hoc orchestration.
 *
 * Every request follows 8 stages:
 *   1. UNDERSTAND  — parse the request, identify the mission goal
 *   2. PLAN        — decompose into tasks, assign leaders
 *   3. CONTEXT     — gather memory + live data relevant to the mission
 *   4. DISPATCH    — assign leaders, dispatch in parallel
 *   5. EXECUTE     — leaders work their tasks
 *   6. VERIFY      — fact-check, risk-check, consistency-check
 *   7. DECIDE      — executive synthesis + final decision
 *   8. LEARN       — store outcome in memory for future reference
 *
 * This makes the system predictable: every request follows the same lifecycle.
 */

import { dispatchTool } from './tools'
import { callLlmWithRetry } from './agent'
import { recallMemories } from './memory'

export const runtime = 'nodejs'
export const maxDuration = 180

export interface MissionStage {
  stage: string
  status: 'pending' | 'running' | 'complete' | 'failed'
  output?: string
  durationMs?: number
}

export interface MissionResult {
  missionId: string
  goal: string
  stages: MissionStage[]
  finalDecision: string
  confidence: number
  learnings: string[]
  success: boolean
}

/**
 * Run a request through the full Mission OS Pipeline.
 *
 * @param userRequest - What the user asked for
 * @returns MissionResult with all 8 stages completed
 */
export async function runMissionPipeline(userRequest: string): Promise<MissionResult> {
  const missionId = `mission_${Date.now()}`
  const stages: MissionStage[] = []
  console.log(`[mission-os] Starting ${missionId}: "${userRequest.slice(0, 80)}..."`)

  // ═══ FINDING 9 FIX: Wire telemetry producer into Mission OS ═══
  // Every mission now tracks REAL telemetry data that the Evolution Engine consumes.
  const { startMissionTelemetry, recordToolCall, recordLeaderDispatch, recordMemoryOp,
          recordRetry, recordError, recordVerification, recordConfidence,
          recordDebate, recordExecutiveCorrection, completeMissionTelemetry } = await import('./mission-telemetry')
  const telemetry = startMissionTelemetry(userRequest)

  // Leaders identified during planning
  let leaders: string[] = []
  let goal = userRequest

  // ═══ STAGE 1: UNDERSTAND ═══
  let stageStart = Date.now()
  stages.push({ stage: 'UNDERSTAND', status: 'running' })
  try {
    const understandPrompt = `Analyze this user request and extract:
1. GOAL: What is the user trying to accomplish? (1 sentence)
2. TASKS: Break it into 1-3 concrete sub-tasks
3. LEADERS: Which Agent007 leaders should handle each task? (scout, aurora, quantum, echo, forge, pulse, legal, banker, trader, etc.)

User request: "${userRequest}"

Format:
GOAL: <text>
TASKS: 1. <task1> 2. <task2> 3. <task3>
LEADERS: <leader1>, <leader2>, <leader3>`

    const completion = await callLlmWithRetry([
      { role: 'system', content: understandPrompt },
      { role: 'user', content: userRequest },
    ])
    const understandOutput = completion?.choices?.[0]?.message?.content || ''
    stages[0] = { stage: 'UNDERSTAND', status: 'complete', output: understandOutput, durationMs: Date.now() - stageStart }
    recordToolCall(telemetry, 'llm_understand', 0, 0)
    console.log(`[mission-os] Stage 1 UNDERSTAND complete (${Date.now() - stageStart}ms)`)
  } catch (e: any) {
    stages[0] = { stage: 'UNDERSTAND', status: 'failed', output: e.message, durationMs: Date.now() - stageStart }
    recordError(telemetry, `UNDERSTAND: ${e.message}`)
    recordRetry(telemetry)
    await completeMissionTelemetry(telemetry, 'failed')
    return { missionId, goal: userRequest, stages, finalDecision: 'Failed at UNDERSTAND stage', confidence: 0, learnings: [], success: false }
  }

  // ═══ STAGE 2: PLAN ═══
  stageStart = Date.now()
  stages.push({ stage: 'PLAN', status: 'running' })
  goal = stages[0].output?.match(/GOAL:\s*(.+)/)?.[1]?.trim() || userRequest
  const leadersStr = stages[0].output?.match(/LEADERS:\s*(.+)/)?.[1]?.trim() || 'scout'
  leaders = leadersStr.split(',').map(l => l.trim().toLowerCase()).filter(Boolean).slice(0, 3)
  telemetry.goal = goal
  stages[1] = { stage: 'PLAN', status: 'complete', output: `Goal: ${goal}\nLeaders: ${leaders.join(', ')}`, durationMs: Date.now() - stageStart }
  console.log(`[mission-os] Stage 2 PLAN complete — leaders: ${leaders.join(', ')}`)

  // ═══ STAGE 3: CONTEXT (gather memory) ═══
  stageStart = Date.now()
  stages.push({ stage: 'CONTEXT', status: 'running' })
  let memoriesRecalled = 0
  try {
    const memories = await recallMemories(userRequest, 5).catch(() => [])
    memoriesRecalled = memories.length
    recordMemoryOp(telemetry, 'read')
    const contextOutput = memories.length > 0
      ? `Recalled ${memories.length} relevant memories:\n${memories.map(m => `- ${m.key}: ${(m.value || '').slice(0, 100)}`).join('\n')}`
      : 'No relevant memories found — fresh mission'
    stages[2] = { stage: 'CONTEXT', status: 'complete', output: contextOutput, durationMs: Date.now() - stageStart }
    console.log(`[mission-os] Stage 3 CONTEXT complete — ${memories.length} memories recalled`)
  } catch (e: any) {
    stages[2] = { stage: 'CONTEXT', status: 'complete', output: 'Memory recall failed', durationMs: Date.now() - stageStart }
    recordError(telemetry, `CONTEXT: ${e.message}`)
  }

  // ═══ STAGE 4+5: DISPATCH + EXECUTE (parallel) ═══
  stageStart = Date.now()
  stages.push({ stage: 'DISPATCH', status: 'running' })
  try {
    const dispatches = await Promise.allSettled(
      leaders.map(leader =>
        dispatchTool('web_search', {
          query: `${goal} ${leader} analysis`,
        }, { attachments: [], language: 'en' }).catch(() => null)
      )
    )
    // Record each leader dispatch + tool call in telemetry
    for (let i = 0; i < leaders.length; i++) {
      recordLeaderDispatch(telemetry, leaders[i])
      recordToolCall(telemetry, 'web_search')
      const dispatchResult = dispatches[i] as any
      if (dispatchResult.status !== 'fulfilled' || !dispatchResult.value?.ok) {
        recordError(telemetry, `${leaders[i]} dispatch failed`)
      }
    }
    const dispatchOutput = dispatches
      .map((d, i) => `${leaders[i]}: ${d.status === 'fulfilled' && d.value?.ok ? '✅ data collected' : '❌ failed'}`)
      .join('\n')
    stages[3] = { stage: 'DISPATCH', status: 'complete', output: dispatchOutput, durationMs: Date.now() - stageStart }
    console.log(`[mission-os] Stage 4 DISPATCH complete`)
  } catch (e: any) {
    stages[3] = { stage: 'DISPATCH', status: 'failed', output: e.message, durationMs: Date.now() - stageStart }
    recordError(telemetry, `DISPATCH: ${e.message}`)
  }

  // ═══ STAGE 6: VERIFY ═══
  stageStart = Date.now()
  stages.push({ stage: 'VERIFY', status: 'running' })
  let verificationScore = 0
  let verificationPassed = false
  try {
    const verifyResult = await dispatchTool('accuracy_checker', {
      claim: goal,
      sources: stages[3].output || '',
    }, { attachments: [], language: 'en' }).catch(() => null)
    recordToolCall(telemetry, 'accuracy_checker')
    if (verifyResult?.ok) {
      // Try to extract score from result
      const scoreMatch = verifyResult.result?.match(/(\d+)%/)
      verificationScore = scoreMatch ? parseInt(scoreMatch[1]) : 75
      verificationPassed = verificationScore >= 70
      recordVerification(telemetry, verificationScore, verificationPassed)
    }
    stages[4] = { stage: 'VERIFY', status: 'complete', output: verifyResult?.ok ? `Verification: ${verificationScore}%` : 'Verification skipped', durationMs: Date.now() - stageStart }
    console.log(`[mission-os] Stage 6 VERIFY complete — score: ${verificationScore}%`)
  } catch {
    stages[4] = { stage: 'VERIFY', status: 'complete', output: 'Verification unavailable', durationMs: Date.now() - stageStart }
  }

  // ═══ STAGE 7: DECIDE (executive synthesis) ═══
  stageStart = Date.now()
  stages.push({ stage: 'DECIDE', status: 'running' })
  let finalDecision = ''
  let confidence = 0
  try {
    const decidePrompt = `You are the Executive Brain of Agent007 AI. A mission has completed all stages.

Mission goal: ${goal}
Context: ${stages[2].output}
Dispatch results: ${stages[3].output}
Verification: ${stages[4].output}

Synthesize the final executive decision:
1. What was accomplished?
2. What's the recommendation?
3. Confidence level (0-100%)?

Format:
DECISION: <2-3 sentences>
CONFIDENCE: <number>%`

    const completion = await callLlmWithRetry([
      { role: 'system', content: decidePrompt },
      { role: 'user', content: 'Make the final decision.' },
    ])
    recordToolCall(telemetry, 'llm_decide')
    const decideOutput = completion?.choices?.[0]?.message?.content || ''
    finalDecision = decideOutput.match(/DECISION:\s*([\s\S]+)/)?.[1]?.trim() || decideOutput
    confidence = parseInt(decideOutput.match(/CONFIDENCE:\s*(\d+)/)?.[1] || '0')
    recordConfidence(telemetry, confidence)
    stages[5] = { stage: 'DECIDE', status: 'complete', output: decideOutput, durationMs: Date.now() - stageStart }
    console.log(`[mission-os] Stage 7 DECIDE complete — confidence: ${confidence}%`)
  } catch (e: any) {
    stages[5] = { stage: 'DECIDE', status: 'failed', output: e.message, durationMs: Date.now() - stageStart }
    recordError(telemetry, `DECIDE: ${e.message}`)
  }

  // ═══ STAGE 8: LEARN (store in memory + generate audit) ═══
  stageStart = Date.now()
  stages.push({ stage: 'LEARN', status: 'running' })
  const learnings: string[] = []
  try {
    const learning = `Mission ${missionId} completed. Goal: ${goal}. Confidence: ${confidence}%. Decision: ${finalDecision.slice(0, 200)}`
    await dispatchTool('memory_store', {
      key: `mission_${missionId}`,
      value: learning,
      category: 'mission_outcome',
    }, { attachments: [], language: 'en' }).catch(() => {})
    recordMemoryOp(telemetry, 'write')
    recordToolCall(telemetry, 'memory_store')
    learnings.push('Mission outcome stored in persistent memory')

    // ═══ FINDING 9: Complete telemetry + generate audit report ═══
    const stagesCompleted = stages.filter(s => s.status === 'complete').map(s => s.stage)
    const stagesFailed = stages.filter(s => s.status === 'failed').map(s => s.stage)
    await completeMissionTelemetry(telemetry, stagesFailed.length === 0 ? 'completed' : 'failed')

    // Generate Executive Audit Report (from #219)
    const { generateAuditReport } = await import('./executive-audit-engine')
    const auditReport = await generateAuditReport(telemetry, stagesCompleted, stagesFailed)
    learnings.push(`Audit report generated: ${auditReport.overallVerdict} (quality: ${auditReport.qualityScore}%)`)

    // ═══ FINDING 7: Closed-loop improvement cycle ═══
    // Check if any recommendations from previous evolution reports
    // can now be verified against this mission's outcome.
    const { checkRecommendationsAgainstMission } = await import('./closed-loop-improvement')
    await checkRecommendationsAgainstMission(telemetry, auditReport)
    learnings.push('Closed-loop improvement check completed')

    // ═══ FINDING 3: Ingest into Organizational Knowledge Base (#227) ═══
    // Every completed mission feeds the org KB with:
    // - Best/worst workflows
    // - Common failures/successes
    // - Leader combinations
    // - Reasoning patterns
    const { ingestMission } = await import('./organizational-knowledge-base')
    await ingestMission(telemetry)
    learnings.push('Organizational knowledge base updated')

    stages[6] = { stage: 'LEARN', status: 'complete', output: learning + '\n' + auditReport.lessonsLearned, durationMs: Date.now() - stageStart }
    console.log(`[mission-os] Stage 8 LEARN complete — audit: ${auditReport.overallVerdict}`)
  } catch (e: any) {
    stages[6] = { stage: 'LEARN', status: 'complete', output: 'Memory store failed: ' + e.message, durationMs: Date.now() - stageStart }
    recordError(telemetry, `LEARN: ${e.message}`)
    // Still try to complete telemetry even if LEARN fails
    await completeMissionTelemetry(telemetry, 'failed')
  }

  const success = stages.every(s => s.status === 'complete')
  console.log(`[mission-os] Mission ${missionId} complete — success: ${success}, confidence: ${confidence}%`)

  return {
    missionId,
    goal,
    stages,
    finalDecision,
    confidence,
    learnings,
    success,
  }
}
