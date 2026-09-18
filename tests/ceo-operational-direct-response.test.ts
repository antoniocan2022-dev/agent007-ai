import { describe, expect, test } from 'bun:test'
import { tryOperationalDirectResponse } from '@/lib/ceo-operational-direct-response'
import { preRouteCeoRequest } from '@/lib/ceo-pre-router'

const user = (content: string) => [{ role: 'user' as const, content }]

// Stage 1b of the CEO Conversation Kernel migration (2026-09-18): route.ts's operational_orchestrator
// branch used to unconditionally run the full CEO pipeline a second time on every action request,
// discarding an answer runOrchestrator() had already produced and persisted. tryOperationalDirectResponse
// is the safer alternative: verify the orchestrator's own answer against the same quality gate every
// other response path uses, and only fall back to a full regeneration when it doesn't pass.
describe('tryOperationalDirectResponse', () => {
  const message = 'Fix the Vercel deployment problem.'
  const preRoute = preRouteCeoRequest(user(message))
  const noToolSteps: { toolResult?: { ok: boolean } }[] = []

  test('empty candidate content short-circuits to null without running the quality gate', () => {
    const result = tryOperationalDirectResponse({
      messages: user(message),
      preRoute,
      objective: message,
      candidateContent: '   ',
      responseMsBeforeCheck: 1200,
      toolSteps: noToolSteps,
    })
    expect(result).toBeNull()
  })

  test('a substantive, well-formed answer to the actual request passes and returns a full CognitiveLifecycleResult', () => {
    const answer = '## Deployment fixed\n\nThe last build failed because the DATABASE_URL environment variable was missing on the production environment. I took the following actions: added the missing variable in Vercel, then triggered a fresh deployment. The new deployment completed successfully and is now serving traffic. No further action is needed.'
    const result = tryOperationalDirectResponse({
      messages: user(message),
      preRoute,
      objective: message,
      candidateContent: answer,
      responseMsBeforeCheck: 4300,
      toolSteps: noToolSteps,
    })
    expect(result).not.toBeNull()
    expect(result!.degraded).toBe(false)
    expect(result!.provider).toBe('operational_orchestrator')
    expect(result!.quality.decision).toBe('PASS')
    expect(result!.content).toContain('DATABASE_URL')
    expect(result!.responseMs).toBe(4300)
    expect(result!.generation.finalStage).toBe('primary')
    expect(result!.generation.escalationCount).toBe(0)
    // decisionPlan/executionPlan must be real, usable objects -- not stand-ins -- since callers
    // (route.ts's SSE payload, buildCeoRuntimeMetrics) read fields off them directly.
    expect(result!.decisionPlan.executionContract.intent).toBeTruthy()
    expect(result!.executionPlan.stages.length).toBeGreaterThan(0)
  })

  // Fresh-audit finding: evaluateCeoQuality derives 'LIVE_VERIFIED' from nothing more than
  // (passed && evidenceScope is live_system/mixed && fresh) -- there's no independent-verification
  // signal distinct from "the claim's scope was internally consistent". This function never
  // independently verifies anything; it only checks that the orchestrator's self-reported answer is
  // well-formed and consistent. Reporting a genuine PASS as 'LIVE_VERIFIED' would overclaim exactly
  // the kind of unearned confidence this codebase has repeatedly had to fix elsewhere -- the honest
  // label is 'LIVE_EXECUTED' (action taken, outcome not independently confirmed).
  test('a genuine PASS is reported as LIVE_EXECUTED, never the stronger LIVE_VERIFIED this function never actually earns', () => {
    const answer = '## Deployment fixed\n\nThe last build failed because the DATABASE_URL environment variable was missing on the production environment. I took the following actions: added the missing variable in Vercel, then triggered a fresh deployment. The new deployment completed successfully and is now serving traffic. No further action is needed.'
    const result = tryOperationalDirectResponse({
      messages: user(message),
      preRoute,
      objective: message,
      candidateContent: answer,
      responseMsBeforeCheck: 4300,
      toolSteps: noToolSteps,
    })
    expect(result).not.toBeNull()
    expect(result!.evidenceState).toBe('LIVE_EXECUTED')
    expect(result!.quality.evidenceState).toBe('LIVE_EXECUTED')
    expect(result!.evidenceState).not.toBe('LIVE_VERIFIED')
  })

  // Fresh-audit finding: ToolResult already carries a real `ok: boolean` per tool call, but this
  // function used to unconditionally claim externalExecutionSucceeded: true regardless of it -- an
  // orchestrator answer that confidently narrates success despite a real tool failure underneath
  // would have sailed through the direct-pass gate instead of falling back to a full synthesis pass
  // that could honestly account for the failure.
  test('a confidently-worded answer is rejected (forcing fallback) when the underlying tool execution actually failed', () => {
    const overclaimingAnswer = '## Deployment fixed\n\nThe last build failed because the DATABASE_URL environment variable was missing. I added the missing variable in Vercel and triggered a fresh deployment, which completed successfully and is now serving traffic. No further action is needed.'
    const result = tryOperationalDirectResponse({
      messages: user(message),
      preRoute,
      objective: message,
      candidateContent: overclaimingAnswer,
      responseMsBeforeCheck: 4300,
      toolSteps: [{ toolResult: { ok: true } }, { toolResult: { ok: false } }],
    })
    expect(result).toBeNull()
  })

  test('an answer that does not address the actual request fails the gate and returns null (caller must fall back)', () => {
    const result = tryOperationalDirectResponse({
      messages: user(message),
      preRoute,
      objective: message,
      candidateContent: 'Hi! How can I help you today?',
      responseMsBeforeCheck: 900,
      toolSteps: noToolSteps,
    })
    expect(result).toBeNull()
  })
})
