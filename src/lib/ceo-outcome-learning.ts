export interface CeoRecommendation {
  schemaVersion: 1
  correlationId: string
  objective: string
  responseAction: string
  recordedAt: number
}

export function generateRecommendationCorrelationId(): string {
  return `ceo_rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// Fire-and-forget, matching the established pattern for every other non-critical persistence this
// session (persistEvidenceTrace, persistIncidentCandidate): a failure here can never affect the
// response the user receives. Dynamic db import, so this module (and every pure function in it)
// stays loadable without Prisma, the same fix already applied to ceo-incident-regression-candidate.ts.
export async function recordCeoRecommendation(input: { correlationId: string; objective: string; responseAction: string }): Promise<void> {
  try {
    const { db } = await import('./db')
    const record: CeoRecommendation = { schemaVersion: 1, correlationId: input.correlationId, objective: input.objective.slice(0, 2000), responseAction: input.responseAction, recordedAt: Date.now() }
    const key = `ceo_recommendation_${input.correlationId}`
    await db.memory.upsert({ where: { key }, create: { key, value: JSON.stringify(record), category: 'ceo_recommendation' }, update: { value: JSON.stringify(record), category: 'ceo_recommendation' } })
  } catch (error) {
    console.warn('[ceo-recommendation] persistence failed:', error instanceof Error ? error.message.slice(0, 180) : String(error))
  }
}

export interface RecommendationOutcomeCorrelation {
  correlationId: string
  recommendation: CeoRecommendation | null
  matchedOutcomes: Array<{ transactionId: string; amount: number; currency: string; type: string; occurredAt: string }>
  hasVerifiedOutcome: boolean
}

// Pure, directly-testable correlation logic, separate from the DB fetch -- matching the same
// separation already established for Phase 20's aggregateConversationalHealthSignal, for the same
// reason: the actual matching logic can be verified directly in this sandbox even though the real
// records (both categories) require the database to fetch.
export function correlateRecommendationOutcomes(
  correlationId: string,
  recommendationRecords: { value: string }[],
  outcomeRecords: { value: string }[],
): RecommendationOutcomeCorrelation {
  let recommendation: CeoRecommendation | null = null
  for (const record of recommendationRecords) {
    try {
      const parsed = JSON.parse(record.value) as CeoRecommendation
      if (parsed.correlationId === correlationId) { recommendation = parsed; break }
    } catch { /* a malformed record must not break correlation */ }
  }
  const matchedOutcomes: RecommendationOutcomeCorrelation['matchedOutcomes'] = []
  for (const record of outcomeRecords) {
    try {
      const parsed = JSON.parse(record.value) as { revenueCorrelationId?: string; transactionId: string; amount: number; currency: string; type: string; occurredAt: string }
      if (parsed.revenueCorrelationId === correlationId) matchedOutcomes.push({ transactionId: parsed.transactionId, amount: parsed.amount, currency: parsed.currency, type: parsed.type, occurredAt: parsed.occurredAt })
    } catch { /* a malformed record must not break correlation */ }
  }
  return { correlationId, recommendation, matchedOutcomes, hasVerifiedOutcome: matchedOutcomes.length > 0 }
}

export async function getRecommendationOutcomeCorrelation(correlationId: string): Promise<RecommendationOutcomeCorrelation> {
  try {
    const { db } = await import('./db')
    const [recommendationRecords, outcomeRecords] = await Promise.all([
      db.memory.findMany({ where: { category: 'ceo_recommendation' } }).catch(() => []),
      db.memory.findMany({ where: { category: 'architecture_business_outcome' } }).catch(() => []),
    ])
    return correlateRecommendationOutcomes(correlationId, recommendationRecords, outcomeRecords)
  } catch {
    return { correlationId, recommendation: null, matchedOutcomes: [], hasVerifiedOutcome: false }
  }
}
