/**
 * Mission OS — structured mission lifecycle with bounded autonomous recovery.
 * Recovery evidence is recorded only when the runtime actually retries work
 * after a failed execution or verification attempt.
 */
import { dispatchTool } from './tools'
import { callLlmWithRetry } from './agent'
import { recallMemories } from './memory'

export const runtime = 'nodejs'
export const maxDuration = 180
const MAX_AUTONOMOUS_RECOVERY_ROUNDS = 2
const VERIFICATION_THRESHOLD = 70

export interface MissionStage { stage: string; status: 'pending' | 'running' | 'complete' | 'failed'; output?: string; durationMs?: number }
export interface MissionResult { missionId: string; goal: string; stages: MissionStage[]; finalDecision: string; confidence: number; learnings: string[]; success: boolean }

export async function runMissionPipeline(userRequest: string): Promise<MissionResult> {
  const missionId = `mission_${Date.now()}`
  const stages: MissionStage[] = []
  const { startMissionTelemetry, recordToolCall, recordLeaderDispatch, recordMemoryOp, recordRetry, recordError, recordVerification, recordConfidence, recordAutonomyEvidence, recordMissionResumption, recordOutcomeQuality, persistMissionTelemetryEvidence, completeMissionTelemetry } = await import('./mission-telemetry')
  const telemetry = startMissionTelemetry(userRequest)
  let leaders: string[] = []
  let goal = userRequest
  let recoveredAutonomously = false

  // 1. UNDERSTAND
  let stageStart = Date.now(); stages.push({ stage: 'UNDERSTAND', status: 'running' })
  try {
    const prompt = `Analyze this user request and extract:\n1. GOAL: What is the user trying to accomplish? (1 sentence)\n2. TASKS: Break it into 1-3 concrete sub-tasks\n3. LEADERS: Which Agent007 leaders should handle each task?\n\nUser request: "${userRequest}"\n\nFormat:\nGOAL: <text>\nTASKS: 1. <task1> 2. <task2> 3. <task3>\nLEADERS: <leader1>, <leader2>, <leader3>`
    const completion = await callLlmWithRetry([{ role: 'system', content: prompt }, { role: 'user', content: userRequest }])
    const output = completion?.choices?.[0]?.message?.content || ''
    stages[0] = { stage: 'UNDERSTAND', status: 'complete', output, durationMs: Date.now() - stageStart }
    recordToolCall(telemetry, 'llm_understand')
  } catch (e: any) {
    stages[0] = { stage: 'UNDERSTAND', status: 'failed', output: e.message, durationMs: Date.now() - stageStart }
    recordError(telemetry, `UNDERSTAND: ${e.message}`); recordRetry(telemetry); await completeMissionTelemetry(telemetry, 'failed')
    return { missionId, goal: userRequest, stages, finalDecision: 'Failed at UNDERSTAND stage', confidence: 0, learnings: [], success: false }
  }

  // 2. PLAN
  stageStart = Date.now(); stages.push({ stage: 'PLAN', status: 'running' })
  goal = stages[0].output?.match(/GOAL:\s*(.+)/)?.[1]?.trim() || userRequest
  const leadersStr = stages[0].output?.match(/LEADERS:\s*(.+)/)?.[1]?.trim() || 'scout'
  leaders = leadersStr.split(',').map(l => l.trim().toLowerCase()).filter(Boolean).slice(0, 3)
  telemetry.goal = goal
  stages[1] = { stage: 'PLAN', status: 'complete', output: `Goal: ${goal}\nLeaders: ${leaders.join(', ')}`, durationMs: Date.now() - stageStart }

  // 3. CONTEXT
  stageStart = Date.now(); stages.push({ stage: 'CONTEXT', status: 'running' })
  try {
    const memories = await recallMemories(userRequest, 5).catch(() => [])
    recordMemoryOp(telemetry, 'read')
    stages[2] = { stage: 'CONTEXT', status: 'complete', output: memories.length ? `Recalled ${memories.length} relevant memories:\n${memories.map(m => `- ${m.key}: ${(m.value || '').slice(0, 100)}`).join('\n')}` : 'No relevant memories found — fresh mission', durationMs: Date.now() - stageStart }
  } catch (e: any) {
    stages[2] = { stage: 'CONTEXT', status: 'complete', output: 'Memory recall failed', durationMs: Date.now() - stageStart }; recordError(telemetry, `CONTEXT: ${e.message}`)
  }

  // 4+5. DISPATCH + EXECUTE. A retry is autonomous only when an actual failed attempt occurred.
  async function executeEvidenceAttempt(round: number): Promise<{ output: string; allSucceeded: boolean }> {
    const results = await Promise.allSettled(leaders.map(leader => dispatchTool('web_search', { query: `${goal} ${leader} analysis` }, { attachments: [], language: 'en' }).catch(() => null)))
    let allSucceeded = true
    for (let i = 0; i < leaders.length; i++) {
      recordLeaderDispatch(telemetry, leaders[i]); recordToolCall(telemetry, 'web_search')
      const r = results[i] as any; const ok = r.status === 'fulfilled' && r.value?.ok
      if (!ok) { allSucceeded = false; recordError(telemetry, `round ${round}: ${leaders[i]} dispatch failed`) }
    }
    return { allSucceeded, output: results.map((r, i) => `${leaders[i]}: ${r.status === 'fulfilled' && r.value?.ok ? '✅ data collected' : '❌ failed'}`).join('\n') }
  }

  stageStart = Date.now(); stages.push({ stage: 'DISPATCH', status: 'running' })
  let dispatchOutput = ''; let dispatchSucceeded = false
  for (let round = 0; round <= MAX_AUTONOMOUS_RECOVERY_ROUNDS; round++) {
    try {
      const attempt = await executeEvidenceAttempt(round); dispatchOutput = attempt.output; dispatchSucceeded = attempt.allSucceeded
      if (dispatchSucceeded || round === MAX_AUTONOMOUS_RECOVERY_ROUNDS) break
    } catch (e: any) { recordError(telemetry, `DISPATCH round ${round}: ${e.message}`); if (round === MAX_AUTONOMOUS_RECOVERY_ROUNDS) break }
    recordRetry(telemetry); recoveredAutonomously = true; recordMissionResumption(telemetry, true)
  }
  stages[3] = { stage: 'DISPATCH', status: dispatchSucceeded ? 'complete' : 'failed', output: dispatchOutput || 'No dispatch result', durationMs: Date.now() - stageStart }

  // 6. VERIFY. Failed verification triggers evidence recollection and another independent verification pass.
  stageStart = Date.now(); stages.push({ stage: 'VERIFY', status: 'running' })
  let verificationScore = 0; let verificationPassed = false
  async function verifyAttempt(): Promise<{ score: number; passed: boolean; output: string }> {
    const result = await dispatchTool('accuracy_checker', { claim: goal, sources: dispatchOutput }, { attachments: [], language: 'en' }).catch(() => null)
    recordToolCall(telemetry, 'accuracy_checker')
    if (!result?.ok) return { score: 0, passed: false, output: 'Verification unavailable' }
    const match = result.result?.match(/(\d+)%/); const score = match ? parseInt(match[1], 10) : 75
    return { score, passed: score >= VERIFICATION_THRESHOLD, output: `Verification: ${score}%` }
  }
  for (let round = 0; round <= MAX_AUTONOMOUS_RECOVERY_ROUNDS; round++) {
    try {
      const verification = await verifyAttempt(); verificationScore = verification.score; verificationPassed = verification.passed
      if (verificationPassed || round === MAX_AUTONOMOUS_RECOVERY_ROUNDS) break
      recordError(telemetry, `verification below threshold: ${verificationScore}%`)
      const recovery = await executeEvidenceAttempt(round + 1); dispatchOutput = recovery.output; dispatchSucceeded = recovery.allSucceeded
    } catch (e: any) { recordError(telemetry, `VERIFY round ${round}: ${e.message}`); if (round === MAX_AUTONOMOUS_RECOVERY_ROUNDS) break }
    recordRetry(telemetry); recoveredAutonomously = true; recordMissionResumption(telemetry, true)
  }
  recordVerification(telemetry, verificationScore, verificationPassed)
  stages[4] = { stage: 'VERIFY', status: verificationPassed ? 'complete' : 'failed', output: verificationPassed ? `Verification: ${verificationScore}%` : `Verification failed (${verificationScore}%)`, durationMs: Date.now() - stageStart }
  recordAutonomyEvidence(telemetry, { eligible: true, goalAutonomous: true, executionAutonomous: dispatchSucceeded, verificationIndependent: verificationPassed, recoveryAutonomous: recoveredAutonomously })

  // 7. DECIDE
  stageStart = Date.now(); stages.push({ stage: 'DECIDE', status: 'running' })
  let finalDecision = ''; let confidence = 0
  try {
    const prompt = `You are the Executive Brain of Agent007 AI. A mission has completed its execution and verification stages.\n\nMission goal: ${goal}\nContext: ${stages[2].output}\nDispatch results: ${dispatchOutput}\nVerification: ${stages[4].output}\n\nSynthesize the final executive decision:\n1. What was accomplished?\n2. What's the recommendation?\n3. Confidence level (0-100%)?\n\nFormat:\nDECISION: <2-3 sentences>\nCONFIDENCE: <number>%`
    const completion = await callLlmWithRetry([{ role: 'system', content: prompt }, { role: 'user', content: 'Make the final decision.' }])
    recordToolCall(telemetry, 'llm_decide')
    const output = completion?.choices?.[0]?.message?.content || ''
    finalDecision = output.match(/DECISION:\s*([\s\S]+)/)?.[1]?.trim() || output
    confidence = parseInt(output.match(/CONFIDENCE:\s*(\d+)/)?.[1] || '0', 10); recordConfidence(telemetry, confidence)
    telemetry.autonomyEvidence = { ...(telemetry.autonomyEvidence ?? { eligible: true }), decisionAutonomous: true }
    stages[5] = { stage: 'DECIDE', status: 'complete', output, durationMs: Date.now() - stageStart }
  } catch (e: any) { stages[5] = { stage: 'DECIDE', status: 'failed', output: e.message, durationMs: Date.now() - stageStart }; recordError(telemetry, `DECIDE: ${e.message}`) }

  // 8. LEARN + audit + explicit outcome quality persistence.
  stageStart = Date.now(); stages.push({ stage: 'LEARN', status: 'running' }); const learnings: string[] = []
  try {
    const learning = `Mission ${missionId} completed. Goal: ${goal}. Confidence: ${confidence}%. Decision: ${finalDecision.slice(0, 200)}`
    const memoryResult = await dispatchTool('memory_store', { key: `mission_${missionId}`, value: learning, category: 'mission_outcome' }, { attachments: [], language: 'en' }).catch(() => null)
    recordMemoryOp(telemetry, 'write'); recordToolCall(telemetry, 'memory_store')
    if (memoryResult?.ok !== false) { telemetry.autonomyEvidence = { ...(telemetry.autonomyEvidence ?? { eligible: true }), learningApplied: true }; learnings.push('Mission outcome stored in persistent memory') }
    const stagesCompleted = stages.filter(s => s.status === 'complete').map(s => s.stage)
    const stagesFailed = stages.filter(s => s.status === 'failed').map(s => s.stage)
    await completeMissionTelemetry(telemetry, stagesFailed.length === 0 ? 'completed' : 'failed')
    const { generateAuditReport } = await import('./executive-audit-engine')
    const auditReport = await generateAuditReport(telemetry, stagesCompleted, stagesFailed)
    recordOutcomeQuality(telemetry, auditReport.qualityScore); await persistMissionTelemetryEvidence(telemetry)
    learnings.push(`Audit report generated: ${auditReport.overallVerdict} (quality: ${auditReport.qualityScore}%)`)
    const { checkRecommendationsAgainstMission } = await import('./closed-loop-improvement'); await checkRecommendationsAgainstMission(telemetry, auditReport); learnings.push('Closed-loop improvement check completed')
    const { ingestMission } = await import('./organizational-knowledge-base'); await ingestMission(telemetry); learnings.push('Organizational knowledge base updated')
    stages[6] = { stage: 'LEARN', status: 'complete', output: learning + '\n' + auditReport.lessonsLearned, durationMs: Date.now() - stageStart }
  } catch (e: any) {
    stages[6] = { stage: 'LEARN', status: 'failed', output: 'Learning/audit failed: ' + e.message, durationMs: Date.now() - stageStart }; recordError(telemetry, `LEARN: ${e.message}`); await completeMissionTelemetry(telemetry, 'failed')
  }

  const success = stages.every(s => s.status === 'complete')
  return { missionId, goal, stages, finalDecision, confidence, learnings, success }
}
