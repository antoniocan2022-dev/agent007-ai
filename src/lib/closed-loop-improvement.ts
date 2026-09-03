import { db } from './db'
import type { MissionTelemetry } from './mission-telemetry'
import type { AuditReport } from './executive-audit-engine'
import { buildLearningCandidate, persistLearningCandidate } from './ceo-behavioral-learning'

export const runtime = 'nodejs'
export type InitiativeStatus = 'proposed' | 'simulated' | 'approved' | 'active' | 'measuring' | 'verified' | 'rejected' | 'rolled_back'
export type InitiativeVerdict = 'improved' | 'no_change' | 'worsened' | null
export type ImprovementMetric = 'confidence' | 'duration' | 'verificationScore' | 'corrections' | 'retries' | 'errors' | 'tokens' | 'cost' | 'tools'

export interface ImprovementInitiative {
  schemaVersion: 2
  initiativeId: string
  recommendation: string
  source: string
  status: InitiativeStatus
  createdAt: string
  simulatedAt: string | null
  approvedAt: string | null
  appliedAt: string | null
  measuredAt: string | null
  verifiedAt: string | null
  resolvedAt: string | null
  targetMetric: ImprovementMetric
  targetDirection: 'increase' | 'decrease'
  baselineValue: number | null
  postValue: number | null
  improvementDelta: number | null
  verdict: InitiativeVerdict
  baselineMissionIds: string[]
  postMissionIds: string[]
  simulation: { ok: boolean; predictedDelta: number | null; notes: string; simulatedAt: string | null }
  approval: { required: true; approvedBy: string | null; reason: string | null }
  resolution: { decision: 'KEEP' | 'ROLLBACK' | null; reason: string | null }
  learningCandidateId: string | null
}

const SUPPORTED_METRICS = new Set<ImprovementMetric>(['confidence', 'duration', 'verificationScore', 'corrections', 'retries', 'errors', 'tokens', 'cost', 'tools'])
export function assertSupportedImprovementMetric(metric: string): asserts metric is ImprovementMetric { if (!SUPPORTED_METRICS.has(metric as ImprovementMetric)) throw new Error(`Unsupported improvement metric: ${metric}`) }
function initiativeKey(id: string): string { return `initiative:${id}` }
function newId(): string { return `initiative_${Date.now()}_${Math.random().toString(36).slice(2, 10)}` }

function computeMetric(mission: MissionTelemetry, metric: ImprovementMetric): number {
  switch (metric) {
    case 'confidence': return Number(mission.confidence ?? 0)
    case 'duration': return Number(mission.duration ?? 0)
    case 'verificationScore': return Number(mission.verificationScore ?? 0)
    case 'corrections': return Number(mission.executiveCorrections ?? 0)
    case 'retries': return Number(mission.retries ?? 0)
    case 'errors': return Number(mission.errors?.length ?? 0)
    case 'tokens': return Number(mission.tokensUsed ?? 0)
    case 'cost': return Number(mission.cost ?? 0)
    case 'tools': return Number(mission.toolCallCount ?? 0)
  }
}

async function getRecentMissionMetrics(limit: number): Promise<MissionTelemetry[]> {
  try {
    const records = await db.memory.findMany({ where: { category: 'mission_telemetry' }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit, 1), 100) })
    return records.map((record) => { try { return JSON.parse(record.value) as MissionTelemetry } catch { return null } }).filter((item): item is MissionTelemetry => item !== null)
  } catch { return [] }
}

async function getMissionsByIds(ids: string[]): Promise<MissionTelemetry[]> {
  if (!ids.length) return []
  try {
    const records = await db.memory.findMany({ where: { category: 'mission_telemetry', key: { in: ids } } })
    return records.map((record) => { try { return JSON.parse(record.value) as MissionTelemetry } catch { return null } }).filter((item): item is MissionTelemetry => item !== null)
  } catch { return [] }
}

export function validateMeasurementTelemetryCandidate(telemetry: MissionTelemetry): { ok: boolean; reason: string | null } {
  if (!telemetry.missionId?.trim()) return { ok: false, reason: 'Measurement telemetry requires missionId.' }
  if (!Number.isFinite(telemetry.startedAt)) return { ok: false, reason: 'Measurement telemetry requires a valid startedAt timestamp.' }
  if (telemetry.status === 'running') return { ok: false, reason: 'Measurement telemetry must be terminal (completed or failed).' }
  if (telemetry.completedAt !== null && !Number.isFinite(telemetry.completedAt)) return { ok: false, reason: 'Measurement telemetry completedAt must be null or a finite timestamp.' }
  if (telemetry.completedAt !== null && telemetry.completedAt < telemetry.startedAt) return { ok: false, reason: 'Measurement telemetry completedAt cannot precede startedAt.' }
  return { ok: true, reason: null }
}

async function persistMeasurementTelemetry(telemetry: MissionTelemetry): Promise<MissionTelemetry> {
  const validation = validateMeasurementTelemetryCandidate(telemetry)
  if (!validation.ok) throw new Error(validation.reason ?? 'Invalid measurement telemetry.')
  const existing = await db.memory.findUnique({ where: { key: telemetry.missionId } })
  if (existing) {
    if (existing.category !== 'mission_telemetry') throw new Error(`Mission ${telemetry.missionId} is already owned by category ${existing.category}.`)
    let canonical: MissionTelemetry
    try { canonical = JSON.parse(existing.value) as MissionTelemetry } catch { throw new Error(`Canonical mission telemetry is invalid for ${telemetry.missionId}.`) }
    if (canonical.missionId !== telemetry.missionId || canonical.startedAt !== telemetry.startedAt || canonical.status !== telemetry.status) throw new Error(`Measurement telemetry conflicts with canonical mission telemetry for ${telemetry.missionId}.`)
    return canonical
  }
  await db.memory.create({ data: { key: telemetry.missionId, value: JSON.stringify(telemetry), category: 'mission_telemetry' } })
  return telemetry
}

function computeMetricAverage(missions: MissionTelemetry[], metric: ImprovementMetric): number | null {
  if (!missions.length) return null
  const values = missions.map((mission) => computeMetric(mission, metric))
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export async function createInitiative(recommendation: string, source: string, targetMetric: string, targetDirection: 'increase' | 'decrease'): Promise<ImprovementInitiative> {
  if (!recommendation.trim()) throw new Error('Improvement initiative requires a recommendation.')
  if (!source.trim()) throw new Error('Improvement initiative requires a source.')
  assertSupportedImprovementMetric(targetMetric)
  const baselineMissions = await getRecentMissionMetrics(10)
  const initiative: ImprovementInitiative = {
    schemaVersion: 2,
    initiativeId: newId(),
    recommendation: recommendation.trim(),
    source: source.trim(),
    status: 'proposed',
    createdAt: new Date().toISOString(),
    simulatedAt: null,
    approvedAt: null,
    appliedAt: null,
    measuredAt: null,
    verifiedAt: null,
    resolvedAt: null,
    targetMetric,
    targetDirection,
    baselineValue: computeMetricAverage(baselineMissions, targetMetric),
    postValue: null,
    improvementDelta: null,
    verdict: null,
    baselineMissionIds: baselineMissions.map((mission) => mission.missionId),
    postMissionIds: [],
    simulation: { ok: false, predictedDelta: null, notes: '', simulatedAt: null },
    approval: { required: true, approvedBy: null, reason: null },
    resolution: { decision: null, reason: null },
    learningCandidateId: null,
  }
  await db.memory.create({ data: { key: initiativeKey(initiative.initiativeId), value: JSON.stringify(initiative), category: 'improvement_initiative' } })
  return initiative
}

export async function simulateInitiative(initiativeId: string, predictedDelta: number | null = null): Promise<ImprovementInitiative> {
  const initiative = await getInitiative(initiativeId)
  if (!initiative) throw new Error(`Improvement initiative not found: ${initiativeId}`)
  if (initiative.status !== 'proposed') throw new Error(`Initiative ${initiativeId} cannot be simulated from status ${initiative.status}.`)
  const simulation = {
    ok: initiative.baselineValue !== null,
    predictedDelta: predictedDelta ?? (initiative.baselineValue === null ? null : initiative.targetDirection === 'increase' ? Math.max(1, Math.abs(initiative.baselineValue) * 0.02) : -Math.max(1, Math.abs(initiative.baselineValue) * 0.02)),
    notes: initiative.baselineValue === null ? 'Simulation blocked because no baseline missions were available.' : 'Simulation is a non-mutating hypothesis; it does not change runtime behavior or source code.',
    simulatedAt: new Date().toISOString(),
  }
  const updated: ImprovementInitiative = { ...initiative, simulation, simulatedAt: simulation.simulatedAt, status: simulation.ok ? 'simulated' : 'rejected' }
  await saveInitiative(updated)
  return updated
}

export async function approveInitiative(initiativeId: string, approver: string, reason: string): Promise<ImprovementInitiative> {
  const initiative = await getInitiative(initiativeId)
  if (!initiative) throw new Error(`Improvement initiative not found: ${initiativeId}`)
  if (initiative.status !== 'simulated') throw new Error(`Initiative ${initiativeId} must be simulated before approval.`)
  if (!approver.trim() || !reason.trim()) throw new Error('Initiative approval requires approver and reason.')
  return saveAndReturn({ ...initiative, status: 'approved', approvedAt: new Date().toISOString(), approval: { required: true, approvedBy: approver.trim(), reason: reason.trim() } })
}

export async function applyInitiative(initiativeId: string): Promise<ImprovementInitiative> {
  const initiative = await getInitiative(initiativeId)
  if (!initiative) throw new Error(`Improvement initiative not found: ${initiativeId}`)
  if (initiative.status !== 'approved') throw new Error(`Initiative ${initiativeId} can only be applied after explicit approval.`)
  return saveAndReturn({ ...initiative, status: 'active', appliedAt: new Date().toISOString() })
}

export async function measureInitiative(initiativeId: string, telemetry: MissionTelemetry): Promise<ImprovementInitiative> {
  const initiative = await getInitiative(initiativeId)
  if (!initiative) throw new Error(`Improvement initiative not found: ${initiativeId}`)
  if (!['active', 'measuring'].includes(initiative.status)) throw new Error(`Initiative ${initiativeId} must be active before measurement.`)
  const canonicalTelemetry = await persistMeasurementTelemetry(telemetry)
  const uniquePostMissionIds = [...new Set([...initiative.postMissionIds, canonicalTelemetry.missionId])]
  const postMissions = await getMissionsByIds(uniquePostMissionIds)
  const postMissionIds = postMissions.map((mission) => mission.missionId)
  const postValue = computeMetricAverage(postMissions, initiative.targetMetric)
  const delta = initiative.baselineValue !== null && postValue !== null ? postValue - initiative.baselineValue : null
  let verdict: InitiativeVerdict = null
  if (delta !== null) verdict = initiative.targetDirection === 'increase' ? (delta > 1 ? 'improved' : delta < -1 ? 'worsened' : 'no_change') : (delta < -1 ? 'improved' : delta > 1 ? 'worsened' : 'no_change')
  const enoughEvidence = postMissionIds.length >= 3 && initiative.baselineValue !== null && postValue !== null
  const updated: ImprovementInitiative = { ...initiative, postMissionIds, postValue, improvementDelta: delta, verdict, measuredAt: new Date().toISOString(), status: enoughEvidence ? 'verified' : 'measuring', verifiedAt: enoughEvidence ? new Date().toISOString() : null }
  if (enoughEvidence) await createLearningCandidate(updated)
  await saveInitiative(updated)
  return updated
}

async function createLearningCandidate(initiative: ImprovementInitiative): Promise<void> {
  if (initiative.learningCandidateId || initiative.verdict === null || initiative.improvementDelta === null) return
  const prediction = initiative.simulation.predictedDelta
  const errorMagnitude = prediction === null ? null : Math.abs(initiative.improvementDelta - prediction)
  const direction = initiative.verdict === 'worsened' ? 'worse_than_predicted' : initiative.verdict === 'improved' && (prediction ?? 0) <= 0 ? 'better_than_predicted' : 'matched'
  const candidate = buildLearningCandidate({
    recommendationId: initiative.initiativeId,
    behavior: initiative.recommendation,
    expectedOutcome: `${initiative.targetDirection} ${initiative.targetMetric}`,
    actualOutcome: `${initiative.targetMetric} changed by ${initiative.improvementDelta}`,
    predictionError: { kind: 'NUMERIC', magnitude: errorMagnitude, direction, explanation: `Measured ${initiative.targetMetric} delta ${initiative.improvementDelta}; simulation predicted ${prediction ?? 'no numeric delta'}.` },
    rootCause: initiative.verdict === 'worsened' ? `The proposed change correlated with a worsened ${initiative.targetMetric}; investigate causal assumptions before reuse.` : `Outcome evidence indicates the initiative ${initiative.verdict} for ${initiative.targetMetric}.`,
    evidenceIds: initiative.postMissionIds,
    proposedChange: initiative.recommendation,
  })
  await persistLearningCandidate(candidate)
}

export async function resolveInitiative(initiativeId: string, decision: 'KEEP' | 'ROLLBACK', reason: string): Promise<ImprovementInitiative> {
  const initiative = await getInitiative(initiativeId)
  if (!initiative) throw new Error(`Improvement initiative not found: ${initiativeId}`)
  if (initiative.status !== 'verified') throw new Error(`Initiative ${initiativeId} must be verified before KEEP/ROLLBACK.`)
  if (initiative.resolvedAt) throw new Error(`Initiative ${initiativeId} is already resolved.`)
  if (!reason.trim()) throw new Error('Resolution reason is required.')
  return saveAndReturn({ ...initiative, status: decision === 'KEEP' ? 'verified' : 'rolled_back', resolvedAt: new Date().toISOString(), resolution: { decision, reason: reason.trim() } })
}

async function saveInitiative(initiative: ImprovementInitiative): Promise<void> {
  await db.memory.upsert({ where: { key: initiativeKey(initiative.initiativeId) }, create: { key: initiativeKey(initiative.initiativeId), value: JSON.stringify(initiative), category: 'improvement_initiative' }, update: { value: JSON.stringify(initiative), category: 'improvement_initiative' } })
}
async function saveAndReturn(initiative: ImprovementInitiative): Promise<ImprovementInitiative> { await saveInitiative(initiative); return initiative }
export async function getInitiative(initiativeId: string): Promise<ImprovementInitiative | null> { const row = await db.memory.findUnique({ where: { key: initiativeKey(initiativeId) } }); return row ? JSON.parse(row.value) as ImprovementInitiative : null }
export async function listInitiativesByStatus(status: InitiativeStatus, limit = 100): Promise<ImprovementInitiative[]> {
  try {
    const rows = await db.memory.findMany({ where: { category: 'improvement_initiative' }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit, 1), 500) })
    return rows.map((row) => { try { return JSON.parse(row.value) as ImprovementInitiative } catch { return null } }).filter((item): item is ImprovementInitiative => item !== null && item.status === status)
  } catch { return [] }
}
export async function getInitiatives(limit = 20): Promise<ImprovementInitiative[]> {
  try {
    const rows = await db.memory.findMany({ where: { category: 'improvement_initiative' }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit, 1), 500) })
    return rows.map((row) => { try { return JSON.parse(row.value) as ImprovementInitiative } catch { return null } }).filter((item): item is ImprovementInitiative => item !== null)
  } catch { return [] }
}
export async function findUnresolvedInitiative(recommendation: string, targetMetric: ImprovementMetric, limit = 100): Promise<ImprovementInitiative | null> {
  const initiatives = await getInitiatives(limit)
  return initiatives.find((initiative) => initiative.recommendation === recommendation.trim() && initiative.targetMetric === targetMetric && initiative.resolvedAt === null && !['rejected', 'rolled_back'].includes(initiative.status)) ?? null
}
export async function checkRecommendationsAgainstMission(telemetry: MissionTelemetry, _auditReport: AuditReport): Promise<void> {
  const active = await getInitiatives(50)
  for (const initiative of active.filter((item) => item.status === 'active' || item.status === 'measuring')) {
    try { await measureInitiative(initiative.initiativeId, telemetry) } catch (error) { console.error('[closed-loop] Measurement failed:', error instanceof Error ? error.message.slice(0, 180) : String(error)) }
  }
}
