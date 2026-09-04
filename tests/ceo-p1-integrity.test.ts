import { describe, expect, test } from 'bun:test'
import { deriveCeoConversationState, resolveConversationReferences } from '@/lib/ceo-conversation-state'
import { buildCanonicalConversationContext } from '@/lib/ceo-cognitive-conversation'
import { buildConversationDecisionContract } from '@/lib/ceo-conversation-decision-contract'
import { preRouteCeoRequest } from '@/lib/ceo-pre-router'
import { buildCeoDecisionPlan } from '@/lib/ceo-cognitive-kernel'
import { buildRecommendationRecord, calculateRecommendationPredictionError } from '@/lib/ceo-outcome-learning'
import { buildCeoRuntimeMetrics } from '@/lib/ceo-runtime-metrics'

describe('CEO P1 integrity', () => {
  test('self assessment is first-class in the canonical semantic and decision contracts', () => {
    const message = 'Give me a self-assessment of Agent007 readiness and limitations.'
    const rows = [{ role: 'user' as const, content: message, createdAt: 1 }]
    const state = deriveCeoConversationState(rows, message)
    const references = resolveConversationReferences(message, rows, state)
    const context = buildCanonicalConversationContext({ currentMessage: message, rows, state, references })
    const contract = buildConversationDecisionContract(context)
    expect(context.intentHint).toBe('self_assessment')
    expect(contract.intent).toBe('self_assessment')
    expect(contract.responseAction).toBe('answer')
    expect(contract.toolRequirement).toBe('none')
    expect(contract.evidenceRequirement).toBe('none')
    const route = preRouteCeoRequest([{ role: 'user', content: message }], 0, context)
    const plan = buildCeoDecisionPlan({ messages: [{ role: 'user', content: message }], preRoute: route })
    expect(plan.executionContract.intent).toBe('self_assessment')
    expect(plan.preRoute).toBe('fast')
  })

  test('eligible recommendations reject meaningless predictions but support explicit non-applicable cases', () => {
    const missing = buildRecommendationRecord({ correlationId: 'p1-missing', objective: 'Choose the safest next step', responseAction: 'recommend', predictedOutcome: 'It depends.' })
    expect(missing.predictionEligibility).toBe('ELIGIBLE')
    expect(missing.predictionStatus).toBe('NOT_CAPTURED')
    expect(missing.predictedOutcome).toBeNull()

    const notApplicable = buildRecommendationRecord({ correlationId: 'p1-na', objective: 'Answer the user conversationally', responseAction: 'answer', predictionEligibility: 'NOT_APPLICABLE' })
    expect(notApplicable.predictionStatus).toBe('NOT_APPLICABLE')
    expect(calculateRecommendationPredictionError(notApplicable, null)).toBeNull()
  })

  test('response-path observability records pre-route, cognitive path, ownership, intent and generation stage', () => {
    const messages = [{ role: 'user' as const, content: 'Tell me what you think about our direction.' }]
    const route = preRouteCeoRequest(messages)
    const plan = buildCeoDecisionPlan({ messages, preRoute: route })
    const result = { content: 'A substantive answer.', provider: 'test', model: 'test-model', responseMs: 42, attempts: ['test'], executionPlan: { requestId: 'x', path: plan.path, reasoningStrategy: plan.reasoningStrategy, stages: [] }, decisionPlan: plan, quality: { decision: 'PASS' as const, evidenceState: 'NOT_APPLICABLE' as const, verificationStatus: 'NOT_REQUIRED' as const, checks: { nonEmpty: true, contractValid: true, objectiveCoverage: true, internalConsistency: true, evidenceDiscipline: true, actionableStructure: true }, reasons: [] }, evidenceState: 'NOT_APPLICABLE' as const, degraded: false }
    const metrics = buildCeoRuntimeMetrics({ result, decisionContract: buildConversationDecisionContract(buildCanonicalConversationContext({ currentMessage: messages[0].content, rows: messages, state: deriveCeoConversationState(messages, messages[0].content), references: [] })) })
    expect(metrics.responsePath.preRoute).toBe(route.route)
    expect(metrics.responsePath.cognitivePath).toBe(plan.path)
    expect(metrics.responsePath.orchestrationOwner).toBe(plan.executionContract.orchestrationOwner)
    expect(metrics.responsePath.intent).toBe(plan.executionContract.intent)
    expect(metrics.generation.primaryOutputProduced).toBe(true)
    expect(metrics.generation.finalStage).toBe('primary')
  })

  test('P1 benchmark covers the existing 25-case conversation corpus without routing contract regressions', async () => {
    const { CEO_CONVERSATION_BENCHMARK_CASES } = await import('./fixtures/ceo-conversation-benchmark-cases')
    expect(CEO_CONVERSATION_BENCHMARK_CASES).toHaveLength(25)
    for (const testCase of CEO_CONVERSATION_BENCHMARK_CASES) {
      const state = deriveCeoConversationState(testCase.rows, testCase.message)
      const references = resolveConversationReferences(testCase.message, testCase.rows, state)
      const context = buildCanonicalConversationContext({ currentMessage: testCase.message, rows: testCase.rows, state, references })
      const contract = buildConversationDecisionContract(context)
      const route = preRouteCeoRequest([{ role: 'user', content: testCase.message }], 0, context)
      const plan = buildCeoDecisionPlan({ messages: [{ role: 'user', content: testCase.message }], preRoute: route })
      expect(contract.intent).toBe(context.intentHint)
      expect(plan.executionContract.intent).toBe(route.executionContract.intent)
      expect(['fast', 'full', 'ambiguous']).toContain(route.route)
    }
  })
})
