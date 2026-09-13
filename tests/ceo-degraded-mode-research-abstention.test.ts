import { describe, expect, test } from 'bun:test'
import { buildCeoDegradedResponse, requiresDecisionGradeAbstention } from '@/lib/ceo-degraded-mode'
import { preRouteCeoRequest } from '@/lib/ceo-pre-router'

// Live production bug: "can you check all news and relevant information abour 2 stocks: a. GEOS and
// b. MIND Tecnologies" (a pure research request, no buy/sell/hold/recommend/invest language at all) hit
// the hard, no-recourse "I can't give you a responsible decision-grade answer yet..." abstention whenever
// evidence acquisition came back insufficient/unavailable -- identically to how an actual "should I buy
// GEOS?" request would. Root cause: requiresDecisionGradeAbstention called riskClassForDomain(domain) with
// no operation argument, and riskClassForDomain('public_equity', ...) is unconditionally 'HIGH' regardless
// of operation (public_equity sits in CRITICAL_HIGH_RISK_DOMAINS, checked before the operation-aware
// fallback). This is the same domain-only-risk bug already fixed in ceo-decision-grade-evidence.ts and
// ceo-claim-evidence-gate.ts, in a third, independent location (the degraded-mode fallback, which runs on
// ANY primary-generation failure, not just the evidence-gate path those two fixes cover).

describe('P0 regression: research-operation public-equity turns do not hard-abstain on evidence failure', () => {
  test('the pre-router classifies the exact reported message as public_equity/research (not recommend/decide)', () => {
    const objective = 'mmmm can you check all news and relevant information abour 2 stocks: a. GEOS and b. MIND Tecnologies'
    const decision = preRouteCeoRequest([{ role: 'user', content: objective }])
    expect(decision.executionContract.domain).toBe('public_equity')
    expect(decision.executionContract.operation).toBe('research')
  })


  test('requiresDecisionGradeAbstention: a research operation with insufficient evidence does not require abstention', () => {
    expect(requiresDecisionGradeAbstention({ objective: 'check all news and relevant information about GEOS and MIND Technologies', failureReason: 'evidence_insufficient', domain: 'public_equity', operation: 'research' })).toBe(false)
  })

  test('requiresDecisionGradeAbstention: a recommend operation with insufficient evidence still requires abstention', () => {
    expect(requiresDecisionGradeAbstention({ objective: 'should I buy GEOS or MIND?', failureReason: 'evidence_insufficient', domain: 'public_equity', operation: 'recommend' })).toBe(true)
  })

  test('requiresDecisionGradeAbstention: a decide operation with insufficient evidence still requires abstention', () => {
    expect(requiresDecisionGradeAbstention({ objective: 'decide whether to buy GEOS', failureReason: 'evidence_insufficient', domain: 'public_equity', operation: 'decide' })).toBe(true)
  })

  test('requiresDecisionGradeAbstention: an unspecified operation keeps the original conservative default (still abstains)', () => {
    expect(requiresDecisionGradeAbstention({ objective: 'tell me about GEOS', failureReason: 'evidence_insufficient', domain: 'public_equity' })).toBe(true)
  })

  test('requiresDecisionGradeAbstention: a non-evidence failure reason never triggers abstention, research or not', () => {
    expect(requiresDecisionGradeAbstention({ objective: 'check news about GEOS', failureReason: 'quality_failure', domain: 'public_equity', operation: 'recommend' })).toBe(false)
  })

  test('requiresDecisionGradeAbstention: other CRITICAL_HIGH_RISK_DOMAINS keep unconditional hard-abstention regardless of operation', () => {
    expect(requiresDecisionGradeAbstention({ objective: 'check the latest regulatory filing status', failureReason: 'evidence_insufficient', domain: 'regulatory', operation: 'research' })).toBe(true)
    expect(requiresDecisionGradeAbstention({ objective: 'check our security posture', failureReason: 'evidence_insufficient', domain: 'security', operation: 'research' })).toBe(true)
  })

  test('buildCeoDegradedResponse: the exact reported production message, research operation, does not produce the hard abstention', async () => {
    const objective = 'mmmm can you check all news and relevant information abour 2 stocks: a. GEOS and b. MIND Tecnologies'
    const degraded = await buildCeoDegradedResponse({
      objective,
      intent: 'research',
      responseAction: 'answer',
      reason: 'External evidence acquisition returned insufficient sources (simulated).',
      failureReason: 'evidence_insufficient',
      domain: 'public_equity',
      operation: 'research',
      recall: async () => [],
    })
    expect(degraded.content).not.toContain('responsible decision-grade answer')
    expect(degraded.content).not.toContain("I won't substitute memory, stale information, or an unverified execution result")
  })

  test('buildCeoDegradedResponse: the same failure with a recommend operation still produces the hard abstention', async () => {
    const degraded = await buildCeoDegradedResponse({
      objective: 'should I buy GEOS or MIND Technology stock?',
      intent: 'decision',
      responseAction: 'recommend',
      reason: 'External evidence acquisition returned insufficient sources (simulated).',
      failureReason: 'evidence_insufficient',
      domain: 'public_equity',
      operation: 'recommend',
      recall: async () => [],
    })
    expect(degraded.content).toContain('responsible decision-grade answer')
    expect(degraded.evidenceState).toBe('UNAVAILABLE')
  })

  test('buildCeoDegradedResponse: omitting operation entirely preserves the pre-fix behavior (still abstains)', async () => {
    const degraded = await buildCeoDegradedResponse({
      objective: 'tell me about GEOS stock',
      intent: 'research',
      responseAction: 'answer',
      reason: 'External evidence acquisition returned insufficient sources (simulated).',
      failureReason: 'evidence_insufficient',
      domain: 'public_equity',
      recall: async () => [],
    })
    expect(degraded.content).toContain('responsible decision-grade answer')
  })
})
