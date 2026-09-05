import { describe, expect, test } from 'bun:test'
import { evaluateCeoQuality } from '@/lib/ceo-response-quality-gate'

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
})
