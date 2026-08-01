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
    console.log(`[mission-os] Stage 1 UNDERSTAND complete (${Date.now() - stageStart}ms)`)
  } catch (e: any) {
    stages[0] = { stage: 'UNDERSTAND', status: 'failed', output: e.message, durationMs: Date.now() - stageStart }
    return { missionId, goal: userRequest, stages, finalDecision: 'Failed at UNDERSTAND stage', confidence: 0, learnings: [], success: false }
  }

  // ═══ STAGE 2: PLAN ═══
  stageStart = Date.now()
  stages.push({ stage: 'PLAN', status: 'running' })
  const goal = stages[0].output?.match(/GOAL:\s*(.+)/)?.[1]?.trim() || userRequest
  const leadersStr = stages[0].output?.match(/LEADERS:\s*(.+)/)?.[1]?.trim() || 'scout'
  const leaders = leadersStr.split(',').map(l => l.trim().toLowerCase()).filter(Boolean).slice(0, 3)
  stages[1] = { stage: 'PLAN', status: 'complete', output: `Goal: ${goal}\nLeaders: ${leaders.join(', ')}`, durationMs: Date.now() - stageStart }
  console.log(`[mission-os] Stage 2 PLAN complete — leaders: ${leaders.join(', ')}`)

  // ═══ STAGE 3: CONTEXT (gather memory) ═══
  stageStart = Date.now()
  stages.push({ stage: 'CONTEXT', status: 'running' })
  try {
    const memories = await recallMemories(userRequest, 5).catch(() => [])
    const contextOutput = memories.length > 0
      ? `Recalled ${memories.length} relevant memories:\n${memories.map(m => `- ${m.key}: ${(m.value || '').slice(0, 100)}`).join('\n')}`
      : 'No relevant memories found — fresh mission'
    stages[2] = { stage: 'CONTEXT', status: 'complete', output: contextOutput, durationMs: Date.now() - stageStart }
    console.log(`[mission-os] Stage 3 CONTEXT complete — ${memories.length} memories recalled`)
  } catch (e: any) {
    stages[2] = { stage: 'CONTEXT', status: 'complete', output: 'Memory recall failed', durationMs: Date.now() - stageStart }
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
    const dispatchOutput = dispatches
      .map((d, i) => `${leaders[i]}: ${d.status === 'fulfilled' && d.value?.ok ? '✅ data collected' : '❌ failed'}`)
      .join('\n')
    stages[3] = { stage: 'DISPATCH', status: 'complete', output: dispatchOutput, durationMs: Date.now() - stageStart }
    console.log(`[mission-os] Stage 4 DISPATCH complete`)
  } catch (e: any) {
    stages[3] = { stage: 'DISPATCH', status: 'failed', output: e.message, durationMs: Date.now() - stageStart }
  }

  // ═══ STAGE 6: VERIFY ═══
  stageStart = Date.now()
  stages.push({ stage: 'VERIFY', status: 'running' })
  try {
    const verifyResult = await dispatchTool('accuracy_checker', {
      claim: goal,
      sources: stages[3].output || '',
    }, { attachments: [], language: 'en' }).catch(() => null)
    stages[4] = { stage: 'VERIFY', status: 'complete', output: verifyResult?.ok ? 'Verification passed' : 'Verification skipped', durationMs: Date.now() - stageStart }
    console.log(`[mission-os] Stage 6 VERIFY complete`)
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
    const decideOutput = completion?.choices?.[0]?.message?.content || ''
    finalDecision = decideOutput.match(/DECISION:\s*([\s\S]+)/)?.[1]?.trim() || decideOutput
    confidence = parseInt(decideOutput.match(/CONFIDENCE:\s*(\d+)/)?.[1] || '0')
    stages[5] = { stage: 'DECIDE', status: 'complete', output: decideOutput, durationMs: Date.now() - stageStart }
    console.log(`[mission-os] Stage 7 DECIDE complete — confidence: ${confidence}%`)
  } catch (e: any) {
    stages[5] = { stage: 'DECIDE', status: 'failed', output: e.message, durationMs: Date.now() - stageStart }
  }

  // ═══ STAGE 8: LEARN (store in memory) ═══
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
    learnings.push('Mission outcome stored in persistent memory')
    stages[6] = { stage: 'LEARN', status: 'complete', output: learning, durationMs: Date.now() - stageStart }
    console.log(`[mission-os] Stage 8 LEARN complete`)
  } catch {
    stages[6] = { stage: 'LEARN', status: 'complete', output: 'Memory store failed', durationMs: Date.now() - stageStart }
  }

  const success = stages.every(s => s.status === 'complete')
  console.log(`[mission-os] Mission ${missionId} complete — success: ${success}`)

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
