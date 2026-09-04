export type ConversationalMemoryLike = { key: string; category: string }

/**
 * Canonical visibility policy for memory objects that may be supplied to the
 * conversational CEO context. Control-plane, telemetry, evidence traces and
 * correlation ledgers are durable system records, not user-facing context.
 */
const INTERNAL_ONLY_CATEGORIES = new Set([
  'evidence_trace',
  'ceo_recommendation',
  'ceo_recommendation_action',
  'ceo_observed_outcome',
  'ceo_conversation_incident',
  'ceo_incident_regression_candidate',
  'architecture_business_outcome',
  'mission_telemetry',
  'runtime_telemetry',
  'ceo_runtime_metrics',
  'provider_telemetry',
])

const INTERNAL_ONLY_KEY_PREFIXES = [
  'ceo_recommendation_',
  'ceo_recommendation_action:',
  'ceo_observed_outcome:',
  'ceo_conversation_incident_',
  'ceo_incident_regression_candidate_',
  'evidence_trace_',
  'architecture_business_outcome:',
  'runtime_telemetry:',
  'mission_telemetry:',
]

export function isConversationalMemoryVisible(memory: ConversationalMemoryLike): boolean {
  const category = memory.category.trim().toLowerCase()
  const key = memory.key.trim().toLowerCase()
  if (INTERNAL_ONLY_CATEGORIES.has(category)) return false
  return !INTERNAL_ONLY_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
}

export function filterConversationalMemories<T extends ConversationalMemoryLike>(memories: readonly T[]): T[] {
  return memories.filter(isConversationalMemoryVisible)
}

export function getInternalOnlyMemoryCategories(): readonly string[] {
  return [...INTERNAL_ONLY_CATEGORIES]
}
