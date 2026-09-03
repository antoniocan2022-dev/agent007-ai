import { createHash } from 'node:crypto'
import { db } from './db'

export type LearningCandidateStatus = 'CANDIDATE' | 'VALIDATING' | 'APPROVED' | 'REJECTED' | 'PROMOTED'
export type LearningValidationResult = 'PASS' | 'FAIL' | 'PENDING'

export interface LearningCandidate {
  schemaVersion: 1
  candidateId: string
  recommendationId: string
  behavior: string
  expectedOutcome: string
  actualOutcome: string
  predictionError: {
    kind: 'NUMERIC' | 'CATEGORICAL' | 'TEXTUAL' | 'UNAVAILABLE'
    magnitude: number | null
    direction: 'better_than_predicted' | 'worse_than_predicted' | 'matched' | 'unknown'
    explanation: string
  }
  rootCause: string
  evidenceIds: string[]
  proposedChange: string
  validation: {
    result: LearningValidationResult
    testRefs: string[]
    notes: string
    validatedAt: string | null
  }
  approval: {
    required: boolean
    approvedBy: string | null
    approvedAt: string | null
  }
  promotion: {
    regressionTestRef: string | null
    promotedAt: string | null
  }
  status: LearningCandidateStatus
  createdAt: string
}

export interface LearningValidationInput {
  passed: boolean
  testRefs: string[]
  notes?: string
}

function stableCandidateId(input: { recommendationId: string; behavior: string; actualOutcome: string }): string {
  const digest = createHash('sha256').update([input.recommendationId, input.behavior, input.actualOutcome].map((value) => value.trim()).join('|')).digest('hex').slice(0, 24)
  return `learning_candidate_${digest}`
}

export function buildLearningCandidate(input: {
  recommendationId: string
  behavior: string
  expectedOutcome: string
  actualOutcome: string
  predictionError: LearningCandidate['predictionError']
  rootCause: string
  evidenceIds?: string[]
  proposedChange: string
  createdAt?: string
}): LearningCandidate {
  if (!input.recommendationId.trim()) throw new Error('Learning candidate requires recommendationId.')
  if (!input.behavior.trim()) throw new Error('Learning candidate requires observed behavior.')
  if (!input.expectedOutcome.trim()) throw new Error('Learning candidate requires expected outcome.')
  if (!input.actualOutcome.trim()) throw new Error('Learning candidate requires actual outcome.')
  if (!input.rootCause.trim()) throw new Error('Learning candidate requires a root cause.')
  if (!input.proposedChange.trim()) throw new Error('Learning candidate requires a proposed change.')

  const createdAt = input.createdAt ?? new Date().toISOString()
  return {
    schemaVersion: 1,
    candidateId: stableCandidateId(input),
    recommendationId: input.recommendationId.trim(),
    behavior: input.behavior.trim(),
    expectedOutcome: input.expectedOutcome.trim(),
    actualOutcome: input.actualOutcome.trim(),
    predictionError: input.predictionError,
    rootCause: input.rootCause.trim(),
    evidenceIds: [...new Set((input.evidenceIds ?? []).map((id) => id.trim()).filter(Boolean))],
    proposedChange: input.proposedChange.trim(),
    validation: { result: 'PENDING', testRefs: [], notes: '', validatedAt: null },
    approval: { required: true, approvedBy: null, approvedAt: null },
    promotion: { regressionTestRef: null, promotedAt: null },
    status: 'CANDIDATE',
    createdAt,
  }
}

export async function persistLearningCandidate(candidate: LearningCandidate): Promise<LearningCandidate> {
  const key = `learning:candidate:${candidate.candidateId}`
  const existing = await db.memory.findUnique({ where: { key } })
  if (existing) return JSON.parse(existing.value) as LearningCandidate
  await db.memory.create({ data: { key, value: JSON.stringify(candidate), category: 'behavioral_learning_candidate' } })
  return candidate
}

export function validateLearningCandidate(candidate: LearningCandidate, input: LearningValidationInput): LearningCandidate {
  if (candidate.status === 'PROMOTED' || candidate.status === 'REJECTED') throw new Error(`Cannot validate a terminal learning candidate (${candidate.status}).`)
  if (!input.testRefs.length) throw new Error('Learning validation requires at least one test/evidence reference.')
  const validated: LearningCandidate = {
    ...candidate,
    validation: { result: input.passed ? 'PASS' : 'FAIL', testRefs: [...new Set(input.testRefs.map((ref) => ref.trim()).filter(Boolean))], notes: input.notes?.trim() ?? '', validatedAt: new Date().toISOString() },
    status: input.passed ? 'VALIDATING' : 'REJECTED',
  }
  return validated
}

export async function saveValidatedLearningCandidate(candidate: LearningCandidate): Promise<LearningCandidate> {
  const key = `learning:candidate:${candidate.candidateId}`
  await db.memory.upsert({ where: { key }, create: { key, value: JSON.stringify(candidate), category: 'behavioral_learning_candidate' }, update: { value: JSON.stringify(candidate), category: 'behavioral_learning_candidate' } })
  return candidate
}

export function approveLearningCandidate(candidate: LearningCandidate, approver: string): LearningCandidate {
  if (candidate.validation.result !== 'PASS' || candidate.status !== 'VALIDATING') throw new Error('Learning candidate must pass validation before approval.')
  if (!approver.trim()) throw new Error('Explicit approver is required for behavioral learning promotion.')
  return { ...candidate, approval: { required: true, approvedBy: approver.trim(), approvedAt: new Date().toISOString() }, status: 'APPROVED' }
}

export async function promoteLearningCandidate(candidate: LearningCandidate, regressionTestRef: string): Promise<LearningCandidate> {
  if (candidate.status !== 'APPROVED') throw new Error('Only explicitly approved learning candidates may be promoted.')
  if (!regressionTestRef.trim()) throw new Error('Promotion requires a regression test reference.')
  const promoted: LearningCandidate = { ...candidate, promotion: { regressionTestRef: regressionTestRef.trim(), promotedAt: new Date().toISOString() }, status: 'PROMOTED' }
  await saveValidatedLearningCandidate(promoted)
  return promoted
}

export async function getLearningCandidate(candidateId: string): Promise<LearningCandidate | null> {
  const row = await db.memory.findUnique({ where: { key: `learning:candidate:${candidateId}` } })
  return row ? JSON.parse(row.value) as LearningCandidate : null
}
