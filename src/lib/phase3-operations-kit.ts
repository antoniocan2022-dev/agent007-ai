import { randomUUID } from 'node:crypto'
import { db } from './db'
import {
  COMMERCIAL_CONTROL_PLANE_ID,
  COMMERCIAL_CONTROL_PLANE_VERSION,
  recordCommercialEvent,
  createCommercialWorkflow,
  type CommercialBusiness,
} from './commercial-control-plane'

export const PHASE3_VERSION = '1.0.0'
export const PHASE3_NAME = 'Small Business Operations Kit'
export const PHASE3_BUSINESS: CommercialBusiness = 'operations-kit'

export const OPERATIONS_STAGES = [
  'intake',
  'observe',
  'map',
  'diagnose',
  'prioritize',
  'design',
  'authorize',
  'implement',
  'measure',
  'learn',
] as const

export type OperationsStage = (typeof OPERATIONS_STAGES)[number]

export interface OperationsObservationInput {
  tenantId: string
  processKey: string
  processName: string
  source: string
  observation: string
  occurrencesPerMonth: number
  minutesPerOccurrence: number
  errorRate?: number
  automationCandidate?: boolean
  evidenceIds: string[]
  idempotencyKey: string
}

export interface OperationsObservation {
  observationId: string
  tenantId: string
  business: typeof PHASE3_BUSINESS
  processKey: string
  processName: string
  source: string
  observation: string
  occurrencesPerMonth: number
  minutesPerOccurrence: number
  errorRate: number
  automationCandidate: boolean
  estimatedMonthlyMinutes: number
  evidenceIds: string[]
  controlPlaneId: typeof COMMERCIAL_CONTROL_PLANE_ID
  controlPlaneVersion: number
  createdAt: string
}

export interface OperationsPlanInput {
  tenantId: string
  processKey: string
  processName: string
  observationIds: string[]
  evidenceIds: string[]
  priority: 'low' | 'medium' | 'high' | 'critical'
  monthlyMinutesSaved: number
  estimatedMonthlyValue: number
  expectedErrorReduction: number
  feasibilityScore: number
  blockedExternalActions: string[]
  idempotencyKey: string
}

export interface OperationsPlan {
  planId: string
  tenantId: string
  business: typeof PHASE3_BUSINESS
  stage: 'design'
  processKey: string
  processName: string
  observationIds: string[]
  evidenceIds: string[]
  priority: OperationsPlanInput['priority']
  monthlyMinutesSaved: number
  estimatedMonthlyValue: number
  expectedErrorReduction: number
  feasibilityScore: number
  blockedExternalActions: string[]
  controlPlaneId: typeof COMMERCIAL_CONTROL_PLANE_ID
  controlPlaneVersion: number
  createdAt: string
}

function clean(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function finiteNonNegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be a finite non-negative number`)
  return value
}

function bounded(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${field} must be between 0 and 1`)
  return value
}

function boundedScore(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(`${field} must be between 0 and 100`)
  return value
}

function observationKey(tenantId: string, idempotencyKey: string): string {
  return `phase3:observation:${tenantId}:${idempotencyKey}`
}

function planKey(tenantId: string, idempotencyKey: string): string {
  return `phase3:plan:${tenantId}:${idempotencyKey}`
}

export function validateOperationsStageTransition(from: OperationsStage, to: OperationsStage): boolean {
  const fromIndex = OPERATIONS_STAGES.indexOf(from)
  const toIndex = OPERATIONS_STAGES.indexOf(to)
  return fromIndex >= 0 && toIndex === fromIndex + 1
}

/** Deterministic, bounded feasibility scoring; no invented business facts. */
export function scoreAutomationFeasibility(input: {
  repetitive: boolean
  structuredInputs: boolean
  deterministicOutput: boolean
  externalSideEffects: boolean
  sensitiveDecision: boolean
}): number {
  let score = 0
  if (input.repetitive) score += 25
  if (input.structuredInputs) score += 20
  if (input.deterministicOutput) score += 25
  if (!input.externalSideEffects) score += 15
  if (!input.sensitiveDecision) score += 15
  return Math.min(100, score)
}

export async function recordOperationsObservation(input: OperationsObservationInput): Promise<{ created: boolean; observation: OperationsObservation }> {
  const tenantId = clean(input.tenantId)
  const processKey = clean(input.processKey)
  const processName = clean(input.processName)
  const source = clean(input.source)
  const observationText = clean(input.observation)
  const idempotencyKey = clean(input.idempotencyKey)
  if (!tenantId || !processKey || !processName || !source || !observationText || !idempotencyKey) {
    throw new Error('tenantId, processKey, processName, source, observation, and idempotencyKey are required')
  }
  const occurrencesPerMonth = finiteNonNegative(input.occurrencesPerMonth, 'occurrencesPerMonth')
  const minutesPerOccurrence = finiteNonNegative(input.minutesPerOccurrence, 'minutesPerOccurrence')
  const errorRate = bounded(input.errorRate ?? 0, 'errorRate')
  const evidenceIds = [...new Set(input.evidenceIds.map(clean).filter(Boolean))]
  if (evidenceIds.length === 0) throw new Error('At least one evidenceId is required')

  const key = observationKey(tenantId, idempotencyKey)
  const existing = await db.memory.findUnique({ where: { key } })
  if (existing) {
    return { created: false, observation: JSON.parse(existing.value) as OperationsObservation }
  }

  const createdAt = new Date().toISOString()
  const observation: OperationsObservation = {
    observationId: `opsobs_${randomUUID()}`,
    tenantId,
    business: PHASE3_BUSINESS,
    processKey,
    processName,
    source,
    observation: observationText,
    occurrencesPerMonth,
    minutesPerOccurrence,
    errorRate,
    automationCandidate: input.automationCandidate ?? true,
    estimatedMonthlyMinutes: occurrencesPerMonth * minutesPerOccurrence,
    evidenceIds,
    controlPlaneId: COMMERCIAL_CONTROL_PLANE_ID,
    controlPlaneVersion: COMMERCIAL_CONTROL_PLANE_VERSION,
    createdAt,
  }

  await recordCommercialEvent({
    tenantId,
    business: PHASE3_BUSINESS,
    type: 'operations.observation.recorded',
    source,
    entityType: 'operations_observation',
    entityId: observation.observationId,
    payload: { observationId: observation.observationId, processKey, evidenceIds },
    occurredAt: createdAt,
    idempotencyKey,
  })
  try {
    await db.memory.create({ data: { key, category: 'phase3_operations_observation', value: JSON.stringify(observation) } })
    return { created: true, observation }
  } catch (error) {
    const concurrent = await db.memory.findUnique({ where: { key } })
    if (concurrent) return { created: false, observation: JSON.parse(concurrent.value) as OperationsObservation }
    throw error
  }
}

export async function createOperationsPlan(input: OperationsPlanInput): Promise<{ created: boolean; plan: OperationsPlan }> {
  const tenantId = clean(input.tenantId)
  const processKey = clean(input.processKey)
  const processName = clean(input.processName)
  const idempotencyKey = clean(input.idempotencyKey)
  if (!tenantId || !processKey || !processName || !idempotencyKey) throw new Error('tenantId, processKey, processName, and idempotencyKey are required')
  const observationIds = [...new Set(input.observationIds.map(clean).filter(Boolean))]
  const evidenceIds = [...new Set(input.evidenceIds.map(clean).filter(Boolean))]
  if (!observationIds.length) throw new Error('At least one observationId is required')
  if (!evidenceIds.length) throw new Error('At least one evidenceId is required')
  const monthlyMinutesSaved = finiteNonNegative(input.monthlyMinutesSaved, 'monthlyMinutesSaved')
  const estimatedMonthlyValue = finiteNonNegative(input.estimatedMonthlyValue, 'estimatedMonthlyValue')
  const expectedErrorReduction = bounded(input.expectedErrorReduction, 'expectedErrorReduction')
  const feasibilityScore = boundedScore(input.feasibilityScore, 'feasibilityScore')
  if (input.blockedExternalActions.some((value) => !clean(value))) throw new Error('blockedExternalActions must contain non-empty strings')

  const key = planKey(tenantId, idempotencyKey)
  const existing = await db.memory.findUnique({ where: { key } })
  if (existing) return { created: false, plan: JSON.parse(existing.value) as OperationsPlan }

  const createdAt = new Date().toISOString()
  const plan: OperationsPlan = {
    planId: `opsplan_${randomUUID()}`,
    tenantId,
    business: PHASE3_BUSINESS,
    stage: 'design',
    processKey,
    processName,
    observationIds,
    evidenceIds,
    priority: input.priority,
    monthlyMinutesSaved,
    estimatedMonthlyValue,
    expectedErrorReduction,
    feasibilityScore,
    blockedExternalActions: [...new Set(input.blockedExternalActions.map(clean).filter(Boolean))],
    controlPlaneId: COMMERCIAL_CONTROL_PLANE_ID,
    controlPlaneVersion: COMMERCIAL_CONTROL_PLANE_VERSION,
    createdAt,
  }

  await recordCommercialEvent({
    tenantId,
    business: PHASE3_BUSINESS,
    type: 'operations.plan.created',
    source: 'phase3-operations-kit',
    entityType: 'operations_plan',
    entityId: plan.planId,
    payload: plan,
    occurredAt: createdAt,
    idempotencyKey,
  })
  await createCommercialWorkflow({
    tenantId,
    business: PHASE3_BUSINESS,
    workflowType: 'operations-plan',
    input: { planId: plan.planId, processKey, stage: 'design' },
    maxRetries: 3,
    nextRunAt: createdAt,
    idempotencyKey: `ops-workflow:${idempotencyKey}`,
  })
  try {
    await db.memory.create({ data: { key, category: 'phase3_operations_plan', value: JSON.stringify(plan) } })
    return { created: true, plan }
  } catch (error) {
    const concurrent = await db.memory.findUnique({ where: { key } })
    if (concurrent) return { created: false, plan: JSON.parse(concurrent.value) as OperationsPlan }
    throw error
  }
}

export function validatePhase3Contracts(): string[] {
  const errors: string[] = []
  if (PHASE3_BUSINESS !== 'operations-kit') errors.push('invalid phase3 business')
  if (OPERATIONS_STAGES.length !== 10) errors.push('operations stage count drift')
  for (let index = 0; index < OPERATIONS_STAGES.length - 1; index += 1) {
    if (!validateOperationsStageTransition(OPERATIONS_STAGES[index], OPERATIONS_STAGES[index + 1])) errors.push(`invalid transition at ${index}`)
  }
  if (scoreAutomationFeasibility({ repetitive: true, structuredInputs: true, deterministicOutput: true, externalSideEffects: false, sensitiveDecision: false }) !== 100) errors.push('feasibility scoring drift')
  if (scoreAutomationFeasibility({ repetitive: false, structuredInputs: false, deterministicOutput: false, externalSideEffects: true, sensitiveDecision: true }) !== 0) errors.push('feasibility scoring floor drift')
  return errors
}
