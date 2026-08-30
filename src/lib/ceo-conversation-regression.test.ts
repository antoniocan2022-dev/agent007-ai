import { describe, expect, test } from 'bun:test'
import { preRouteCeoRequest } from './ceo-pre-router'
import { classifyCeoSelfReflection } from './ceo-self-reflection'
import { evaluateCeoQuality } from './ceo-response-quality-gate'

describe('CEO conversational safety path', () => {
  const greetings = ['hi', 'hello', 'hey', 'hi, how do you do?', 'how do you do?', 'how are you?', 'thanks', 'ok']

  test.each(greetings)('%s is not forced into an evidence-backed self-assessment', (text) => {
    const reflection = classifyCeoSelfReflection(text)
    const route = preRouteCeoRequest([{ role: 'user', content: text }])

    expect(['none', 'casual_checkin']).toContain(reflection.kind)
    expect(reflection.isSelfReflective).toBe(false)
    expect(route.executionContract.intent).toBe('conversation')
    expect(route.executionContract.evidenceClass).toBe('none')
    expect(route.executionContract.evidenceRequirement).toBe('none')
    expect(route.executionContract.toolRequired).toBe(false)
  })

  test('a normal conversational answer passes without evidence or long-form structure', () => {
    const result = evaluateCeoQuality({
      objective: 'hi, how do you do?',
      content: "Hi! I'm doing well and ready to help. How are you?",
      path: 'full',
      intent: 'conversation',
      evidenceVerificationApplicable: false,
      externalExecutionSucceeded: true,
    })

    expect(result.decision).toBe('PASS')
    expect(result.evidenceState).toBe('NOT_APPLICABLE')
    expect(result.verificationStatus).toBe('NOT_REQUIRED')
    expect(result.failureReason).toBeUndefined()
  })

  test('genuine CEO performance reflection remains evidence-governed', () => {
    const reflection = classifyCeoSelfReflection('How are you performing against your goals?')
    const route = preRouteCeoRequest([{ role: 'user', content: 'How are you performing against your goals?' }])

    expect(reflection.isSelfReflective).toBe(true)
    expect(reflection.kind).toBe('performance_reflection')
    expect(route.executionContract.intent).toBe('self_assessment')
    expect(route.executionContract.evidenceRequirement).toBe('internal_state')
  })
})
