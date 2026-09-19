import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

// Phase 3b — true ACT/RESPOND separation.
// Structural tests intentionally avoid importing the live Next/Prisma dependency graph.
// They lock the ownership boundary directly in source text.
describe('Phase 3b — orchestrator is ACT-only', () => {
  const orchestrator = readFileSync('src/lib/orchestrator.ts', 'utf8')
  const route = readFileSync('src/app/api/agent/route.ts', 'utf8')
  const scheduled = readFileSync('src/app/api/schedules/tick/route.ts', 'utf8')

  test('OrchestratorRunResult contains execution evidence, not a final answer or persisted id', () => {
    expect(orchestrator).toContain('executionSummary')
    expect(orchestrator).toContain('executionStatus')
    expect(orchestrator).toContain('completionReason')
    expect(orchestrator).not.toContain('finalAnswer:')
    expect(orchestrator).not.toContain('persistedAssistantMessageId')
  })

  test('orchestrator has an explicit <done/> completion protocol and rejects free-form prose as terminal output', () => {
    expect(orchestrator).toContain('const DONE_RE')
    expect(orchestrator).toContain('if (parsed.done && !parsed.tool && !parsed.dispatch && !parsed.manage)')
    expect(orchestrator).toContain('EXECUTION-ONLY VIOLATION')
    expect(orchestrator).toContain('Do not emit markdown, explanations, or final-answer prose.')
  })

  test('orchestrator never emits answer tokens or owns assistant-message persistence', () => {
    expect(orchestrator).not.toMatch(/emit\(['"]token['"]/)
    expect(orchestrator).not.toContain("role: 'assistant', content: finalAnswer")
    expect(orchestrator).not.toContain("role: 'assistant', content: summaryAnswer")
    expect(orchestrator).not.toContain("role: 'assistant', content: ''")
  })

  test('orchestrator no longer owns conversation-title mutations', () => {
    expect(orchestrator).not.toContain('db.conversation.update')
  })

  test('orchestrator no longer owns notification classification/settings/email', () => {
    expect(orchestrator).not.toContain('getNotificationSettings')
    expect(orchestrator).not.toContain('recentlyNotified')
    expect(orchestrator).not.toContain('sendEmail')
    expect(orchestrator).not.toContain('mission_complete')
    expect(orchestrator).not.toContain('mission_failed')
  })
})

describe('Phase 3b — interactive route has one RESPOND authority', () => {
  const source = readFileSync('src/app/api/agent/route.ts', 'utf8')

  test('operational execution is followed by runCeoCognitiveLifecycle and no direct-response bypass remains', () => {
    expect(source).toContain('const result = await withOrchestrationOwner')
    expect(source).toContain('const operationalEvidence = result.executionSummary')
    expect(source).toContain('runCeoCognitiveLifecycle({')
    expect(source).not.toContain("tryOperationalDirectResponse")
    expect(source).not.toContain("from '@/lib/ceo-operational-direct-response'")
  })

  test('orchestrator answer tokens are withheld at the transport boundary', () => {
    expect(source).toContain("const emitExecutionOnly: OrchestratorEventEmit = async (event, data) => {")
    expect(source).toContain("if (event === 'token') return")
    expect(source).toContain('emit: emitExecutionOnly')
  })

  test('only governed synthesis is persisted/notified', () => {
    expect(source).toContain('content: synthesis.content')
    expect(source).toContain("notifyMissionOutcome({ conversationId, content: synthesis.content, steps: result.steps })")
    expect(source).not.toContain('result.finalAnswer')
  })
})

describe('Phase 3b — scheduled execution uses the same RESPOND authority', () => {
  const source = readFileSync('src/app/api/schedules/tick/route.ts', 'utf8')

  test('scheduled execution invokes CEO cognitive lifecycle directly', () => {
    expect(source).toContain("import { runCeoCognitiveLifecycle } from '@/lib/ceo-cognitive-lifecycle'")
    expect(source).toContain('runCeoCognitiveLifecycle({')
    expect(source).not.toContain('tryOperationalDirectResponse')
    expect(source).not.toContain('finalContent = result.finalAnswer')
  })

  test('scheduled execution persists only synthesized content and notifies after persistence', () => {
    expect(source).toContain("import { persistCeoAssistantMessage } from '@/lib/ceo-response-persistence'")
    expect(source).toContain('content: synthesis.content')
    expect(source).toContain('capturedTurnSequence')
    expect(source).toContain("notifyMissionOutcome({ conversationId, content: synthesis.content, steps: result.steps })")
    expect(source).toContain('async function executeScheduledRun(')
    expect(source).toContain("role: 'user', content: objective")
  })
})
