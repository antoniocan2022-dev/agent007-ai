import { describe, expect, test } from 'bun:test'
import { buildConversationDecisionContract } from '@/lib/ceo-conversation-decision-contract'
import { buildCanonicalConversationContext } from '@/lib/ceo-cognitive-conversation'
import { buildCeoRuntimeMetrics } from '@/lib/ceo-runtime-metrics'
import { CeoRequestAbortedError, isCeoRequestAborted, throwIfCeoRequestAborted } from '@/lib/ceo-cancellation'
import { getCeoCancellationSignal, runWithCeoCancellationContext } from '@/lib/ceo-cancellation-context'
import type { CognitiveLifecycleResult } from '@/lib/ceo-cognitive-contract'

test('runtime metrics keep technical reliability separate from cognitive quality', () => {
  const state = {
    schemaVersion: 1,
    topic: 'CEO conversation',
    topicCandidates: ['CEO conversation'],
    recentUserGoals: ['build a human-quality executive partner'],
    decisions: ['conversation understanding and continuity'],
    entities: ['Agent007'],
    unresolvedQuestions: [],
    threads: [],
    turnCount: 12,
  } as any
  const context = buildCanonicalConversationContext({ currentMessage: 'Why does this matter?', rows: [], state, references: [], memories: [] })
  const contract = buildConversationDecisionContract(context)
  const result = {
    content: 'It matters because continuity lets the CEO use prior decisions instead of restarting every turn.',
    provider: 'groq',
    model: 'test-model',
    responseMs: 420,
    attempts: ['groq'],
    executionPlan: { requestId: 'test', path: 'fast', reasoningStrategy: 'direct', stages: [], maxEscalations: 0, maxProviderAttempts: 1 },
    decisionPlan: { requestId: 'test', path: 'fast', objective: 'Why does this matter?', taskClass: 'reasoning', missionRelevant: false, requiredCapabilities: [], qualityTier: 'standard', reasoningStrategy: 'direct', cognitiveDepth: 1, verificationRequired: false, maxEscalations: 0, maxProviderAttempts: 1, latencyBudgetMs: 15000, executionContract: {} },
    quality: { decision: 'PASS', evidenceState: 'NOT_APPLICABLE', verificationStatus: 'NOT_REQUIRED', checks: { nonEmpty: true, contractValid: true, objectiveCoverage: true, internalConsistency: true, evidenceDiscipline: true, actionableStructure: true }, conversationQuality: { score: 91, continuity: 94, relevance: 92, naturalness: 90, toneAlignment: 88, coherence: 95, nonRepetition: 96, initiative: 80, referenceResolution: 100, personalityConsistency: 93, progression: 89, issues: [] }, reasons: [] },
    evidenceState: 'NOT_APPLICABLE',
    degraded: false,
  } as unknown as CognitiveLifecycleResult

  const metrics = buildCeoRuntimeMetrics({ result, decisionContract: contract })
  expect(metrics.technicalReliability.outcome).toBe('completed')
  expect(metrics.technicalReliability.providerAvailable).toBe(true)
  expect(metrics.technicalReliability.responseMs).toBe(420)
  expect(metrics.cognitiveQuality.measured).toBe(true)
  expect(metrics.cognitiveQuality.score).toBe(91)
  expect(metrics.cognitiveQuality.continuity).toBe(94)
  expect(metrics.cognitiveQuality.responseRegister).toBe('conversational')
  expect(metrics.cognitiveQuality.cognitiveDepth).toBe(1)
})

test('cognitive quality is not fabricated when the evaluator did not measure it', () => {
  const result = {
    provider: 'groq',
    model: 'test-model',
    responseMs: 300,
    attempts: ['groq'],
    decisionPlan: { cognitiveDepth: 1 },
    quality: { decision: 'PASS', verificationStatus: 'NOT_REQUIRED', evidenceState: 'NOT_APPLICABLE' },
    evidenceState: 'NOT_APPLICABLE',
    degraded: false,
  } as unknown as CognitiveLifecycleResult
  const metrics = buildCeoRuntimeMetrics({ result })
  expect(metrics.cognitiveQuality.measured).toBe(false)
  expect(metrics.cognitiveQuality.score).toBe(0)
  expect(metrics.cognitiveQuality.relevance).toBe(0)
  expect(metrics.technicalReliability.outcome).toBe('completed')
  expect(metrics.technicalReliability.providerAvailable).toBe(true)
})

describe('CEO cancellation contract', () => {
  test('aborted signals are classified without poisoning normal errors', () => {
    const controller = new AbortController()
    controller.abort('user-stop')
    expect(() => throwIfCeoRequestAborted(controller.signal)).toThrow(CeoRequestAbortedError)
    try { throwIfCeoRequestAborted(controller.signal) } catch (error) { expect(isCeoRequestAborted(error)).toBe(true) }
  })

  test('cancellation context is request-scoped', async () => {
    const first = new AbortController()
    const second = new AbortController()
    const values = await Promise.all([
      runWithCeoCancellationContext(first.signal, async () => getCeoCancellationSignal()),
      runWithCeoCancellationContext(second.signal, async () => getCeoCancellationSignal()),
    ])
    expect(values[0]).toBe(first.signal)
    expect(values[1]).toBe(second.signal)
  })
})