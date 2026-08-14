/**
 * Commercial Causal Engine
 *
 * Produces explicit, testable causal hypotheses from observed commercial
 * changes. It never labels correlation as proven causation: hypotheses carry
 * confidence, assumptions, confounders and an explicit lifecycle.
 */
import { createHash } from 'node:crypto'
import { db } from './db'
import { isCommercialBusiness, type CommercialBusiness } from './commercial-control-plane'
import { rememberCommercial } from './commercial-memory'
import { upsertCommercialWorldRelation } from './commercial-world-model'

export type CausalObservationKind = 'metric' | 'event' | 'intervention' | 'outcome'
export type CausalHypothesisStatus = 'candidate' | 'supported' | 'refuted' | 'inconclusive'

export interface CommercialCausalObservation {
  observationId: string
  tenantId: string
  business: CommercialBusiness
  kind: CausalObservationKind
  metric: string
  entityType: string
  entityId: string | null
  value: number | null
  occurredAt: string
  source: string
  evidenceIds: string[]
  dimensions: Record<string, string | number | boolean | null>
}

export interface CommercialCausalHypothesis {
  hypothesisId: string
  tenantId: string
  business: CommercialBusiness
  causeObservationId: string
  effectObservationId: string
  statement: string
  direction: 'positive' | 'negative' | 'unknown'
  lagMs: number
  effectDelta: number | null
  confidence: number
  status: CausalHypothesisStatus
  assumptions: string[]
  confounders: string[]
  evidenceIds: string[]
  createdAt: string
  updatedAt: string
}

export interface CausalAnalysisResult {
  hypothesis: CommercialCausalHypothesis
  warnings: string[]
}

const OBSERVATION_CATEGORY = 'commercial_causal_observation'
const HYPOTHESIS_CATEGORY = 'commercial_causal_hypothesis'
const clean = (value: string) => value.trim().replace(/\s+/g, ' ')
const now = () => new Date().toISOString()
const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
const observationKey = (tenantId: string, observationId: string) => `commercial-causal:observation:${tenantId}:${observationId}`
const hypothesisKey = (tenantId: string, cause: string, effect: string) => `commercial-causal:hypothesis:${tenantId}:${cause}:${effect}`

function parse<T>(value: string): T | null { try { return JSON.parse(value) as T } catch { return null } }

async function readObservations(tenantId: string): Promise<CommercialCausalObservation[]> {
  const rows = await db.memory.findMany({ where: { category: OBSERVATION_CATEGORY }, orderBy: { createdAt: 'desc' }, take: 5000 })
  return rows.map((row) => parse<CommercialCausalObservation>(row.value)).filter((value): value is CommercialCausalObservation => !!value && value.tenantId === tenantId)
}

async function readHypotheses(tenantId: string): Promise<CommercialCausalHypothesis[]> {
  const rows = await db.memory.findMany({ where: { category: HYPOTHESIS_CATEGORY }, orderBy: { createdAt: 'desc' }, take: 5000 })
  return rows.map((row) => parse<CommercialCausalHypothesis>(row.value)).filter((value): value is CommercialCausalHypothesis => !!value && value.tenantId === tenantId)
}

export async function recordCommercialCausalObservation(input: Omit<CommercialCausalObservation, 'observationId'> & { observationId?: string }): Promise<{ created: boolean; observation: CommercialCausalObservation }> {
  if (!input.tenantId.trim() || !isCommercialBusiness(input.business) || !clean(input.metric) || !clean(input.source)) throw new Error('tenantId, business, metric, and source are required.')
  const observationId = input.observationId?.trim() || `cco_${createHash('sha256').update(`${input.tenantId}|${input.business}|${input.metric}|${input.entityId ?? ''}|${input.occurredAt}|${JSON.stringify(input.dimensions)}`).digest('hex').slice(0, 24)}`
  const observation: CommercialCausalObservation = { ...input, observationId, metric: clean(input.metric), source: clean(input.source), entityType: clean(input.entityType), evidenceIds: [...new Set(input.evidenceIds.map(clean).filter(Boolean))], dimensions: input.dimensions ?? {} }
  const existing = await db.memory.findUnique({ where: { key: observationKey(input.tenantId, observationId) } })
  if (existing) {
    const current = parse<CommercialCausalObservation>(existing.value)
    if (!current) throw new Error('Causal observation record is corrupt.')
    return { created: false, observation: current }
  }
  await db.memory.create({ data: { key: observationKey(input.tenantId, observationId), category: OBSERVATION_CATEGORY, value: JSON.stringify(observation) } })
  return { created: true, observation }
}

function inferDirection(cause: CommercialCausalObservation, effect: CommercialCausalObservation): { direction: CommercialCausalHypothesis['direction']; delta: number | null } {
  if (cause.value === null || effect.value === null) return { direction: 'unknown', delta: null }
  const delta = effect.value - cause.value
  if (delta === 0) return { direction: 'unknown', delta: 0 }
  return { direction: delta > 0 ? 'positive' : 'negative', delta }
}

export async function analyzeCommercialCausality(input: { tenantId: string; business: CommercialBusiness; causeObservationId: string; effectObservationId: string; assumptions?: string[]; confounders?: string[] }): Promise<CausalAnalysisResult> {
  if (!input.tenantId.trim() || !isCommercialBusiness(input.business)) throw new Error('Valid tenant context is required.')
  const observations = await readObservations(input.tenantId)
  const cause = observations.find((item) => item.observationId === input.causeObservationId)
  const effect = observations.find((item) => item.observationId === input.effectObservationId)
  if (!cause || !effect) throw new Error('Both causal observations must exist.')
  const causeTime = new Date(cause.occurredAt).getTime()
  const effectTime = new Date(effect.occurredAt).getTime()
  if (!Number.isFinite(causeTime) || !Number.isFinite(effectTime)) throw new Error('Causal observation timestamps must be valid ISO dates.')
  const lagMs = effectTime - causeTime
  const warnings: string[] = []
  if (lagMs < 0) warnings.push('Effect precedes cause; temporal ordering does not support this hypothesis.')
  if (cause.metric === effect.metric && cause.entityId === effect.entityId) warnings.push('Cause and effect are the same metric/entity; this is not sufficient for a causal claim.')
  const directionResult = inferDirection(cause, effect)
  const evidenceIds = [...new Set([...cause.evidenceIds, ...effect.evidenceIds])]
  const assumptions = [...new Set((input.assumptions ?? []).map(clean).filter(Boolean))]
  const confounders = [...new Set((input.confounders ?? []).map(clean).filter(Boolean))]
  let confidence = 0.35
  if (lagMs >= 0) confidence += 0.15
  if (cause.entityId && effect.entityId && cause.entityId === effect.entityId) confidence += 0.1
  if (cause.value !== null && effect.value !== null) confidence += 0.15
  if (evidenceIds.length > 0) confidence += Math.min(0.15, evidenceIds.length * 0.03)
  if (confounders.length > 0) confidence -= Math.min(0.2, confounders.length * 0.05)
  if (lagMs < 0) confidence -= 0.3
  const status: CausalHypothesisStatus = lagMs < 0 ? 'inconclusive' : confidence >= 0.75 ? 'supported' : 'candidate'
  const hypothesisId = `cch_${createHash('sha256').update(`${input.tenantId}|${input.causeObservationId}|${input.effectObservationId}`).digest('hex').slice(0, 24)}`
  const hypothesis: CommercialCausalHypothesis = {
    hypothesisId,
    tenantId: input.tenantId,
    business: input.business,
    causeObservationId: cause.observationId,
    effectObservationId: effect.observationId,
    statement: `The ${cause.metric} observation may have contributed to the ${effect.metric} outcome ${lagMs >= 0 ? `after ${Math.round(lagMs / 1000)} seconds` : 'despite reversed temporal order'}.`,
    direction: directionResult.direction,
    lagMs,
    effectDelta: directionResult.delta,
    confidence: clamp(confidence),
    status,
    assumptions,
    confounders,
    evidenceIds,
    createdAt: now(),
    updatedAt: now(),
  }
  const existing = await db.memory.findUnique({ where: { key: hypothesisKey(input.tenantId, cause.observationId, effect.observationId) } })
  if (existing) {
    const current = parse<CommercialCausalHypothesis>(existing.value)
    if (!current) throw new Error('Causal hypothesis record is corrupt.')
    return { hypothesis: current, warnings }
  }
  await db.memory.create({ data: { key: hypothesisKey(input.tenantId, cause.observationId, effect.observationId), category: HYPOTHESIS_CATEGORY, value: JSON.stringify(hypothesis) } })
  await rememberCommercial({ tenantId: input.tenantId, business: input.business, scope: 'causal-intelligence', kind: 'lesson', subjectType: 'causal_hypothesis', subjectId: hypothesis.hypothesisId, statement: hypothesis.statement, source: 'commercial-causal-engine', evidenceIds, confidence: hypothesis.confidence, importance: hypothesis.confidence, tags: ['causal', hypothesis.status], occurredAt: hypothesis.createdAt })
  if (cause.entityId && effect.entityId) {
    await upsertCommercialWorldRelation({ tenantId: input.tenantId, business: input.business, fromEntityId: cause.entityId, toEntityId: effect.entityId, type: 'resulted_in', confidence: hypothesis.confidence, source: 'commercial-causal-engine' }).catch(() => undefined)
  }
  return { hypothesis, warnings }
}

export async function evaluateCommercialCausalOutcome(input: { tenantId: string; hypothesisId: string; outcome: 'supported' | 'refuted' | 'inconclusive'; evidenceIds?: string[] }): Promise<CommercialCausalHypothesis | null> {
  const hypotheses = await readHypotheses(input.tenantId)
  const current = hypotheses.find((item) => item.hypothesisId === input.hypothesisId)
  if (!current) return null
  const delta = input.outcome === 'supported' ? 0.1 : input.outcome === 'refuted' ? -0.15 : -0.02
  const updated: CommercialCausalHypothesis = { ...current, status: input.outcome, confidence: clamp(current.confidence + delta), evidenceIds: [...new Set([...current.evidenceIds, ...(input.evidenceIds ?? [])])], updatedAt: now() }
  const record = await db.memory.findUnique({ where: { key: hypothesisKey(input.tenantId, current.causeObservationId, current.effectObservationId) } })
  if (!record) throw new Error('Causal hypothesis persistence record is missing.')
  await db.memory.update({ where: { id: record.id }, data: { value: JSON.stringify(updated) } })
  return updated
}

export async function listCommercialCausalHypotheses(tenantId: string, business?: CommercialBusiness, limit = 50): Promise<CommercialCausalHypothesis[]> {
  return (await readHypotheses(tenantId)).filter((item) => !business || item.business === business).slice(0, Math.min(Math.max(limit, 1), 200))
}

export function validateCommercialCausalContracts(): string[] {
  const errors: string[] = []
  const statuses: CausalHypothesisStatus[] = ['candidate', 'supported', 'refuted', 'inconclusive']
  const kinds: CausalObservationKind[] = ['metric', 'event', 'intervention', 'outcome']
  if (new Set(statuses).size !== statuses.length || new Set(kinds).size !== kinds.length) errors.push('Causal taxonomies contain duplicates.')
  return errors
}
