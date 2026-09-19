import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

// Phase 3 of the CEO Conversation Kernel migration (making the orchestrator execution-only,
// 2026-09-19): runOrchestrator used to be a unilateral persistence AND notification authority for the
// assistant's final answer -- writing `finalAnswer` straight to the Message table (across three
// separate return paths: the main tool-dispatch loop, the fast-path create_agent shortcut, and the
// mission-pipeline early return) and firing a "mission complete"/"mission failed" email off that same
// raw, ungoverned text, both before route.ts's quality gate (tryOperationalDirectResponse /
// runCeoCognitiveLifecycle) had even run. These tests lock in that all three return paths stopped
// persisting/notifying, that OrchestratorRunResult no longer promises a persisted id it doesn't
// produce, and that every real caller (route.ts, the scheduled tick route) now owns persistence and
// notification itself.
//
// orchestrator.ts / route.ts / the tick route are not live-importable in this sandbox (Prisma,
// next/server, next-auth, and dozens of live tool integrations aren't available here -- the same
// constraint documented throughout this suite, e.g. orchestrator-identity-reminder-hoist.test.ts), so
// this is source-text structural testing, the same technique this migration's other
// architecture-invariant tests already use.
describe('orchestrator.ts no longer owns final-answer persistence or notification (Phase 3)', () => {
  const source = readFileSync('src/lib/orchestrator.ts', 'utf8')

  test('OrchestratorRunResult no longer declares persistedAssistantMessageId', () => {
    expect(source).not.toContain('persistedAssistantMessageId')
  })

  test('runOrchestrator delegates notification to the extracted mission-notifications module, not an inline email/settings block', () => {
    expect(source).not.toContain('getNotificationSettings')
    expect(source).not.toContain('recentlyNotified')
    expect(source).not.toContain('mission_complete')
    expect(source).not.toContain('mission_failed')
  })

  test('none of the three OrchestratorRunResult return paths creates or updates an assistant Message row', () => {
    // The only remaining `db.message.create({ data: { conversationId, role: 'assistant'` should be
    // zero -- persistence moved entirely to callers (route.ts, the tick route).
    expect(source).not.toContain("data: { conversationId, role: 'assistant', content: finalAnswer }")
    expect(source).not.toContain("data: { conversationId, role: 'assistant', content: '' }")
    expect(source).not.toContain("data: { conversationId, role: 'assistant', content: summaryAnswer }")
  })

  test('the mission-notifications module is documented as the relocated notification authority', () => {
    expect(source).toContain('mission-notifications.ts')
  })
})

describe('route.ts persists the operational branch via the same CREATE helper as the ceo_lifecycle branch (Phase 3)', () => {
  const source = readFileSync('src/app/api/agent/route.ts', 'utf8')

  test('imports notifyMissionOutcome and no longer imports updateCeoAssistantMessage', () => {
    expect(source).toContain("import { notifyMissionOutcome } from '@/lib/mission-notifications'")
    expect(source).not.toContain('updateCeoAssistantMessage')
  })

  test('persistCeoAssistantMessage is called twice -- once per branch -- with a consistent shape', () => {
    const callCount = (source.match(/persistCeoAssistantMessage\(\{/g) ?? []).length
    expect(callCount).toBe(2)
  })

  test('the operational branch calls notifyMissionOutcome with the governed synthesis content, gated on non-supersession', () => {
    expect(source).toContain("if (!responseSuperseded) notifyMissionOutcome({ conversationId, content: synthesis.content, steps: result.steps })")
  })
})

describe('the scheduled tick route persists and notifies for both its call sites (Phase 3)', () => {
  const source = readFileSync('src/app/api/schedules/tick/route.ts', 'utf8')

  test('imports notifyMissionOutcome and defines a shared persist helper', () => {
    expect(source).toContain("import { notifyMissionOutcome } from '@/lib/mission-notifications'")
    expect(source).toContain('async function persistOrchestratorResult(')
  })

  test('both runOrchestrator call sites (manual dispatch, background-scheduled dispatch) call the persist helper', () => {
    const callCount = (source.match(/persistOrchestratorResult\(/g) ?? []).length
    // One definition-site reference (the function itself calling db.message.create internally is not
    // a call to itself) plus two real call sites -- match against the two call sites specifically by
    // requiring the call to be awaited with a variable argument, not the function declaration line.
    const invocationCount = (source.match(/await persistOrchestratorResult\(/g) ?? []).length
    expect(invocationCount).toBe(2)
    expect(callCount).toBeGreaterThanOrEqual(invocationCount)
  })
})
