import type { CanonicalConversationContext } from './ceo-cognitive-conversation'
import type { ConversationQualityScore } from './ceo-response-quality-gate'
import type { ConversationIncidentCategory } from './ceo-conversation-incident'

export interface ConversationRegressionContract {
  schemaVersion: 1
  fingerprint: string
  category: ConversationIncidentCategory
  invariant: string
  semanticShape: {
    intent: CanonicalConversationContext['intentHint']
    speechAct: CanonicalConversationContext['speechAct']
    cognitiveDepth: CanonicalConversationContext['cognitiveDepth']
    referenceScope: CanonicalConversationContext['referenceScope']
  }
  failingDimensions: string[]
  shouldNever: string[]
}

function categoryForQuality(quality: ConversationQualityScore): ConversationIncidentCategory {
  if (quality.referenceResolution < 70) return 'reference'
  if (quality.continuity < 70) return 'state'
  if (quality.naturalness < 70 || quality.personalityConsistency < 70) return 'personality'
  if (quality.relevance < 70 || quality.coherence < 70) return 'understanding'
  if (quality.progression < 70) return 'quality'
  return 'unknown'
}

function stableFingerprint(parts: string[]): string {
  let hash = 2166136261
  for (const char of parts.join('|')) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return `conv-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function buildConversationRegressionContract(context: CanonicalConversationContext, quality: ConversationQualityScore): ConversationRegressionContract {
  const failingDimensions = (
    [
      ['continuity', quality.continuity],
      ['relevance', quality.relevance],
      ['naturalness', quality.naturalness],
      ['toneAlignment', quality.toneAlignment],
      ['coherence', quality.coherence],
      ['nonRepetition', quality.nonRepetition],
      ['referenceResolution', quality.referenceResolution],
      ['initiative', quality.initiative],
      ['personalityConsistency', quality.personalityConsistency],
      ['progression', quality.progression],
    ] as Array<[string, number]>
  ).filter(([, score]) => Number(score) < 70).map(([name]) => name)
  const category = categoryForQuality(quality)
  return {
    schemaVersion: 1,
    fingerprint: stableFingerprint([
      context.intentHint,
      context.speechAct,
      context.cognitiveDepth,
      context.referenceScope,
      category,
      ...failingDimensions,
    ]),
    category,
    invariant: category === 'reference'
      ? 'A resolved conversational reference must remain resolved through generation and evaluation.'
      : category === 'state'
        ? 'Relevant prior conversation must remain available when continuity is required.'
        : category === 'understanding'
          ? 'The CEO must answer the semantic user intent rather than surface wording alone.'
          : category === 'personality'
            ? 'Conversation should remain natural and consistent with the CEO communication contract.'
            : 'A conversational response should satisfy its semantic contract without unnecessary governance leakage.',
    semanticShape: {
      intent: context.intentHint,
      speechAct: context.speechAct,
      cognitiveDepth: context.cognitiveDepth,
      referenceScope: context.referenceScope,
    },
    failingDimensions,
    shouldNever: [
      'Never expose internal quality scores or routing metadata as the user-facing conversation.',
      'Never convert an ordinary conversational failure into an evidence claim or fabricated verification.',
      'Never silently discard a generated answer without recording a concrete failure reason.',
    ],
  }
}
