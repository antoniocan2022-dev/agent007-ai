import { describe, expect, test } from 'bun:test'
import { assertLoopTransition, getLoopTransition } from '@/lib/architecture-integrity-contract'
import { buildRecommendationRecord, buildObservedRecommendationOutcome, calculateRecommendationPredictionError, correlateRecommendationOutcomes } from '@/lib/ceo-outcome-learning'
import { approveLearningCandidate, buildLearningCandidate, promoteLearningCandidate, validateLearningCandidate } from '@/lib/ceo-behavioral-learning'
import { advanceContinuousLoop, buildContinuousLoopTrace, completeContinuousLoop } from '@/lib/ceo-continuous-loop'

const fixedTime = '2026-09-03T22:00:00.000Z'

describe('Continuous loop integrity — phases 5-8', () => {
  test('recommendation contract contains rationale, prediction and action', () => {
    const recommendation = buildRecommendationRecord({ correlationId: 'rec-1', objective: 'Improve revenue', responseAction: 'recommend', decisionRationale: 'Prioritize the bottleneck with the clearest measurable upside.', predictedOutcome: 'Revenue increases 10%', predictionHorizon: '30d', recommendedAction: 'Launch the recovery workflow', recordedAt: Date.parse(fixedTime) })
    expect(recommendation.recommendationId).toBe('rec-1')
    expect(recommendation.predictionStatus).toBe('PREDICTED')
    expect(recommendation.decisionRationale).toContain('clearest measurable upside')
    expect(recommendation.recommendedAction).toContain('recovery workflow')
  })

  test('prediction error distinguishes missing prediction from observed numeric error', () => {
    const recommendation = buildRecommendationRecord({ correlationId: 'rec-2', objective: 'Grow revenue', responseAction: 'recommend', predictedOutcome: 'Revenue increases 10%', recordedAt: Date.parse(fixedTime) })
    const outcome = buildObservedRecommendationOutcome({ recommendationId: 'rec-2', observedOutcome: 'Revenue observed', actualResult: 'Revenue increases 6%', observedAt: Date.parse(fixedTime) + 1000, source: 'business-ledger' })
    const error = calculateRecommendationPredictionError(recommendation, outcome)
    expect(error?.errorMagnitude).toBe(4)
    expect(error?.direction).toBe('worse_than_predicted')
  })

  test('correlation accepts the new recommendation linkage and preserves legacy outcome linkage', () => {
    const recommendation = buildRecommendationRecord({ correlationId: 'rec-3', objective: 'Test', responseAction: 'decide', recordedAt: Date.parse(fixedTime) })
    const correlation = correlateRecommendationOutcomes('rec-3', [{ value: JSON.stringify(recommendation) }], [{ value: JSON.stringify({ recommendationCorrelationId: 'rec-3', type: 'REVENUE_RECOGNIZED', amount: 25, currency: 'USD', transactionId: 'tx-1', occurredAt: fixedTime }) }])
    expect(correlation.recommendation?.recommendationId).toBe('rec-3')
    expect(correlation.hasVerifiedOutcome).toBe(true)
    expect(correlation.outcomes[0]?.actualResult).toContain('25 USD')
  })

  test('behavioral learning requires validation, approval and regression proof before promotion', () => {
    const candidate = buildLearningCandidate({ recommendationId: 'rec-4', behavior: 'Choose faster recovery path', expectedOutcome: 'duration decreases', actualOutcome: 'duration decreased by 1200ms', predictionError: { kind: 'NUMERIC', magnitude: 200, direction: 'better_than_predicted', explanation: 'Observed improvement exceeded prediction.' }, rootCause: 'Initial tool selection was conservative.', proposedChange: 'Prefer validated low-latency tools when risk is unchanged.' })
    expect(candidate.status).toBe('CANDIDATE')
    expect(() => approveLearningCandidate(candidate, 'ceo')).toThrow()
    const validated = validateLearningCandidate(candidate, { passed: true, testRefs: ['tests/continuous-loop-integrity.test.ts'], notes: 'Regression evidence passed.' })
    const approved = approveLearningCandidate(validated, 'ceo')
    expect(approved.status).toBe('APPROVED')
    expect(() => promoteLearningCandidate(approved, '')).toThrow()
  })

  test('continuous loop enforces authoritative transition order', () => {
    const trace = buildContinuousLoopTrace({ recommendationId: 'rec-5', createdAt: fixedTime })
    expect(getLoopTransition('DECIDE', 'PROTECT')).not.toBeNull()
    expect(() => advanceContinuousLoop(trace, 'DECIDE')).toThrow()
    let current = trace
    for (const next of ['UNDERSTAND', 'REMEMBER', 'THINK', 'CURIOUS', 'WORLD_CHECK', 'DECIDE', 'PROTECT', 'OPERATE', 'VERIFY', 'MEASURE_OUTCOME', 'REFLECT', 'LEARN', 'VALIDATE', 'ADAPT', 'EVOLVE', 'REGRESSION_TEST', 'CONTINUE'] as const) current = advanceContinuousLoop(current, next)
    expect(() => completeContinuousLoop(current)).not.toThrow()
    expect(current.currentStage).toBe('CONTINUE')
  })

  test('loop cannot bypass canonical transitions', () => {
    expect(() => assertLoopTransition('PERCEIVE', 'THINK')).toThrow(/not an authorized transition/)
    expect(() => assertLoopTransition('VERIFY', 'EVOLVE')).toThrow(/not an authorized transition/)
  })
})
