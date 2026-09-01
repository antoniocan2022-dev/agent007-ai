import type { ConversationDecisionContract } from './ceo-conversation-decision-contract'
import type { CognitiveLifecycleResult } from './ceo-cognitive-contract'

export type CeoRequestOutcome = 'completed' | 'degraded' | 'cancelled' | 'timeout' | 'failed'

export interface CeoRuntimeMetrics {
  schemaVersion: 4
  technicalReliability: {
    outcome: CeoRequestOutcome
    providerAvailable: boolean
    responseMs: number
    providerAttemptCount: number
    degraded: boolean
    qualityDecision: CognitiveLifecycleResult['quality']['decision'] | 'NOT_RUN'
    verificationStatus: CognitiveLifecycleResult['quality']['verificationStatus'] | 'NOT_RUN'
    evidenceState: CognitiveLifecycleResult['evidenceState'] | 'NOT_RUN'
  }
  cognitiveQuality: {
    measured: boolean
    score: number
    continuity: number
    relevance: number
    naturalness: number
    toneAlignment: number
    coherence: number
    nonRepetition: number
    initiative: number
    referenceResolution: number
    personalityConsistency: number
    progression: number
    cognitiveDepth: 0 | 1 | 2 | 3 | 4
    semanticCompleteness: 'complete' | 'partial' | 'insufficient'
    responseRegister: string
    clarificationRequired: boolean
  }
}

function clampScore(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.round(Math.max(0, Math.min(100, numeric)))
}
function nonNegativeFinite(value: unknown, fallback = 0): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.round(Math.max(0, numeric))
}
function depthToScore(depth: ConversationDecisionContract['cognitiveDepth']): 0 | 1 | 2 | 3 | 4 {
  if (depth === 'direct') return 0
  if (depth === 'contextual') return 1
  if (depth === 'deep') return 2
  return 4
}

export function buildCeoRuntimeMetrics(input: {
  result: CognitiveLifecycleResult
  decisionContract?: ConversationDecisionContract
  outcome?: CeoRequestOutcome
}): CeoRuntimeMetrics {
  const conversation = input.result.quality.conversationQuality
  const technicalOutcome: CeoRequestOutcome = input.outcome ?? (input.result.degraded ? 'degraded' : input.result.provider ? 'completed' : 'failed')
  const cognitiveMeasured = Boolean(conversation)
  const cognitiveFallback = technicalOutcome === 'completed' || technicalOutcome === 'degraded' ? 0 : 0
  const dimensionFallback = cognitiveMeasured ? 0 : 0
  const fallbackScore = conversation?.score
  const depth = input.decisionContract
    ? depthToScore(input.decisionContract.cognitiveDepth)
    : Math.min(4, Math.max(0, input.result.decisionPlan.cognitiveDepth)) as 0 | 1 | 2 | 3 | 4

  return {
    schemaVersion: 4,
    technicalReliability: {
      outcome: technicalOutcome,
      providerAvailable: Boolean(input.result.provider && input.result.model),
      responseMs: nonNegativeFinite(input.result.responseMs),
      providerAttemptCount: Math.max(0, input.result.attempts.length),
      degraded: input.result.degraded,
      qualityDecision: input.result.quality.decision,
      verificationStatus: input.result.quality.verificationStatus,
      evidenceState: input.result.evidenceState,
    },
    cognitiveQuality: {
      measured: cognitiveMeasured,
      score: clampScore(fallbackScore, cognitiveFallback),
      continuity: clampScore(conversation?.continuity, dimensionFallback),
      relevance: clampScore(conversation?.relevance, dimensionFallback),
      naturalness: clampScore(conversation?.naturalness, dimensionFallback),
      toneAlignment: clampScore(conversation?.toneAlignment, dimensionFallback),
      coherence: clampScore(conversation?.coherence, dimensionFallback),
      nonRepetition: clampScore(conversation?.nonRepetition, dimensionFallback),
      initiative: clampScore(conversation?.initiative, dimensionFallback),
      referenceResolution: clampScore(conversation?.referenceResolution, dimensionFallback),
      personalityConsistency: clampScore(conversation?.personalityConsistency, dimensionFallback),
      progression: clampScore(conversation?.progression, dimensionFallback),
      cognitiveDepth: depth,
      semanticCompleteness: input.decisionContract?.completeness ?? (technicalOutcome === 'completed' || technicalOutcome === 'degraded' ? 'complete' : 'insufficient'),
      responseRegister: input.decisionContract?.responseRegister ?? 'conversational',
      clarificationRequired: input.decisionContract?.clarificationRequired ?? false,
    },
  }
}

export function logCeoRuntimeMetrics(metrics: CeoRuntimeMetrics, requestId?: string): void {
  console.log('[ceo-runtime-metrics]', JSON.stringify({ requestId: requestId ?? null, ...metrics }))
}

export function logCeoTechnicalOutcome(outcome: CeoRequestOutcome, requestId: string, responseMs = 0): void {
  const emptyResult = {
    provider: null,
    model: null,
    responseMs,
    attempts: [] as string[],
    decisionPlan: { cognitiveDepth: 0 },
    quality: { decision: 'NOT_RUN', verificationStatus: 'NOT_RUN', evidenceState: 'NOT_RUN', conversationQuality: undefined },
    evidenceState: 'NOT_RUN',
    degraded: outcome === 'degraded',
  } as unknown as CognitiveLifecycleResult
  logCeoRuntimeMetrics(buildCeoRuntimeMetrics({ result: emptyResult, outcome }), requestId)
}