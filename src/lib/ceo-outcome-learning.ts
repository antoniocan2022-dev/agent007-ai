import { createHash } from 'node:crypto'

export type PredictionStatus = 'PREDICTED' | 'NOT_CAPTURED' | 'OBSERVED'
export type PredictionErrorDirection = 'better_than_predicted' | 'worse_than_predicted' | 'matched' | 'unknown'

export interface CeoRecommendation { schemaVersion: 2; correlationId: string; recommendationId: string; objective: string; decisionRationale: string; predictedOutcome: string | null; predictionHorizon: string | null; predictionStatus: PredictionStatus; recommendedAction: string; responseAction: string; recordedAt: number }
export interface CeoRecommendationAction { actionId: string; recommendationId: string; description: string; status: 'PLANNED' | 'EXECUTED' | 'NOT_EXECUTED' | 'UNKNOWN'; observedAt: number | null }
export interface ObservedRecommendationOutcome { outcomeId: string; recommendationId: string; observedOutcome: string; actualResult: string; observedAt: number; source: string; metadata: Record<string, unknown> }
export interface RecommendationPredictionError { recommendationId: string; predictionStatus: PredictionStatus; errorMagnitude: number | null; direction: PredictionErrorDirection; explanation: string }
export interface RecommendationOutcomeCorrelation { correlationId: string; recommendation: CeoRecommendation | null; action: CeoRecommendationAction | null; outcomes: ObservedRecommendationOutcome[]; predictionError: RecommendationPredictionError | null; hasVerifiedOutcome: boolean; hasPredictedOutcome: boolean }

function stableId(prefix: string, ...parts: string[]): string { const digest = createHash('sha256').update(parts.map((part) => part.trim()).join('|')).digest('hex').slice(0, 24); return `${prefix}_${digest}` }
export function generateRecommendationCorrelationId(): string { return stableId('ceo_rec', `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`) }

export function buildRecommendationRecord(input: { correlationId: string; objective: string; responseAction: string; decisionRationale?: string; predictedOutcome?: string | null; predictionHorizon?: string | null; recommendedAction?: string; recordedAt?: number }): CeoRecommendation {
  if (!input.correlationId.trim() || !input.objective.trim() || !input.responseAction.trim()) throw new Error('Recommendation requires correlationId, objective and responseAction.')
  const predictedOutcome = input.predictedOutcome?.trim() || null
  return { schemaVersion: 2, correlationId: input.correlationId.trim(), recommendationId: input.correlationId.trim(), objective: input.objective.trim().slice(0, 4000), decisionRationale: (input.decisionRationale?.trim() || `Agent007 selected response action: ${input.responseAction.trim()}.`).slice(0, 5000), predictedOutcome, predictionHorizon: input.predictionHorizon?.trim() || null, predictionStatus: predictedOutcome ? 'PREDICTED' : 'NOT_CAPTURED', recommendedAction: (input.recommendedAction?.trim() || input.responseAction.trim()).slice(0, 8000), responseAction: input.responseAction.trim(), recordedAt: input.recordedAt ?? Date.now() }
}

export async function recordCeoRecommendation(input: Parameters<typeof buildRecommendationRecord>[0]): Promise<CeoRecommendation> {
  const record = buildRecommendationRecord(input)
  try {
    const { db } = await import('./db')
    const key = `ceo_recommendation_${record.correlationId}`
    await db.memory.upsert({ where: { key }, create: { key, value: JSON.stringify(record), category: 'ceo_recommendation' }, update: { value: JSON.stringify(record), category: 'ceo_recommendation' } })
  } catch (error) { console.warn('[ceo-recommendation] persistence failed:', error instanceof Error ? error.message.slice(0, 180) : String(error)) }
  recordRecommendationAction({ recommendationId: record.recommendationId, description: record.recommendedAction }).catch(() => {})
  import('./ceo-continuous-loop').then(({ startContinuousLoop }) => startContinuousLoop({ recommendationId: record.recommendationId, evidence: [`recommendation:${record.recommendationId}`] })).catch(() => {})
  return record
}

export async function recordRecommendationAction(input: { recommendationId: string; description: string; status?: CeoRecommendationAction['status']; observedAt?: number | null }): Promise<CeoRecommendationAction> {
  if (!input.recommendationId.trim() || !input.description.trim()) throw new Error('Recommendation action requires recommendationId and description.')
  const action: CeoRecommendationAction = { actionId: stableId('ceo_action', input.recommendationId, input.description), recommendationId: input.recommendationId.trim(), description: input.description.trim().slice(0, 8000), status: input.status ?? 'PLANNED', observedAt: input.observedAt ?? null }
  try { const { db } = await import('./db'); const key = `ceo_recommendation_action:${action.actionId}`; await db.memory.upsert({ where: { key }, create: { key, value: JSON.stringify(action), category: 'ceo_recommendation_action' }, update: { value: JSON.stringify(action), category: 'ceo_recommendation_action' } }) } catch (error) { console.warn('[ceo-action] persistence failed:', error instanceof Error ? error.message.slice(0, 180) : String(error)) }
  return action
}

export function buildObservedRecommendationOutcome(input: { recommendationId: string; observedOutcome: string; actualResult: string; observedAt?: number; source: string; metadata?: Record<string, unknown> }): ObservedRecommendationOutcome {
  if (!input.recommendationId.trim() || !input.observedOutcome.trim() || !input.actualResult.trim() || !input.source.trim()) throw new Error('Observed recommendation outcome requires recommendationId, observedOutcome, actualResult and source.')
  const observedAt = input.observedAt ?? Date.now()
  return { outcomeId: stableId('ceo_observed_outcome', input.recommendationId, input.observedOutcome, input.actualResult, String(observedAt), input.source), recommendationId: input.recommendationId.trim(), observedOutcome: input.observedOutcome.trim().slice(0, 5000), actualResult: input.actualResult.trim().slice(0, 5000), observedAt, source: input.source.trim().slice(0, 1000), metadata: input.metadata ?? {} }
}

export async function recordObservedRecommendationOutcome(input: Parameters<typeof buildObservedRecommendationOutcome>[0]): Promise<ObservedRecommendationOutcome> {
  const outcome = buildObservedRecommendationOutcome(input)
  try { const { db } = await import('./db'); const key = `ceo_observed_outcome:${outcome.outcomeId}`; await db.memory.upsert({ where: { key }, create: { key, value: JSON.stringify(outcome), category: 'ceo_observed_outcome' }, update: { value: JSON.stringify(outcome), category: 'ceo_observed_outcome' } }) } catch (error) { console.warn('[ceo-observed-outcome] persistence failed:', error instanceof Error ? error.message.slice(0, 180) : String(error)) }
  import('./ceo-outcome-learning').catch(() => {})
  return outcome
}

export function calculateRecommendationPredictionError(recommendation: CeoRecommendation | null, outcome: ObservedRecommendationOutcome | null): RecommendationPredictionError | null {
  if (!recommendation || !outcome) return null
  if (recommendation.predictionStatus !== 'PREDICTED' || !recommendation.predictedOutcome) return { recommendationId: recommendation.recommendationId, predictionStatus: recommendation.predictionStatus, errorMagnitude: null, direction: 'unknown', explanation: 'No explicit prediction was captured, so prediction error cannot be measured.' }
  const predicted = recommendation.predictedOutcome.toLowerCase().trim(); const actual = outcome.actualResult.toLowerCase().trim()
  if (predicted === actual) return { recommendationId: recommendation.recommendationId, predictionStatus: recommendation.predictionStatus, errorMagnitude: 0, direction: 'matched', explanation: 'Observed actual result matches the captured prediction text.' }
  const predictedNumbers = [...predicted.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0])).filter(Number.isFinite)
  const actualNumbers = [...actual.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0])).filter(Number.isFinite)
  if (predictedNumbers.length && actualNumbers.length) { const errorMagnitude = Math.abs(actualNumbers[0] - predictedNumbers[0]); return { recommendationId: recommendation.recommendationId, predictionStatus: recommendation.predictionStatus, errorMagnitude, direction: actualNumbers[0] === predictedNumbers[0] ? 'matched' : actualNumbers[0] > predictedNumbers[0] ? 'better_than_predicted' : 'worse_than_predicted', explanation: `Numeric prediction error is ${errorMagnitude}.` } }
  return { recommendationId: recommendation.recommendationId, predictionStatus: recommendation.predictionStatus, errorMagnitude: null, direction: 'unknown', explanation: 'Prediction and actual result differ, but no reliable numeric error can be calculated.' }
}

export function correlateRecommendationOutcomes(correlationId: string, recommendationRecords: { value: string }[], outcomeRecords: { value: string }[], actionRecords: { value: string }[] = [], observedOutcomeRecords: { value: string }[] = []): RecommendationOutcomeCorrelation {
  let recommendation: CeoRecommendation | null = null
  for (const record of recommendationRecords) { try { const parsed = JSON.parse(record.value) as Partial<CeoRecommendation>; if (parsed.correlationId === correlationId) { recommendation = { ...buildRecommendationRecord({ correlationId, objective: parsed.objective ?? '', responseAction: parsed.responseAction ?? '' }), ...parsed, recommendationId: parsed.recommendationId ?? correlationId } as CeoRecommendation; break } } catch { /* malformed record ignored */ } }
  let action: CeoRecommendationAction | null = null
  for (const record of actionRecords) { try { const parsed = JSON.parse(record.value) as CeoRecommendationAction; if (parsed.recommendationId === correlationId) { action = parsed; break } } catch { /* malformed record ignored */ } }
  const outcomes: ObservedRecommendationOutcome[] = []
  for (const record of [...outcomeRecords, ...observedOutcomeRecords]) {
    try {
      const parsed = JSON.parse(record.value) as Partial<ObservedRecommendationOutcome> & { revenueCorrelationId?: string; recommendationCorrelationId?: string; transactionId?: string; amount?: number; currency?: string; type?: string; occurredAt?: string }
      const linked = parsed.recommendationId ?? parsed.recommendationCorrelationId ?? parsed.revenueCorrelationId
      if (linked !== correlationId) continue
      const observedAt = parsed.observedAt ?? (parsed.occurredAt ? Date.parse(parsed.occurredAt) : Date.now())
      if (!Number.isFinite(observedAt)) continue
      outcomes.push(parsed.observedOutcome && parsed.actualResult ? parsed as ObservedRecommendationOutcome : { outcomeId: stableId('legacy_outcome', correlationId, parsed.transactionId ?? '', String(parsed.amount ?? ''), parsed.occurredAt ?? ''), recommendationId: correlationId, observedOutcome: `${parsed.type ?? 'business outcome'} observed`, actualResult: `${parsed.amount ?? 'unknown'} ${parsed.currency ?? ''}`.trim(), observedAt, source: 'architecture_business_outcome', metadata: parsed as Record<string, unknown> })
    } catch { /* malformed record ignored */ }
  }
  const uniqueOutcomes = [...new Map(outcomes.map((outcome) => [outcome.outcomeId, outcome])).values()]
  return { correlationId, recommendation, action, outcomes: uniqueOutcomes, predictionError: calculateRecommendationPredictionError(recommendation, uniqueOutcomes[0] ?? null), hasVerifiedOutcome: uniqueOutcomes.length > 0, hasPredictedOutcome: recommendation?.predictionStatus === 'PREDICTED' }
}

export async function getRecommendationOutcomeCorrelation(correlationId: string): Promise<RecommendationOutcomeCorrelation> {
  if (!correlationId.trim()) throw new Error('Recommendation correlationId is required.')
  try { const { db } = await import('./db'); const [recommendationRecords, outcomeRecords, actionRecords, observedOutcomeRecords] = await Promise.all([db.memory.findMany({ where: { category: 'ceo_recommendation' } }).catch(() => []), db.memory.findMany({ where: { category: 'architecture_business_outcome' } }).catch(() => []), db.memory.findMany({ where: { category: 'ceo_recommendation_action' } }).catch(() => []), db.memory.findMany({ where: { category: 'ceo_observed_outcome' } }).catch(() => [])]); return correlateRecommendationOutcomes(correlationId, recommendationRecords, outcomeRecords, actionRecords, observedOutcomeRecords) } catch { return { correlationId, recommendation: null, action: null, outcomes: [], predictionError: null, hasVerifiedOutcome: false, hasPredictedOutcome: false } }
}
