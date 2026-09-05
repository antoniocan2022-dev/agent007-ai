import { describe, expect, test } from 'bun:test'
import { assertLoopTransition, getLoopTransition, CANONICAL_CAPABILITY_LEDGER, LOOP_TRANSITIONS } from '@/lib/architecture-integrity-contract'
import { buildRecommendationRecord, buildObservedRecommendationOutcome, calculateRecommendationPredictionError, correlateRecommendationOutcomes } from '@/lib/ceo-outcome-learning'
import { approveLearningCandidate, buildLearningCandidate, promoteLearningCandidate, validateLearningCandidate } from '@/lib/ceo-behavioral-learning'
import { advanceContinuousLoop, buildContinuousLoopTrace, completeContinuousLoop } from '@/lib/ceo-continuous-loop'

const fixedTime = '2026-09-03T22:00:00.000Z'

describe('Continuous loop integrity — phases 5-8', () => {
  test('canonical loop has one owner and a complete ordered transition contract', () => {
    const entry = CANONICAL_CAPABILITY_LEDGER.continuous_loop
    expect(entry.canonicalOwner).toBe('ceo-continuous-loop')
    expect(entry.integrationStatus).toBe('INTEGRATED')
    expect(entry.lifecycleState).toBe('INTEGRATED')
    expect(LOOP_TRANSITIONS).toHaveLength(17)
    expect(LOOP_TRANSITIONS[0]?.from).toBe('PERCEIVE')
    expect(LOOP_TRANSITIONS.at(-1)?.to).toBe('CONTINUE')
    expect(Object.values(CANONICAL_CAPABILITY_LEDGER).filter((item) => item.capability === 'continuous_loop')).toHaveLength(1)
  })

  test('recommendation contract contains rationale, prediction and action', () => {
    const recommendation = buildRecommendationRecord({ correlationId: 'rec-1', objective: 'Improve revenue', responseAction: 'recommend', decisionRationale: 'Prioritize the bottleneck with the clearest measurable upside.', predictedOutcome: 'Revenue increases 10%', predictionHorizon: '30d', recommendedAction: 'Launch the recovery workflow', recordedAt: Date.parse(fixedTime) })
    expect(recommendation.recommendationId).toBe('rec-1')
    expect(recommendation.predictionStatus).toBe('PREDICTED')
    expect(recommendation.decisionRationale).toContain('clearest measurable upside')
    expect(recommendation.recommendedAction).toContain('recovery workflow')
    expect(() => buildRecommendationRecord({ correlationId: 'rec-invalid', objective: 'Test', responseAction: 'recommend', recordedAt: Number.NaN })).toThrow(/finite timestamp/)
  })

  test('prediction error distinguishes missing prediction from observed numeric error', () => {
    const recommendation = buildRecommendationRecord({ correlationId: 'rec-2', objective: 'Grow revenue', responseAction: 'recommend', predictedOutcome: 'Revenue increases 10%', recordedAt: Date.parse(fixedTime) })
    const outcome = buildObservedRecommendationOutcome({ recommendationId: 'rec-2', observedOutcome: 'Revenue observed', actualResult: 'Revenue increases 6%', observedAt: Date.parse(fixedTime) + 1000, source: 'business-ledger' })
    const error = calculateRecommendationPredictionError(recommendation, outcome)
    expect(error?.errorMagnitude).toBe(4)
    expect(error?.direction).toBe('worse_than_predicted')
    expect(() => buildObservedRecommendationOutcome({ recommendationId: 'rec-2', observedOutcome: 'Revenue observed', actualResult: 'Revenue increases 6%', observedAt: Number.NaN, source: 'business-ledger' })).toThrow(/finite timestamp/)
  })

  test('correlation accepts the new recommendation linkage, preserves legacy linkage, and uses the newest observed outcome for prediction error', () => {
    const recommendation = buildRecommendationRecord({ correlationId: 'rec-3', objective: 'Test', responseAction: 'decide', predictedOutcome: 'Revenue increases 10%', recordedAt: Date.parse(fixedTime) })
    const first = buildObservedRecommendationOutcome({ recommendationId: 'rec-3', observedOutcome: 'Older revenue observation', actualResult: 'Revenue increases 8%', observedAt: Date.parse(fixedTime) + 1000, source: 'business-ledger' })
    const second = buildObservedRecommendationOutcome({ recommendationId: 'rec-3', observedOutcome: 'Newer revenue observation', actualResult: 'Revenue increases 6%', observedAt: Date.parse(fixedTime) + 2000, source: 'business-ledger' })
    const correlation = correlateRecommendationOutcomes('rec-3', [{ value: JSON.stringify(recommendation) }], [{ value: JSON.stringify({ recommendationCorrelationId: 'rec-3', type: 'REVENUE_RECOGNIZED', amount: 25, currency: 'USD', transactionId: 'tx-1', occurredAt: fixedTime }) }, { value: JSON.stringify(first) }, { value: JSON.stringify(second) }])
    expect(correlation.recommendation?.recommendationId).toBe('rec-3')
    expect(correlation.hasVerifiedOutcome).toBe(true)
    expect(correlation.outcomes[0]?.actualResult).toContain('Revenue increases 6%')
    expect(correlation.predictionError?.errorMagnitude).toBe(4)
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

  test('governed evolution remains an approval-and-verification boundary', () => {
    const entry = CANONICAL_CAPABILITY_LEDGER.governed_evolution
    expect(entry.canonicalOwner).toBe('evolution-engine')
    expect(entry.requiredContracts).toEqual(expect.arrayContaining(['simulation', 'approval', 'verification']))
    expect(entry.duplicateRisk).toBe('LOW')
  })

  test('continuous loop keeps recommendation identity stable across repeated trace construction', () => {
    const first = buildContinuousLoopTrace({ recommendationId: 'rec-identity', createdAt: fixedTime, evidence: ['first'] })
    const second = buildContinuousLoopTrace({ recommendationId: 'rec-identity', createdAt: '2026-09-03T23:00:00.000Z', evidence: ['second'] })
    expect(first.loopId).toBe(second.loopId)
    expect(first.createdAt).not.toBe(second.createdAt)
  })

  test('continuous loop enforces authoritative transition order from PERCEIVE through CONTINUE', () => {
    const trace = buildContinuousLoopTrace({ recommendationId: 'rec-5', createdAt: fixedTime })
    expect(getLoopTransition('DECIDE', 'PROTECT')).not.toBeNull()
    expect(() => advanceContinuousLoop(trace, 'DECIDE')).toThrow()
    let current = trace
    for (const next of ['UNDERSTAND', 'REMEMBER', 'THINK', 'CURIOUS', 'WORLD_CHECK', 'DECIDE', 'PROTECT', 'OPERATE', 'VERIFY', 'MEASURE_OUTCOME', 'REFLECT', 'LEARN', 'VALIDATE', 'ADAPT', 'EVOLVE', 'REGRESSION_TEST', 'CONTINUE'] as const) current = advanceContinuousLoop(current, next)
    expect(() => completeContinuousLoop(current)).not.toThrow()
    expect(current.currentStage).toBe('CONTINUE')
    expect(current.history).toHaveLength(18)
  })

  test('loop cannot bypass canonical transitions', () => {
    expect(() => assertLoopTransition('PERCEIVE', 'THINK')).toThrow(/not an authorized transition/)
    expect(() => assertLoopTransition('VERIFY', 'EVOLVE')).toThrow(/not an authorized transition/)
  })
})
