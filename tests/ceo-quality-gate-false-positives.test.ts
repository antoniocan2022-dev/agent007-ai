import { describe, expect, test } from 'bun:test'
import { evaluateCeoQuality } from '@/lib/ceo-response-quality-gate'
import { isGovernedSoftPassEligible } from '@/lib/ceo-soft-pass-policy'

describe('P2 quality-gate false positives found via real CI failures', () => {
  test('a short, natural, appropriate greeting reply is not penalized for brevity, including one that ends with a genuine follow-up question', () => {
    const result = evaluateCeoQuality({ objective: 'hi, how do you do?', content: 'Hi! I\u2019m doing well. How are you?', path: 'fast', intent: 'conversation', evidenceVerificationApplicable: false })
    expect(result.decision).toBe('PASS')
  })

  test('a well-structured decision response using a "Decision:" header does not fail specifically for not satisfying the decide action -- confirmed against the exact real CI failure scenario', () => {
    const content = 'Decision: proceed only after independent review and explicit verification of the deployment evidence. The recommended action is to advance the mission only when the evidence package is complete, the identified risks are understood, and the execution conditions are satisfied. Evidence: confirm deployment identity and reconcile the independent review result. Risks: deployment without complete evidence could create an irreversible error. Next actions: complete verification, record the decision, proceed only when gates are satisfied.'
    const result = evaluateCeoQuality({ objective: 'Decide the best mission strategy for Agent007 and explain the evidence, risks, and next actions.', content, path: 'fast', intent: 'decision', responseAction: 'decide', evidenceVerificationApplicable: false })
    expect(result.reasons.join(' ')).not.toContain('did not satisfy the requested response action')
  })

  test('a genuine explanation of risks is not rejected for using ordinary conditional language like "could" -- the exact real CI failure scenario, where a substantive mission-strategy explanation legitimately describing a risk ("could create an irreversible production error") was being blocked as if it were hedging about whether the analysis itself happened', () => {
    const criticalAnswer = '# Recommendation\n\nDecision: proceed only after independent review and explicit verification of the deployment evidence. The recommended action is to advance the mission only when the evidence package is complete, the identified risks are understood, and the execution conditions are satisfied.\n\n## Evidence\n- Confirm the deployment identity and verify the exact release evidence before execution.\n- Confirm the independent review result and reconcile any material disagreement.\n- Preserve the supporting mission evidence so the decision remains auditable.\n\n## Risks\n- Deployment without complete evidence could create an irreversible production error.\n- Conflicting verification results require escalation rather than silent selection.\n- Missing current evidence means the system must not claim live confirmation.\n\n## Next Actions\n1. Complete the independent verification checkpoint.\n2. Record the final evidence and decision state.\n3. Proceed only when all mandatory gates are satisfied.'
    const result = evaluateCeoQuality({ objective: 'Decide the best mission strategy for Agent007 and explain the evidence, risks, and next actions.', content: criticalAnswer, path: 'critical', intent: 'analysis', responseAction: 'explain', evidenceVerificationApplicable: false, reviewed: true })
    expect(result.decision).toBe('PASS')
  })

  test('an ESCALATE-only "analysis" or "decision" response gets a real conversationQuality score, so ceo-soft-pass-policy\'s stated eligibility for these intents (ceo-soft-pass-policy.ts ALLOWED_INTENTS) is actually reachable instead of permanently blocked by an undefined score -- confirmed against the real live-production scenario ("Analyze the psychological patterns...") where escalation never got a chance to soft-pass a substantive answer', () => {
    const objective = 'Analyze the psychological patterns affecting my business decisions.'
    const content = 'Looking at your business decisions, there is a clear psychological pattern: you pull back sharply right after a setback, then swing into oversized bets once your confidence returns, because short-term stress pushes you toward whichever extreme feels safest in the moment. That back-and-forth between caution and overreach tends to produce choices that chase the last outcome instead of the underlying opportunity in front of you.'
    const result = evaluateCeoQuality({ objective, content, path: 'full', intent: 'analysis', responseAction: 'explain', evidenceVerificationApplicable: false })
    expect(result.decision).toBe('ESCALATE')
    expect(result.conversationQuality).toBeDefined()
    expect(result.conversationQuality!.score).toBeGreaterThanOrEqual(75)
    expect(isGovernedSoftPassEligible({ intent: 'analysis', authoritativeIntent: 'analysis', qualityDecision: 'ESCALATE', failureReason: result.failureReason, conversationScore: result.conversationQuality!.score, substantive: true })).toBe(true)

    const decisionResult = evaluateCeoQuality({ objective: 'Should I raise prices or cut costs first?', content: 'Raise prices first: it protects the customers you already trust more than a cost cut would, and it buys you time to fix costs without damaging the product experience while you are doing it.', path: 'full', intent: 'decision', responseAction: 'recommend', evidenceVerificationApplicable: false })
    expect(decisionResult.conversationQuality).toBeDefined()
  })
})
