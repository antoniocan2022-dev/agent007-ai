import { createHash } from 'node:crypto'

export type PredictionEligibility = 'ELIGIBLE' | 'NOT_APPLICABLE'
export type PredictionStatus = 'PREDICTED' | 'NOT_CAPTURED' | 'NOT_APPLICABLE' | 'OBSERVED'
export type PredictionErrorDirection = 'better_than_predicted' | 'worse_than_predicted' | 'matched' | 'unknown'
export interface CeoRecommendation { schemaVersion: 3 | 4; correlationId: string; recommendationId: string; objective: string; decisionRationale: string; predictedOutcome: string | null; predictionHorizon: string | null; predictionEligibility: PredictionEligibility; predictionStatus: PredictionStatus; recommendedAction: string; responseAction: string; recordedAt: number
  // Additive in schemaVersion 4. Executive causal spine (2026-09-12): links a recommendation to
  // the strategy item, venture, and accountable leader it serves, so the CEO's decision context
  // can finally answer "which objective is this decision for, and who owns it" instead of only
  // "what did we decide." All three are null until a genuine, non-fabricated signal for them
  // exists at the write site -- ventureId is extractable from the current turn today; strategyId
  // and accountableLeaderId stay null until a real decision-to-strategy-item matching mechanism
  // exists, the same "honestly unavailable, never inferred" discipline ceo-executive-state.ts's
  // vision field already uses.
  strategyId: string | null
  ventureId: string | null
  accountableLeaderId: string | null
  // When set, this decision is due for executive review by this timestamp. Nothing currently
  // populates it (no scheduling mechanism exists yet) -- it exists so summarizeRecommendationLedger
  // below has a real, honest field to compute "overdue" from once one does, rather than a count
  // that can never be anything but a fabricated zero.
  reviewAt: number | null
}
export interface CeoRecommendationAction { actionId: string; recommendationId: string; description: string; status: 'PLANNED' | 'EXECUTED' | 'NOT_EXECUTED' | 'UNKNOWN'; observedAt: number | null }
export interface ObservedRecommendationOutcome { outcomeId: string; recommendationId: string; observedOutcome: string; actualResult: string; observedAt: number; source: string; metadata: Record<string, unknown> }
export interface RecommendationPredictionError { recommendationId: string; predictionStatus: PredictionStatus; errorMagnitude: number | null; direction: PredictionErrorDirection; explanation: string }
export interface RecommendationOutcomeCorrelation { correlationId: string; recommendation: CeoRecommendation | null; action: CeoRecommendationAction | null; outcomes: ObservedRecommendationOutcome[]; predictionError: RecommendationPredictionError | null; hasVerifiedOutcome: boolean; hasPredictedOutcome: boolean }
function stableId(prefix: string, ...parts: string[]): string { const digest = createHash('sha256').update(parts.map((part) => part.trim()).join('|')).digest('hex').slice(0, 24); return `${prefix}_${digest}` }
export function generateRecommendationCorrelationId(): string { return stableId('ceo_rec', `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`) }
function predictionEligible(responseAction: string, explicit?: PredictionEligibility): PredictionEligibility { if (explicit) return explicit; return responseAction === 'recommend' || responseAction === 'decide' ? 'ELIGIBLE' : 'NOT_APPLICABLE' }
function isMeaningfulPrediction(value: string | null | undefined): value is string { if (!value) return false; const text = value.replace(/\s+/g, ' ').trim(); if (text.length < 8 || text.length > 2000) return false; if (/^(?:it depends|unclear|unknown|not sure|cannot predict|can\s*not predict|there is not enough information|insufficient information|n\/a|not predictable)\.?$/i.test(text)) return false; const measurableSignal = /\d|%|\$|€|£|\b(?:increase|increases|decrease|decreases|grow|grows|reduce|reduces|reach|reaches|retain|retains|improve|improves|convert|converts|close|closes|complete|completes|deliver|delivers|remain|remains|fall|falls|rise|rises|hit|hits|exceed|exceeds|miss|misses|generate|generates|earn|earns|save|saves)\b/i.test(text); const outcomeContext = /\b(?:will|should|expected|expect|projected|likely|forecast|result|outcome|revenue|conversion|retention|cost|latency|completion|growth|sales|profit|users?|customers?|rate|margin|cash|time|days?|weeks?|months?|quarter)\b/i.test(text); return measurableSignal && outcomeContext }
async function capturePredictedOutcome(input: { objective: string; recommendedAction: string; responseAction: string }): Promise<string | null> { try { const { runCanonicalLlm } = await import('./canonical-llm-router'); const result = await runCanonicalLlm({ messages: [{ role: 'system', content: 'Produce exactly one meaningful, observable predicted outcome for this recommendation. It must describe a measurable or externally observable result and a reasonable horizon when the objective provides one. Do not invent facts, guarantees, fabricated numbers, or certainty. If no defensible outcome can be predicted from the supplied information, return exactly NOT_PREDICTABLE.' }, { role: 'user', content: `Objective: ${input.objective.slice(0, 3500)}\nAction class: ${input.responseAction}\nRecommended action: ${input.recommendedAction.slice(0, 7000)}` }], taskType: 'reasoning', executionClass: 'fast', temperature: 0, maxTokens: 120, timeoutMs: 5000, maxProviderAttempts: 1 }); const prediction = result.content.trim().replace(/^[-*]\s+/, '').replace(/^Prediction:\s*/i, '').trim(); return /^NOT_PREDICTABLE\.?$/i.test(prediction) || !isMeaningfulPrediction(prediction) ? null : prediction.slice(0, 2000) } catch { return null } }
export function buildRecommendationRecord(input: { correlationId: string; objective: string; responseAction: string; decisionRationale?: string; predictedOutcome?: string | null; predictionHorizon?: string | null; predictionEligibility?: PredictionEligibility; recommendedAction?: string; recordedAt?: number; strategyId?: string | null; ventureId?: string | null; accountableLeaderId?: string | null; reviewAt?: number | null }): CeoRecommendation { if (!input.correlationId.trim() || !input.objective.trim() || !input.responseAction.trim()) throw new Error('Recommendation requires correlationId, objective and responseAction.'); if (input.recordedAt !== undefined && !Number.isFinite(input.recordedAt)) throw new Error('Recommendation recordedAt must be a finite timestamp.'); const eligibility = predictionEligible(input.responseAction.trim(), input.predictionEligibility); const candidatePrediction = input.predictedOutcome?.trim() || null; const predictedOutcome = eligibility === 'ELIGIBLE' && isMeaningfulPrediction(candidatePrediction) ? candidatePrediction : null; const recommendedAction = (input.recommendedAction?.trim() || input.responseAction.trim()).slice(0, 8000); return { schemaVersion: 4, correlationId: input.correlationId.trim(), recommendationId: input.correlationId.trim(), objective: input.objective.trim().slice(0, 4000), decisionRationale: (input.decisionRationale?.trim() || `Agent007 selected response action: ${input.responseAction.trim()}.`).slice(0, 5000), predictedOutcome, predictionHorizon: input.predictionHorizon?.trim() || null, predictionEligibility: eligibility, predictionStatus: eligibility === 'NOT_APPLICABLE' ? 'NOT_APPLICABLE' : predictedOutcome ? 'PREDICTED' : 'NOT_CAPTURED', recommendedAction, responseAction: input.responseAction.trim(), recordedAt: input.recordedAt ?? Date.now(), strategyId: input.strategyId?.trim() || null, ventureId: input.ventureId?.trim() || null, accountableLeaderId: input.accountableLeaderId?.trim() || null, reviewAt: input.reviewAt ?? null } }
export async function recordCeoRecommendation(input: Parameters<typeof buildRecommendationRecord>[0]): Promise<CeoRecommendation> { const initial = buildRecommendationRecord(input); const predictedOutcome = initial.predictionEligibility === 'ELIGIBLE' ? (initial.predictedOutcome ?? await capturePredictedOutcome({ objective: initial.objective, recommendedAction: initial.recommendedAction, responseAction: initial.responseAction })) : null; const record = predictedOutcome && isMeaningfulPrediction(predictedOutcome) ? { ...initial, predictedOutcome, predictionStatus: 'PREDICTED' as const } : initial; const { db } = await import('./db'); const key = `ceo_recommendation_${record.correlationId}`; const existing = await db.memory.findUnique({ where: { key } }); if (existing) { const prior = JSON.parse(existing.value) as CeoRecommendation; const priorEligibility = prior.predictionEligibility ?? predictionEligible(prior.responseAction); const immutableMismatch = prior.correlationId !== record.correlationId || prior.objective !== record.objective || prior.responseAction !== record.responseAction || prior.recommendedAction !== record.recommendedAction || priorEligibility !== record.predictionEligibility; if (immutableMismatch) throw new Error(`Conflicting CEO recommendation already exists for ${record.correlationId}.`); if (!prior.predictedOutcome && record.predictedOutcome) { await db.memory.update({ where: { key }, data: { value: JSON.stringify(record), category: 'ceo_recommendation' } }); return record } return { ...prior, predictionEligibility: priorEligibility, predictionStatus: prior.predictionStatus ?? (priorEligibility === 'NOT_APPLICABLE' ? 'NOT_APPLICABLE' : prior.predictedOutcome ? 'PREDICTED' : 'NOT_CAPTURED') } } await db.memory.create({ data: { key, value: JSON.stringify(record), category: 'ceo_recommendation' } }); await recordRecommendationAction({ recommendationId: record.recommendationId, description: record.recommendedAction }); try { const { startContinuousLoop } = await import('./ceo-continuous-loop'); await startContinuousLoop({ recommendationId: record.recommendationId, evidence: [`recommendation:${record.recommendationId}`] }) } catch (error) { console.warn('[ceo-recommendation] continuous-loop initialization failed:', error instanceof Error ? error.message.slice(0, 180) : String(error)) } return record }
export async function recordRecommendationAction(input: { recommendationId: string; description: string; status?: CeoRecommendationAction['status']; observedAt?: number | null }): Promise<CeoRecommendationAction> { if (!input.recommendationId.trim() || !input.description.trim()) throw new Error('Recommendation action requires recommendationId and description.'); if (input.observedAt !== undefined && input.observedAt !== null && !Number.isFinite(input.observedAt)) throw new Error('Recommendation action observedAt must be a finite timestamp.'); const action: CeoRecommendationAction = { actionId: stableId('ceo_action', input.recommendationId, input.description), recommendationId: input.recommendationId.trim(), description: input.description.trim().slice(0, 8000), status: input.status ?? 'PLANNED', observedAt: input.observedAt ?? null }; const { db } = await import('./db'); const key = `ceo_recommendation_action:${action.actionId}`; const existing = await db.memory.findUnique({ where: { key } }); if (existing) { const prior = JSON.parse(existing.value) as CeoRecommendationAction; if (prior.recommendationId !== action.recommendationId || prior.description !== action.description) throw new Error(`Conflicting CEO recommendation action already exists for ${action.actionId}.`); return prior } await db.memory.create({ data: { key, value: JSON.stringify(action), category: 'ceo_recommendation_action' } }); return action }
export function buildObservedRecommendationOutcome(input: { recommendationId: string; observedOutcome: string; actualResult: string; observedAt?: number; source: string; metadata?: Record<string, unknown> }): ObservedRecommendationOutcome { if (!input.recommendationId.trim() || !input.observedOutcome.trim() || !input.actualResult.trim() || !input.source.trim()) throw new Error('Observed recommendation outcome requires recommendationId, observedOutcome, actualResult and source.'); const observedAt = input.observedAt ?? Date.now(); if (!Number.isFinite(observedAt)) throw new Error('Observed recommendation outcome observedAt must be a finite timestamp.'); return { outcomeId: stableId('ceo_observed_outcome', input.recommendationId, input.observedOutcome, input.actualResult, String(observedAt), input.source), recommendationId: input.recommendationId.trim(), observedOutcome: input.observedOutcome.trim().slice(0, 5000), actualResult: input.actualResult.trim().slice(0, 5000), observedAt, source: input.source.trim().slice(0, 1000), metadata: input.metadata ?? {} } }
export async function recordObservedRecommendationOutcome(input: Parameters<typeof buildObservedRecommendationOutcome>[0]): Promise<ObservedRecommendationOutcome> { const outcome = buildObservedRecommendationOutcome(input); const { db } = await import('./db'); const key = `ceo_observed_outcome:${outcome.outcomeId}`; const existing = await db.memory.findUnique({ where: { key } }); if (existing) { const prior = JSON.parse(existing.value) as ObservedRecommendationOutcome; if (prior.recommendationId !== outcome.recommendationId || prior.actualResult !== outcome.actualResult || prior.source !== outcome.source) throw new Error(`Conflicting observed recommendation outcome already exists for ${outcome.outcomeId}.`); return prior } await db.memory.create({ data: { key, value: JSON.stringify(outcome), category: 'ceo_observed_outcome' } }); return outcome }

export interface SustainedOutcomeClosureResult { recommendationId: string; ventureId: string; sustained: boolean; outcome: ObservedRecommendationOutcome }
// Executive causal spine (2026-09-12), Phase 3: connects ceo-sustained-outcome.ts's own assessment
// -- "did several independently persisted KPI windows show real, non-synthetic positive revenue" --
// to the same outcome ledger buildCeoDegradedResponse etc. already read, instead of building a
// second sustained-outcome calculator. Deliberately requires an explicit recommendationId: this
// never scans for "the open decision for this venture" to close, because a venture can have more
// than one open decision and a fuzzy match can close the wrong one. If the assessment found no KPI
// windows at all, this fails closed and records nothing -- an inconclusive assessment must never be
// recorded as a positive or negative outcome. This function only ever writes evidence; it never
// changes autonomy level, strategy, or allocation itself (see docs/executive-decision-ledger-phase-4.md
// for why that stays a separate, explicitly-gated future step).
export async function closeRecommendationWithSustainedOutcome(input: { recommendationId: string; ventureId: string; windows?: number }): Promise<SustainedOutcomeClosureResult | null> {
  const recommendationId = input.recommendationId.trim()
  const ventureId = input.ventureId.trim()
  if (!recommendationId || !ventureId) throw new Error('Closing a recommendation with a sustained-outcome assessment requires recommendationId and ventureId.')
  const { assessSustainedBusinessOutcome } = await import('./ceo-sustained-outcome')
  const assessment = await assessSustainedBusinessOutcome(ventureId, input.windows ?? 3)
  if (assessment.windowsFound === 0) return null
  const outcome = await recordObservedRecommendationOutcome({
    recommendationId,
    observedOutcome: assessment.sustained ? 'Sustained, non-synthetic positive business outcome confirmed across independently persisted KPI windows.' : 'Business outcome assessment did not confirm a sustained positive result.',
    actualResult: `${assessment.positiveWindows}/${assessment.windowsFound} positive windows observed (${assessment.windowsRequested} requested); ${assessment.regressedWindows} regressed.`,
    source: 'ceo_sustained_outcome_assessment',
    metadata: { ventureId: assessment.ventureId, windowsRequested: assessment.windowsRequested, windowsFound: assessment.windowsFound, positiveWindows: assessment.positiveWindows, regressedWindows: assessment.regressedWindows, sustained: assessment.sustained },
  })
  return { recommendationId, ventureId, sustained: assessment.sustained, outcome }
}
// Read-only helper so a human, or a future explicitly-gated flow, can see which open decisions for a
// venture are candidates for closeRecommendationWithSustainedOutcome() -- it never picks one itself.
export async function listOpenRecommendationsForVenture(ventureId: string): Promise<readonly CeoRecommendation[]> {
  const trimmed = ventureId.trim()
  if (!trimmed) return []
  try {
    const { db } = await import('./db')
    const [recommendationRecords, observedOutcomeRecords, businessOutcomeRecords] = await Promise.all([
      db.memory.findMany({ where: { category: 'ceo_recommendation' } }).catch(() => []),
      db.memory.findMany({ where: { category: 'ceo_observed_outcome' } }).catch(() => []),
      db.memory.findMany({ where: { category: 'architecture_business_outcome' } }).catch(() => []),
    ])
    const outcomeRecommendationIds = new Set<string>()
    for (const record of [...observedOutcomeRecords, ...businessOutcomeRecords]) {
      try {
        const parsed = JSON.parse(record.value) as { recommendationId?: string; recommendationCorrelationId?: string; revenueCorrelationId?: string }
        const linked = parsed.recommendationId ?? parsed.recommendationCorrelationId ?? parsed.revenueCorrelationId
        if (linked) outcomeRecommendationIds.add(linked)
      } catch {}
    }
    const open: CeoRecommendation[] = []
    for (const record of recommendationRecords) {
      try {
        const parsed = JSON.parse(record.value) as CeoRecommendation
        if (parsed.ventureId !== trimmed) continue
        const id = parsed.correlationId ?? parsed.recommendationId
        if (id && outcomeRecommendationIds.has(id)) continue
        open.push(parsed)
      } catch {}
    }
    return open.sort((a, b) => b.recordedAt - a.recordedAt)
  } catch {
    return []
  }
}
export function calculateRecommendationPredictionError(recommendation: CeoRecommendation | null, outcome: ObservedRecommendationOutcome | null): RecommendationPredictionError | null { if (!recommendation || !outcome) return null; const status = recommendation.predictionStatus ?? (recommendation.predictedOutcome ? 'PREDICTED' : 'NOT_CAPTURED'); if (status !== 'PREDICTED' || !recommendation.predictedOutcome) return { recommendationId: recommendation.recommendationId, predictionStatus: status, errorMagnitude: null, direction: 'unknown', explanation: status === 'NOT_APPLICABLE' ? 'This recommendation was explicitly marked not applicable for prediction.' : 'No meaningful prediction was captured, so prediction error cannot be measured.' }; const predicted = recommendation.predictedOutcome.toLowerCase().trim(); const actual = outcome.actualResult.toLowerCase().trim(); if (predicted === actual) return { recommendationId: recommendation.recommendationId, predictionStatus: status, errorMagnitude: 0, direction: 'matched', explanation: 'Observed actual result matches the captured prediction text.' }; const predictedNumbers = [...predicted.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0])).filter(Number.isFinite); const actualNumbers = [...actual.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0])).filter(Number.isFinite); if (predictedNumbers.length && actualNumbers.length) { const errorMagnitude = Math.abs(actualNumbers[0] - predictedNumbers[0]); return { recommendationId: recommendation.recommendationId, predictionStatus: status, errorMagnitude, direction: actualNumbers[0] === predictedNumbers[0] ? 'matched' : actualNumbers[0] > predictedNumbers[0] ? 'better_than_predicted' : 'worse_than_predicted', explanation: `Numeric prediction error is ${errorMagnitude}.` } } return { recommendationId: recommendation.recommendationId, predictionStatus: status, errorMagnitude: null, direction: 'unknown', explanation: 'Prediction and actual result differ, but no reliable numeric error can be calculated.' } }
export function correlateRecommendationOutcomes(correlationId: string, recommendationRecords: { value: string }[], outcomeRecords: { value: string }[], actionRecords: { value: string }[] = [], observedOutcomeRecords: { value: string }[] = []): RecommendationOutcomeCorrelation { let recommendation: CeoRecommendation | null = null; for (const record of recommendationRecords) { try { const parsed = JSON.parse(record.value) as Partial<CeoRecommendation>; if (parsed.correlationId === correlationId) { const normalized = buildRecommendationRecord({ correlationId, objective: parsed.objective ?? '', responseAction: parsed.responseAction ?? '', predictionEligibility: parsed.predictionEligibility, predictedOutcome: parsed.predictedOutcome, predictionHorizon: parsed.predictionHorizon, recommendedAction: parsed.recommendedAction, decisionRationale: parsed.decisionRationale, recordedAt: parsed.recordedAt, strategyId: parsed.strategyId, ventureId: parsed.ventureId, accountableLeaderId: parsed.accountableLeaderId, reviewAt: parsed.reviewAt }); recommendation = { ...normalized, ...parsed, predictionEligibility: parsed.predictionEligibility ?? normalized.predictionEligibility, predictionStatus: parsed.predictionStatus ?? normalized.predictionStatus, recommendationId: parsed.recommendationId ?? correlationId, schemaVersion: parsed.schemaVersion ?? 2 } as CeoRecommendation; break } } catch {} } let action: CeoRecommendationAction | null = null; for (const record of actionRecords) { try { const parsed = JSON.parse(record.value) as CeoRecommendationAction; if (parsed.recommendationId === correlationId) { action = parsed; break } } catch {} } const outcomes: ObservedRecommendationOutcome[] = []; for (const record of [...outcomeRecords, ...observedOutcomeRecords]) { try { const parsed = JSON.parse(record.value) as Partial<ObservedRecommendationOutcome> & { revenueCorrelationId?: string; recommendationCorrelationId?: string; transactionId?: string; amount?: number; currency?: string; type?: string; occurredAt?: string }; const linked = parsed.recommendationId ?? parsed.recommendationCorrelationId ?? parsed.revenueCorrelationId; if (linked !== correlationId) continue; const observedAt = parsed.observedAt ?? (parsed.occurredAt ? Date.parse(parsed.occurredAt) : NaN); if (!Number.isFinite(observedAt)) continue; outcomes.push(parsed.observedOutcome && parsed.actualResult ? parsed as ObservedRecommendationOutcome : { outcomeId: stableId('legacy_outcome', correlationId, parsed.transactionId ?? '', String(parsed.amount ?? ''), parsed.occurredAt ?? ''), recommendationId: correlationId, observedOutcome: `${parsed.type ?? 'business outcome'} observed`, actualResult: `${parsed.amount ?? 'unknown'} ${parsed.currency ?? ''}`.trim(), observedAt, source: 'architecture_business_outcome', metadata: parsed as Record<string, unknown> }) } catch {} } const uniqueOutcomes = [...new Map(outcomes.map((outcome) => [outcome.outcomeId, outcome])).values()].sort((a, b) => b.observedAt - a.observedAt); return { correlationId, recommendation, action, outcomes: uniqueOutcomes, predictionError: calculateRecommendationPredictionError(recommendation, uniqueOutcomes[0] ?? null), hasVerifiedOutcome: uniqueOutcomes.length > 0, hasPredictedOutcome: recommendation?.predictionStatus === 'PREDICTED' } }
export async function getRecommendationOutcomeCorrelation(correlationId: string): Promise<RecommendationOutcomeCorrelation> { if (!correlationId.trim()) throw new Error('Recommendation correlationId is required.'); try { const { db } = await import('./db'); const [recommendationRecords, outcomeRecords, actionRecords, observedOutcomeRecords] = await Promise.all([db.memory.findMany({ where: { category: 'ceo_recommendation' } }).catch(() => []), db.memory.findMany({ where: { category: 'architecture_business_outcome' } }).catch(() => []), db.memory.findMany({ where: { category: 'ceo_recommendation_action' } }).catch(() => []), db.memory.findMany({ where: { category: 'ceo_observed_outcome' } }).catch(() => [])]); return correlateRecommendationOutcomes(correlationId, recommendationRecords, outcomeRecords, actionRecords, observedOutcomeRecords) } catch { return { correlationId, recommendation: null, action: null, outcomes: [], predictionError: null, hasVerifiedOutcome: false, hasPredictedOutcome: false } } }

export type RecommendationMissionRelation = 'implements' | 'validates' | 'remediates' | 'monitors'
export interface RecommendationMissionLinkRecord { id: string; recommendationId: string; missionId: string; relation: RecommendationMissionRelation; createdAt: string }
// Executive causal spine (2026-09-12), Phase 2: the RecommendationMissionLink table is the one
// place this file's storage genuinely benefits from a relational Prisma model instead of the
// Memory-JSON pattern used everywhere else here -- it's a real one-to-many join (one decision can
// produce several missions) that needs indexed lookup by either side. Written only when a
// recommendationId is explicitly supplied by the caller (see /api/mission-active's create action) --
// never inferred, never backfilled onto missions that already existed before this linkage existed.
// upsert's `update: {}` is deliberate: a retried link call is idempotent, but it can never silently
// change an existing link's relation type on a later call with different arguments.
export async function linkRecommendationToMission(input: { recommendationId: string; missionId: string; relation?: RecommendationMissionRelation }): Promise<RecommendationMissionLinkRecord> {
  const recommendationId = input.recommendationId.trim()
  const missionId = input.missionId.trim()
  if (!recommendationId || !missionId) throw new Error('Linking a recommendation to a mission requires recommendationId and missionId.')
  const { db } = await import('./db')
  const relation = input.relation ?? 'implements'
  const row = await db.recommendationMissionLink.upsert({
    where: { recommendationId_missionId: { recommendationId, missionId } },
    update: {},
    create: { recommendationId, missionId, relation },
  })
  return { id: row.id, recommendationId: row.recommendationId, missionId: row.missionId, relation: row.relation as RecommendationMissionRelation, createdAt: row.createdAt.toISOString() }
}
export async function listMissionsForRecommendation(recommendationId: string): Promise<readonly RecommendationMissionLinkRecord[]> {
  const trimmed = recommendationId.trim()
  if (!trimmed) return []
  const { db } = await import('./db')
  const rows = await db.recommendationMissionLink.findMany({ where: { recommendationId: trimmed }, orderBy: { createdAt: 'asc' } }).catch(() => [])
  return rows.map((row) => ({ id: row.id, recommendationId: row.recommendationId, missionId: row.missionId, relation: row.relation as RecommendationMissionRelation, createdAt: row.createdAt.toISOString() }))
}

export interface RecommendationLedgerSummary { total: number; open: number; awaitingOutcome: number; overdueReview: number }
const EMPTY_RECOMMENDATION_LEDGER_SUMMARY: RecommendationLedgerSummary = { total: 0, open: 0, awaitingOutcome: 0, overdueReview: 0 }
// Executive causal spine (2026-09-12): a read-only aggregate over the same durable recommendation/
// outcome records getRecommendationOutcomeCorrelation() already reads one-at-a-time, so
// ceo-executive-state.ts and ceo-strategic-horizon.ts can finally show "how many decisions are open"
// without either subsystem inventing a second decision store. "Open" means no observed outcome has
// been linked yet by correlationId -- never inferred from elapsed time or venture/mission proximity,
// since that kind of fuzzy match is exactly how the wrong decision gets closed by the wrong outcome.
export async function summarizeRecommendationLedger(filter: { strategyId?: string; ventureId?: string } = {}): Promise<RecommendationLedgerSummary> {
  try {
    const { db } = await import('./db')
    const [recommendationRecords, observedOutcomeRecords, businessOutcomeRecords] = await Promise.all([
      db.memory.findMany({ where: { category: 'ceo_recommendation' } }).catch(() => []),
      db.memory.findMany({ where: { category: 'ceo_observed_outcome' } }).catch(() => []),
      db.memory.findMany({ where: { category: 'architecture_business_outcome' } }).catch(() => []),
    ])
    const outcomeRecommendationIds = new Set<string>()
    for (const record of [...observedOutcomeRecords, ...businessOutcomeRecords]) {
      try {
        const parsed = JSON.parse(record.value) as { recommendationId?: string; recommendationCorrelationId?: string; revenueCorrelationId?: string }
        const linked = parsed.recommendationId ?? parsed.recommendationCorrelationId ?? parsed.revenueCorrelationId
        if (linked) outcomeRecommendationIds.add(linked)
      } catch {}
    }
    const now = Date.now()
    let summary = { ...EMPTY_RECOMMENDATION_LEDGER_SUMMARY }
    for (const record of recommendationRecords) {
      try {
        const parsed = JSON.parse(record.value) as Partial<CeoRecommendation>
        if (filter.strategyId && parsed.strategyId !== filter.strategyId) continue
        if (filter.ventureId && parsed.ventureId !== filter.ventureId) continue
        const id = parsed.correlationId ?? parsed.recommendationId
        if (!id) continue
        summary = { ...summary, total: summary.total + 1 }
        const hasOutcome = outcomeRecommendationIds.has(id)
        if (!hasOutcome) summary = { ...summary, open: summary.open + 1, awaitingOutcome: summary.awaitingOutcome + 1 }
        if (parsed.reviewAt && parsed.reviewAt < now && !hasOutcome) summary = { ...summary, overdueReview: summary.overdueReview + 1 }
      } catch {}
    }
    return summary
  } catch {
    return EMPTY_RECOMMENDATION_LEDGER_SUMMARY
  }
}
