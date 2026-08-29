import { describe, expect, test } from 'bun:test'
import { classifyCeoSelfReflection } from '@/lib/ceo-self-reflection'
import { classifyExecution } from '@/lib/adaptive-execution'
import { preRouteCeoRequest } from '@/lib/ceo-pre-router'

const user = (content: string) => [{ role: 'user' as const, content }]

describe('CEO self-reflection canonical classifier', () => {
  test.each([
    ['How are you doing?', 'casual_checkin'],
    ["How's it going?", 'casual_checkin'],
    ['You good?', 'casual_checkin'],
    ["What's new with you?", 'casual_checkin'],
    ['Are you improving?', 'performance_reflection'],
    ['How are you performing?', 'performance_reflection'],
    ['What are your weaknesses?', 'capability_assessment'],
    ['What are your strengths?', 'capability_assessment'],
    ['How capable are you?', 'capability_assessment'],
    ['Are you ready to manage a business?', 'readiness_assessment'],
    ['Are you prepared to run a company?', 'readiness_assessment'],
    ['Hows it going? make a sekf analysis and tell me if you are ready to mange businesses?', 'readiness_assessment'],
  ] as const)('classifies %j as %s', (text, expected) => {
    const result = classifyCeoSelfReflection(text)
    expect(result.isSelfReflective).toBe(true)
    expect(result.kind).toBe(expected)
  })

  test.each([
    'Deploy the approved release to production.',
    'Research Agent007 competitors.',
    'Send the customer the invoice.',
    'Create a new venture.',
    'Manage this business for me.',
    'Can you analyze this architecture?',
  ])('does not steal operational or analytical request: %s', (text) => {
    expect(classifyCeoSelfReflection(text).isSelfReflective).toBe(false)
  })

  test('keeps casual self-reflection on the bounded fast execution class', () => {
    const plan = classifyExecution(user('How are you doing?'))
    expect(plan.executionClass).toBe('fast')
    expect(plan.maxProviderAttempts).toBe(4)
    expect(plan.timeoutMs).toBe(30000)
    expect(plan.parallelizable).toBe(false)
  })

  test('pre-router emits the canonical self-assessment contract', () => {
    const decision = preRouteCeoRequest(user('How are you doing?'))
    expect(decision.executionContract.intent).toBe('self_assessment')
    expect(decision.executionContract.executionRequirement).toBe('llm_only')
    expect(decision.executionContract.orchestrationOwner).toBe('ceo_lifecycle')
    expect(decision.executionContract.latencyBudgetMs).toBe(30000)
    expect(decision.route).toBe('fast')
  })

  test('self-analysis wording cannot trigger the legacy deep adaptive class', () => {
    const plan = classifyExecution(user('Make a self-analysis and tell me if you are ready to manage businesses.'))
    expect(plan.executionClass).toBe('fast')
    expect(plan.timeoutMs).toBe(30000)
  })
})
