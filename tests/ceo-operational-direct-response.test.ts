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

  test('empty candidate content short-circuits to null without running the quality gate', () => {
    const result = tryOperationalDirectResponse({
      messages: user(message),
      preRoute,
      objective: message,
      candidateContent: '   ',
      responseMsBeforeCheck: 1200,
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

  test('an answer that does not address the actual request fails the gate and returns null (caller must fall back)', () => {
    const result = tryOperationalDirectResponse({
      messages: user(message),
      preRoute,
      objective: message,
      candidateContent: 'Hi! How can I help you today?',
      responseMsBeforeCheck: 900,
    })
    expect(result).toBeNull()
  })
})
