import { describe, expect, test } from 'bun:test'
import { evaluateCeoQuality } from '@/lib/ceo-response-quality-gate'

const objective = 'Decide the best mission strategy for Agent007 and explain the evidence, risks, and next actions.'
const baseAnswer = '# Recommendation\n\nDecision: proceed only after independent review and explicit verification of the deployment evidence. The recommended action is to advance the mission only when the evidence package is complete, the identified risks are understood, and the execution conditions are satisfied.\n\n## Evidence\n- Confirm the deployment identity and verify the exact release evidence before execution.\n- Confirm the independent review result and reconcile any material disagreement.\n- Preserve the supporting mission evidence so the decision remains auditable.\n\n## Risks\n- Deployment without complete evidence could create an irreversible production error.\n- Conflicting verification results require escalation rather than silent selection.\n- Missing current evidence means the system must not claim live confirmation.\n\n## Next Actions\n1. Complete the independent verification checkpoint.\n2. Record the final evidence and decision state.\n3. Proceed only when all mandatory gates are satisfied.'

function evaluate(content: string, externalAgencyAvailable?: boolean) {
  return evaluateCeoQuality({ objective, content, path: 'critical', intent: 'analysis', responseAction: 'explain', evidenceVerificationApplicable: false, reviewed: true, externalAgencyAvailable })
}

describe('Recommendation 1: post-generation false-completion-claim detector', () => {
  test('the unmodified baseline answer (no completion claim) passes, confirming the detector adds no false positive on ordinary content', () => {
    const result = evaluate(baseAnswer)
    expect(result.decision).toBe('PASS')
  })

  test('a first-person present-perfect claim of having already performed a real-world action fails the gate when no external agency actually executed anything', () => {
    const content = `${baseAnswer}\n\nI have already deployed this recommendation to production.`
    const result = evaluate(content)
    expect(result.decision).not.toBe('PASS')
    expect(result.reasons.join(' ')).toContain('claims a real-world action was performed')
  })

  test('the same completion claim passes when externalAgencyAvailable is true, i.e. this is the operational-orchestrator synthesis pass reporting a real execution result', () => {
    const content = `${baseAnswer}\n\nI have already deployed this recommendation to production.`
    const result = evaluate(content, true)
    expect(result.decision).toBe('PASS')
  })

  test('a conditional/future-gated completion claim ("once you approve, I have deployed...") is not treated as a false completion claim, since it describes what becomes true after a condition is met rather than asserting the action already happened', () => {
    const content = `${baseAnswer}\n\nOnce you approve, I have already deployed this recommendation to a staging environment for your review.`
    const result = evaluate(content)
    expect(result.decision).toBe('PASS')
  })

  test('a hedged claim that explicitly says the action has not happened yet is not penalized as a false completion claim', () => {
    const content = `${baseAnswer}\n\nI have not deployed this yet; it requires your explicit sign-off first.`
    const result = evaluate(content)
    expect(result.decision).toBe('PASS')
  })

  test('third-person historical narration about a real-world action is ordinary fact-reporting and is not flagged', () => {
    const content = `${baseAnswer}\n\nThe last major deployment was launched by the platform team earlier this quarter.`
    const result = evaluate(content)
    expect(result.decision).toBe('PASS')
  })
})
