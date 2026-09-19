import { describe, expect, test } from 'bun:test'
import { tryOperationalDirectResponse } from '@/lib/ceo-operational-direct-response'
import { preRouteCeoRequest } from '@/lib/ceo-pre-router'
import { buildCeoDecisionPlan } from '@/lib/ceo-cognitive-kernel'

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

  // Fresh-audit finding (Stage 1b) / Stage 4 update: evaluateCeoQuality derives 'LIVE_VERIFIED' from
  // nothing more than (passed && evidenceScope is live_system/mixed && fresh) -- there's no
  // independent-verification signal distinct from "the claim's scope was internally consistent" in
  // that formula alone. With no tool steps at all (this test's case), this function has no
  // independent evidence to point to, so the honest label stays 'LIVE_EXECUTED' (action taken, outcome
  // not independently confirmed). Stage 4 (below, in the "verified action evidence" tests) adds the
  // one case where 'LIVE_VERIFIED' IS now honestly earned: a known action-tool call that both
  // succeeded and produced a confirmed artifact.
  test('a genuine PASS with no tool-verified evidence is reported as LIVE_EXECUTED, not the stronger LIVE_VERIFIED', () => {
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

  // Stage 4 of the CEO Conversation Kernel migration (2026-09-18): a real execution-outcome VERIFY
  // step. UPGRADE #124's verifyToolAction already checks a tool's result for a genuine artifact (URL,
  // transaction id, message id, file path, or an explicit "REAL" marker) -- orchestrator.ts now
  // persists that onto each step instead of discarding it after the UI badge, and this function uses
  // it as the one case that can honestly earn 'LIVE_VERIFIED' instead of always downgrading to
  // 'LIVE_EXECUTED'.
  test('a known action-tool call that succeeded AND produced a confirmed artifact earns the stronger LIVE_VERIFIED label', () => {
    const answer = '## Deployment fixed\n\nThe last build failed because the DATABASE_URL environment variable was missing on the production environment. I took the following actions: added the missing variable in Vercel, then triggered a fresh deployment. The new deployment completed successfully and is now serving traffic. No further action is needed.'
    const result = tryOperationalDirectResponse({
      messages: user(message),
      preRoute,
      objective: message,
      candidateContent: answer,
      responseMsBeforeCheck: 4300,
      toolSteps: [{ toolName: 'send_email', toolResult: { ok: true }, verification: { verified: true } }],
    })
    expect(result).not.toBeNull()
    expect(result!.evidenceState).toBe('LIVE_VERIFIED')
    expect(result!.quality.evidenceState).toBe('LIVE_VERIFIED')
  })

  test('a known action-tool call that succeeded but produced NO confirmed artifact still downgrades to LIVE_EXECUTED (a bare ok:true is not enough)', () => {
    const answer = '## Deployment fixed\n\nThe last build failed because the DATABASE_URL environment variable was missing on the production environment. I took the following actions: added the missing variable in Vercel, then triggered a fresh deployment. The new deployment completed successfully and is now serving traffic. No further action is needed.'
    const result = tryOperationalDirectResponse({
      messages: user(message),
      preRoute,
      objective: message,
      candidateContent: answer,
      responseMsBeforeCheck: 4300,
      toolSteps: [{ toolName: 'send_email', toolResult: { ok: true }, verification: { verified: false } }],
    })
    expect(result).not.toBeNull()
    expect(result!.evidenceState).toBe('LIVE_EXECUTED')
  })

  // A tool this module cannot verify at all (not in isKnownActionTool's list, e.g. an internal-state
  // read) must never accidentally unlock LIVE_VERIFIED just because it happened to be present.
  test('a tool step for an unverifiable (non-action) tool does not unlock LIVE_VERIFIED even if marked verified', () => {
    const answer = '## Deployment fixed\n\nThe last build failed because the DATABASE_URL environment variable was missing on the production environment. I took the following actions: added the missing variable in Vercel, then triggered a fresh deployment. The new deployment completed successfully and is now serving traffic. No further action is needed.'
    const result = tryOperationalDirectResponse({
      messages: user(message),
      preRoute,
      objective: message,
      candidateContent: answer,
      responseMsBeforeCheck: 4300,
      toolSteps: [{ toolName: 'smart_tool_router', toolResult: { ok: true }, verification: { verified: true } }],
    })
    expect(result).not.toBeNull()
    expect(result!.evidenceState).toBe('LIVE_EXECUTED')
  })

  // Phase 2 fix (external audit, 2026-09-19), issue 4: hasVerifiedActionEvidence used to be a bare
  // `.some()` over toolSteps -- one confirmed action-tool call was enough to earn LIVE_VERIFIED for the
  // whole turn, even when a SIBLING action-tool call in the same multi-step objective succeeded without
  // ever being independently confirmed. Two action-tool steps below: the first genuinely verified, the
  // second merely `ok: true` with no confirmed artifact -- the turn must still downgrade to
  // LIVE_EXECUTED, because not every action this turn took was actually confirmed.
  test('a multi-step objective with one verified action-tool call and one merely-successful one does not earn LIVE_VERIFIED (issue 4)', () => {
    const answer = '## Done\n\nI published the WordPress post and sent the team notification email. The deployment fix, the DATABASE_URL variable, and the fresh deployment are all in place and serving traffic.'
    const result = tryOperationalDirectResponse({
      messages: user(message),
      preRoute,
      objective: message,
      candidateContent: answer,
      responseMsBeforeCheck: 4300,
      toolSteps: [
        { toolName: 'wordpress_publisher', toolResult: { ok: true }, verification: { verified: true } },
        { toolName: 'send_email', toolResult: { ok: true }, verification: { verified: false } },
      ],
    })
    expect(result).not.toBeNull()
    expect(result!.evidenceState).toBe('LIVE_EXECUTED')
    expect(result!.evidenceState).not.toBe('LIVE_VERIFIED')
  })

  test('a multi-step objective where every action-tool call is verified DOES earn LIVE_VERIFIED (issue 4, positive case)', () => {
    const answer = '## Done\n\nI published the WordPress post and sent the team notification email. The deployment fix, the DATABASE_URL variable, and the fresh deployment are all in place and serving traffic.'
    const result = tryOperationalDirectResponse({
      messages: user(message),
      preRoute,
      objective: message,
      candidateContent: answer,
      responseMsBeforeCheck: 4300,
      toolSteps: [
        { toolName: 'wordpress_publisher', toolResult: { ok: true }, verification: { verified: true } },
        { toolName: 'send_email', toolResult: { ok: true }, verification: { verified: true } },
      ],
    })
    expect(result).not.toBeNull()
    expect(result!.evidenceState).toBe('LIVE_VERIFIED')
  })

  // Phase 2 fix (external audit, 2026-09-19), issue 5: a read/research tool (web_search) is not an
  // outcome-producing action -- even a "verified" web_search result must never unlock LIVE_VERIFIED on
  // its own, since nothing in the world actually changed.
  test('a verified web_search step alone does not earn LIVE_VERIFIED (issue 5: research tools are not action outcomes)', () => {
    const answer = '## Deployment fixed\n\nThe last build failed because the DATABASE_URL environment variable was missing on the production environment. I took the following actions: added the missing variable in Vercel, then triggered a fresh deployment. The new deployment completed successfully and is now serving traffic. No further action is needed.'
    const result = tryOperationalDirectResponse({
      messages: user(message),
      preRoute,
      objective: message,
      candidateContent: answer,
      responseMsBeforeCheck: 4300,
      toolSteps: [{ toolName: 'web_search', toolResult: { ok: true }, verification: { verified: true } }],
    })
    expect(result).not.toBeNull()
    expect(result!.evidenceState).toBe('LIVE_EXECUTED')
  })

  // Phase 2 fix (external audit, 2026-09-19), issues 1 and 8: route.ts now builds exactly one
  // CeoTurnDecision per turn and threads its decisionPlan through here instead of letting this function
  // build a second, independent copy -- verify the caller's decisionPlan is actually used (identity
  // check), not silently discarded in favor of a freshly-built one.
  test('a caller-supplied decisionPlan is reused verbatim instead of being rebuilt (issues 1 and 8: single DECIDE authority)', () => {
    const suppliedDecisionPlan = buildCeoDecisionPlan({ messages: user(message), preRoute })
    const answer = 'Hi! How can I help you today?'
    const result = tryOperationalDirectResponse({
      messages: user(message),
      preRoute,
      decisionPlan: suppliedDecisionPlan,
      objective: message,
      candidateContent: answer,
      responseMsBeforeCheck: 900,
      toolSteps: noToolSteps,
    })
    // This particular answer fails the gate (returns null, per the existing "does not address the
    // actual request" test above) -- so assert identity via a PASSing call instead.
    expect(result).toBeNull()
    const passingAnswer = '## Deployment fixed\n\nThe last build failed because the DATABASE_URL environment variable was missing on the production environment. I took the following actions: added the missing variable in Vercel, then triggered a fresh deployment. The new deployment completed successfully and is now serving traffic. No further action is needed.'
    const passingResult = tryOperationalDirectResponse({
      messages: user(message),
      preRoute,
      decisionPlan: suppliedDecisionPlan,
      objective: message,
      candidateContent: passingAnswer,
      responseMsBeforeCheck: 4300,
      toolSteps: noToolSteps,
    })
    expect(passingResult).not.toBeNull()
    expect(passingResult!.decisionPlan).toBe(suppliedDecisionPlan)
    expect(passingResult!.decisionPlan.requestId).toBe(suppliedDecisionPlan.requestId)
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
