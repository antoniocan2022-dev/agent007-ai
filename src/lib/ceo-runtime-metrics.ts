import type { ConversationDecisionContract } from './ceo-conversation-decision-contract'
import type { CognitiveLifecycleResult } from './ceo-cognitive-contract'
import type { CeoRequestOutcome } from './ceo-cognitive-contract'

export type TechnicalOutcome = 'completed' | 'degraded' | 'cancelled' | 'timeout' | 'failed'

export interface CeoRuntimeMetrics {
  schemaVersion: 1
  technicalReliability: {
    outcome: TechnicalOutcome
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

export function buildCeoRuntimeMetrics(input: {
  result: CognitiveLifecycleResult
  decisionContract?: ConversationDecisionContract
  outcome?: CeoRequestOutcome
}): CeoRuntimeMetrics {
  const conversation = input.result.quality.conversationQuality
  const fallbackScore = conversation?.score ?? (input.result.quality.decision === 'PASS' ? 80 : 50)
  const technicalOutcome: TechnicalOutcome = input.outcome === 'cancelled'
    ? 'cancelled'
    : input.outcome === 'timeout'
      ? 'timeout'
      : input.result.degraded
        ? 'degraded'
        : input.result.provider
          ? 'completed'
          : 'failed'

  return {
    schemaVersion: 1,
    technicalReliability: {
      outcome: technicalOutcome,
      providerAvailable: Boolean(input.result.provider && input.result.model),
      responseMs: Math.max(0, Math.round(input.result.responseMs)),
      providerAttemptCount: input.result.attempts.length,
      degraded: input.result.degraded,
      qualityDecision: input.result.quality.decision,
      verificationStatus: input.result.quality.verificationStatus,
      evidenceState: input.result.evidenceState,
    },
    cognitiveQuality: {
      score: Math.round(Math.max(0, Math.min(100, fallbackScore))),
      continuity: Math.round(conversation?.continuity ?? 100),
      relevance: Math.round(conversation?.relevance ?? 100),
      naturalness: Math.round(conversation?.naturalness ?? 100),
      toneAlignment: Math.round(conversation?.toneAlignment ?? 100),
      coherence: Math.round(conversation?.coherence ?? 100),
      nonRepetition: Math.round(conversation?.nonRepetition ?? 100),
      initiative: Math.round(conversation?.initiative ?? 100),
      referenceResolution: Math.round(conversation?.referenceResolution ?? 100),
      personalityConsistency: Math.round(conversation?.personalityConsistency ?? 100),
      progression: Math.round(conversation?.progression ?? 100),
      cognitiveDepth: input.decisionContract ? ({ direct: 0, contextual: 1, deep: 2, strategic: 4 } as const)[input.decisionContract.cognitiveDepth] : Math.min(4, Math.max(0, input.result.decisionPlan.cognitiveDepth)) as 0 | 1 | 2 | 3 | 4,
      semanticCompleteness: input.decisionContract?.completeness ?? 'complete',
      responseRegister: input.decisionContract?.responseRegister ?? 'conversational',
      clarificationRequired: input.decisionContract?.clarificationRequired ?? false,
    },
  }
}

export function logCeoRuntimeMetrics(metrics: CeoRuntimeMetrics, requestId?: string): void {
  console.log('[ceo-runtime-metrics]', JSON.stringify({ requestId: requestId ?? null, ...metrics }))
}
