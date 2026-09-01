import type { ConversationDecisionContract } from './ceo-conversation-decision-contract'
import type { CognitiveLifecycleResult } from './ceo-cognitive-contract'

export type CeoRequestOutcome = 'completed' | 'degraded' | 'cancelled' | 'timeout' | 'failed'

export interface CeoRuntimeMetrics {
  schemaVersion: 2
  technicalReliability: {
    outcome: CeoRequestOutcome
    providerAvailable: boolean
    responseMs: number
    providerAttemptCount: number
    degraded: boolean
    qualityDecision: CognitiveLifecycleResult['quality']['decision']
    verificationStatus: CognitiveLifecycleResult['quality']['verificationStatus']
    evidenceState: CognitiveLifecycleResult['evidenceState']
  }
  cognitiveQuality: {
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
  const hasCompletedResponse = technicalOutcome === 'completed' || technicalOutcome === 'degraded'
  const cognitiveFallback = hasCompletedResponse ? 80 : 0
  const dimensionFallback = hasCompletedResponse ? 100 : 0
  const fallbackScore = conversation?.score ?? (input.result.quality.decision === 'PASS' ? 80 : 50)
  const depth = input.decisionContract
    ? depthToScore(input.decisionContract.cognitiveDepth)
    : Math.min(4, Math.max(0, input.result.decisionPlan.cognitiveDepth)) as 0 | 1 | 2 | 3 | 4

  return {
    schemaVersion: 2,
    technicalReliability: {
      outcome: technicalOutcome,
      providerAvailable: Boolean(input.result.provider && input.result.model),
      responseMs: clampScore(input.result.responseMs, 0),
      providerAttemptCount: Math.max(0, input.result.attempts.length),
      degraded: input.result.degraded,
      qualityDecision: input.result.quality.decision,
      verificationStatus: input.result.quality.verificationStatus,
      evidenceState: input.result.evidenceState,
    },
    cognitiveQuality: {
      score: clampScore(hasCompletedResponse ? fallbackScore : undefined, cognitiveFallback),
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
      semanticCompleteness: input.decisionContract?.completeness ?? (hasCompletedResponse ? 'complete' : 'insufficient'),
      responseRegister: input.decisionContract?.responseRegister ?? 'conversational',
      clarificationRequired: input.decisionContract?.clarificationRequired ?? false,
    },
  }
}

export function logCeoRuntimeMetrics(metrics: CeoRuntimeMetrics, requestId?: string): void {
  console.log('[ceo-runtime-metrics]', JSON.stringify({ requestId: requestId ?? null, ...metrics }))
}