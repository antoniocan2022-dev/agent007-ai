import { describe, expect, test } from 'bun:test'
import { composeCeoContext } from '../src/lib/ceo-context-composer'
import { evaluateClaimConsistency, scoreContextContinuity } from '../src/lib/ceo-context-intelligence'
import { createCeoFailure, inferCeoFailureReason } from '../src/lib/ceo-failure-reason'
import { evaluateCeoQuality } from '../src/lib/ceo-response-quality-gate'
import { RecoveryBudget } from '../src/lib/ceo-recovery-policy'

const row = (role: 'user' | 'assistant', content: string, createdAt: number): { role: string; content: string; createdAt: number } => ({ role, content, createdAt })

describe('CEO P1/P2 context and failure architecture', () => {
  test('composes conditional modules without turning prior conversation into evidence', () => {
    const result = composeCeoContext({
      systemPrompt: 'CEO',
      currentUserMessage: 'What about the same GEOS plan?',
      persistedMessages: [
        row('user', 'We discussed GEOS as a public company.', 1),
        row('assistant', 'GEOS was attractive in my earlier analysis.', 2),
        row('user', 'What about the same GEOS plan?', 3),
      ],
      modules: { mission: 'Mission M-01' },
    })
    expect(result.modules).toContain('conversation')
    expect(result.modules).toContain('mission')
    expect(result.messages.at(-1)?.role).toBe('user')
    expect(result.messages.some((message) => message.content.includes('previous assistant claims are not factual proof'))).toBe(true)
  })

  test('claim-level consistency catches opposing claims on the same topic', () => {
    const result = evaluateClaimConsistency('GEOS is available for purchase. GEOS is not available for purchase.')
    expect(result.consistent).toBe(false)
    expect(result.contradictions.length).toBeGreaterThan(0)

    const quality = evaluateCeoQuality({
      objective: 'Explain whether GEOS is available.',
      content: 'GEOS is available for purchase. GEOS is not available for purchase.',
      path: 'fast',
      externalExecutionSucceeded: true,
      evidenceVerificationApplicable: false,
    })
    expect(quality.checks.internalConsistency).toBe(false)
    expect(quality.failureReason).toBe('claim_consistency_failure')
  })

  test('continuity scoring recognizes relevant prior-turn usage and anaphora', () => {
    const result = scoreContextContinuity({
      currentUserMessage: 'Would you buy it based on that analysis?',
      response: 'Based on the earlier GEOS analysis, I would not buy it yet because the thesis still depends on verified evidence.',
      priorTurns: [row('user', 'Analyze GEOS as an investment.', 1), row('assistant', 'The investment thesis depends on verified evidence.', 2)],
      relevantOlderMessages: [row('user', 'GEOS is the company we are discussing.', 0)],
    })
    expect(result.anaphoraDetected).toBe(true)
    expect(result.understood).toBe(true)
    expect(result.score).toBeGreaterThanOrEqual(60)
  })

  test('P2 rejects cross-objective stale substitution at the canonical quality gate', () => {
    const quality = evaluateCeoQuality({
      objective: 'What psychological patterns are affecting my decisions?',
      content: 'You should prioritize the operating foundation before adding complexity. That remains the best business direction.',
      path: 'full',
      intent: 'analysis',
      priorTurns: [row('user', 'What should we prioritize next for the business?', 1), row('assistant', 'Prioritize the operating foundation before adding complexity.', 2)],
      externalExecutionSucceeded: true,
    })
    expect(quality.decision).not.toBe('PASS')
    expect(quality.reasons.some((reason) => /prior objective|current objective|stale-response/i.test(reason))).toBe(true)
  })

  test('P2 preserves valid reference continuation and explicit challenge action', () => {
    const continuation = evaluateCeoQuality({
      objective: 'What about the second option?',
      content: 'The second option is stronger because it reduces integration risk while preserving the measurable benefit we discussed.',
      path: 'full',
      intent: 'conversation',
      priorTurns: [row('user', 'Give me three possible improvements to the CEO conversation system.', 1), row('assistant', '1. Improve references. 2. Strengthen the quality gate. 3. Add more observability.', 2)],
      resolvedReferences: [{ phrase: 'the second option', targetIndex: 1, resolvedText: 'Strengthen the quality gate', ambiguous: false, confidence: 0.96, evidence: 'ordered_list' }],
      externalExecutionSucceeded: true,
    })
    expect(continuation.decision).toBe('PASS')
    const challenge = evaluateCeoQuality({
      objective: 'Challenge my assumption that we need more tools before fixing the architecture.',
      content: 'I disagree with that assumption because adding tools before fixing the canonical architecture increases integration debt and makes governance harder.',
      path: 'full',
      intent: 'opinion',
      responseAction: 'challenge',
      externalExecutionSucceeded: true,
    })
    expect(challenge.decision).toBe('PASS')
  })

  test('P2 blocks internal execution artifacts before user-facing output', () => {
    const quality = evaluateCeoQuality({
      objective: 'Explain the current architecture.',
      content: 'The architecture is structured around a canonical lifecycle. [continuous_loop_trace] internal state leaked here.',
      path: 'full',
      intent: 'analysis',
      externalExecutionSucceeded: true,
    })
    expect(quality.decision).not.toBe('PASS')
    expect(quality.reasons.some((reason) => /internal execution artifacts/i.test(reason))).toBe(true)
  })

  test('failure taxonomy is stable and retry semantics are canonical', () => {
    expect(inferCeoFailureReason(new Error('Provider unavailable'))).toBe('provider_unavailable')
    expect(inferCeoFailureReason(new Error('AGENT_REQUEST_TIMEOUT'))).toBe('execution_timeout')
    expect(inferCeoFailureReason(new Error('recovery budget exhausted'))).toBe('recovery_budget_exhausted')
    const failure = createCeoFailure({ reason: 'provider_error', message: 'provider failed', capability: 'reasoning' })
    expect(failure.retryable).toBe(true)
    expect(createCeoFailure({ reason: 'recovery_budget_exhausted', message: 'budget exhausted' }).retryable).toBe(false)
  })

  test('recovery budget exposes one shared failure reason for exhausted recovery', () => {
    const contract = {
      intent: 'tool_action' as const,
      evidenceClass: 'none' as const,
      domain: 'none' as const,
      operation: 'none' as const,
      temporalScope: 'none' as const,
      evidenceProfile: 'none' as const,
      evidenceRequirement: 'none' as const,
      executionRequirement: 'one_tool' as const,
      orchestrationOwner: 'operational_orchestrator' as const,
      maxTurns: 2,
      maxRecoveries: 1,
      latencyBudgetMs: 1000,
      toolRequired: true,
      subagentsRequired: false,
      reason: 'test',
    }
    const budget = new RecoveryBudget(contract)
    expect(budget.consume('tool_failure').failureReason).toBe('tool_error')
    expect(budget.consume('tool_failure').failureReason).toBe('recovery_budget_exhausted')
  })
})
