import { createHash, randomUUID } from 'node:crypto'
import { db } from './db'

export type AutonomyLevel = 'PROPOSED' | 'ASSISTED' | 'SUPERVISED' | 'AUTONOMOUS'
export type ActionClass = 'OBSERVE' | 'LOW_RISK' | 'MEDIUM_RISK' | 'HIGH_RISK' | 'IRREVERSIBLE'

export interface AutonomyEvidenceInput {
  actionClass: ActionClass
  attempts: number
  successes: number
  safetyViolations?: number
  replayFailures?: number
  recoveryFailures?: number
  verifiedOutcomes?: number
  ownerIncidents?: number
  recordedAt?: string
  source?: string
  idempotencyKey?: string
}

export interface AutonomyEvidenceRecord extends AutonomyEvidenceInput {
  evidenceId: string
  recordedAt: string
  source: string
}

export interface AutonomyMeasurement {
  actionClass: ActionClass
  sampleSize: number
  successRate: number
  safetyRate: number
  evidenceRate: number
  recoveryRate: number
  ownerSafetyRate: number
  score: number
  recommendedLevel: AutonomyLevel
  reasons: string[]
}

export interface OwnerApprovalEvidence {
  approvalId: string
  ownerUserId: string
  challengeId: string
  issuedAt: string
  expiresAt: string
  signature: string
}

export interface AutonomyDecision {
  actionClass: ActionClass
  previousLevel: AutonomyLevel
  level: AutonomyLevel
  decision: 'GRADUATED' | 'DOWNGRADED' | 'UNCHANGED' | 'BLOCKED'
  score: number
  ceiling: AutonomyLevel
  reason: string
  decidedAt: string
  evidenceWindow: number
  approvalId: string | null
}

const EVIDENCE_CATEGORY = 'autonomy_evidence'
const DECISION_CATEGORY = 'autonomy_decision'
const APPROVAL_CHALLENGE_CATEGORY = 'autonomy_owner_approval_challenge'
const APPROVAL_CATEGORY = 'autonomy_owner_approval'
const ACTION_CLASS_CEILINGS: Readonly<Record<ActionClass, AutonomyLevel>> = Object.freeze({
  OBSERVE: 'AUTONOMOUS',
  LOW_RISK: 'AUTONOMOUS',
  MEDIUM_RISK: 'SUPERVISED',
  HIGH_RISK: 'SUPERVISED',
  IRREVERSIBLE: 'ASSISTED',
})

const LEVEL_ORDER: readonly AutonomyLevel[] = ['PROPOSED', 'ASSISTED', 'SUPERVISED', 'AUTONOMOUS']

function levelRank(level: AutonomyLevel): number { return LEVEL_ORDER.indexOf(level) }
function minLevel(a: AutonomyLevel, b: AutonomyLevel): AutonomyLevel { return levelRank(a) <= levelRank(b) ? a : b }
function keyForEvidence(id: string): string { return `${EVIDENCE_CATEGORY}:${id}` }
function keyForDecision(actionClass: ActionClass): string { return `${DECISION_CATEGORY}:${actionClass}` }
function approvalChallengeKey(id: string): string { return `${APPROVAL_CHALLENGE_CATEGORY}:${id}` }
function approvalKey(actionClass: ActionClass): string { return `${APPROVAL_CATEGORY}:${actionClass}` }
function sha256(value: string): string { return createHash('sha256').update(value).digest('hex') }

export const IMMUTABLE_ACTION_CLASS_CEILINGS = ACTION_CLASS_CEILINGS

export function getActionClassCeiling(actionClass: ActionClass): AutonomyLevel {
  return ACTION_CLASS_CEILINGS[actionClass]
}

export function assertActionClassWithinCeiling(actionClass: ActionClass, requestedLevel: AutonomyLevel): void {
  const ceiling = getActionClassCeiling(actionClass)
  if (levelRank(requestedLevel) > levelRank(ceiling)) {
    throw new Error(`Autonomy ceiling violation: ${actionClass} may not exceed ${ceiling}. Requested ${requestedLevel}.`)
  }
}

function validateEvidence(input: AutonomyEvidenceInput): void {
  const numeric = ['attempts', 'successes', 'safetyViolations', 'replayFailures', 'recoveryFailures', 'verifiedOutcomes', 'ownerIncidents'] as const
  for (const field of numeric) {
    const value = input[field] ?? 0
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) throw new Error(`Autonomy evidence ${field} must be a non-negative integer.`)
  }
  if (input.successes > input.attempts) throw new Error('Autonomy evidence successes cannot exceed attempts.')
  if ((input.verifiedOutcomes ?? 0) > input.attempts) throw new Error('Autonomy evidence verifiedOutcomes cannot exceed attempts.')
  if (!input.actionClass) throw new Error('Autonomy evidence actionClass is required.')
}

export async function recordAutonomyEvidence(input: AutonomyEvidenceInput): Promise<AutonomyEvidenceRecord> {
  validateEvidence(input)
  const recordedAt = input.recordedAt ? new Date(input.recordedAt).toISOString() : new Date().toISOString()
  const idempotencyKey = input.idempotencyKey?.trim() || randomUUID()
  const evidenceId = sha256(`${input.actionClass}|${idempotencyKey}`)
  const record: AutonomyEvidenceRecord = {
    ...input,
    evidenceId,
    recordedAt,
    source: (input.source ?? 'canonical-heartbeat').trim() || 'canonical-heartbeat',
    safetyViolations: input.safetyViolations ?? 0,
    replayFailures: input.replayFailures ?? 0,
    recoveryFailures: input.recoveryFailures ?? 0,
    verifiedOutcomes: input.verifiedOutcomes ?? 0,
    ownerIncidents: input.ownerIncidents ?? 0,
  }
  const key = keyForEvidence(evidenceId)
  const existing = await db.memory.findUnique({ where: { key } })
  if (existing) return JSON.parse(existing.value) as AutonomyEvidenceRecord
  await db.memory.create({ data: { key, value: JSON.stringify(record), category: EVIDENCE_CATEGORY } }).catch(() => {})
  const confirmed = await db.memory.findUnique({ where: { key } })
  if (!confirmed) throw new Error(`Autonomy evidence could not be persisted: ${evidenceId}`)
  return JSON.parse(confirmed.value) as AutonomyEvidenceRecord
}

async function listEvidence(actionClass: ActionClass, limit = 1000): Promise<AutonomyEvidenceRecord[]> {
  const rows = await db.memory.findMany({ where: { category: EVIDENCE_CATEGORY }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit, 1), 5000) })
  return rows
    .map((row) => { try { return JSON.parse(row.value) as AutonomyEvidenceRecord } catch { return null } })
    .filter((item): item is AutonomyEvidenceRecord => Boolean(item))
    .filter((item) => item.actionClass === actionClass)
}

export async function measureAutonomy(actionClass: ActionClass, limit = 1000): Promise<AutonomyMeasurement> {
  const evidence = await listEvidence(actionClass, limit)
  const sampleSize = evidence.reduce((sum, item) => sum + item.attempts, 0)
  const successes = evidence.reduce((sum, item) => sum + item.successes, 0)
  const safetyViolations = evidence.reduce((sum, item) => sum + (item.safetyViolations ?? 0), 0)
  const replayFailures = evidence.reduce((sum, item) => sum + (item.replayFailures ?? 0), 0)
  const recoveryFailures = evidence.reduce((sum, item) => sum + (item.recoveryFailures ?? 0), 0)
  const verifiedOutcomes = evidence.reduce((sum, item) => sum + (item.verifiedOutcomes ?? 0), 0)
  const ownerIncidents = evidence.reduce((sum, item) => sum + (item.ownerIncidents ?? 0), 0)
  const safeDenominator = Math.max(sampleSize, 1)
  const successRate = successes / safeDenominator
  const safetyRate = Math.max(0, 1 - safetyViolations / safeDenominator)
  const evidenceRate = verifiedOutcomes / safeDenominator
  const recoveryRate = Math.max(0, 1 - recoveryFailures / safeDenominator)
  const ownerSafetyRate = Math.max(0, 1 - ownerIncidents / safeDenominator)
  const score = Math.round((successRate * 35 + safetyRate * 30 + evidenceRate * 20 + recoveryRate * 10 + ownerSafetyRate * 5) * 100) / 100
  const reasons: string[] = []
  let recommendedLevel: AutonomyLevel = 'PROPOSED'
  if (sampleSize >= 10 && score >= 70) recommendedLevel = 'ASSISTED'
  if (sampleSize >= 30 && score >= 85 && safetyViolations === 0) recommendedLevel = 'SUPERVISED'
  if (sampleSize >= 100 && score >= 95 && safetyViolations === 0 && replayFailures === 0 && ownerIncidents === 0) recommendedLevel = 'AUTONOMOUS'
  if (sampleSize < 10) reasons.push('Insufficient evidence sample for Assisted graduation.')
  if (safetyViolations > 0) reasons.push(`${safetyViolations} safety violation(s) block higher graduation.`)
  if (replayFailures > 0) reasons.push(`${replayFailures} replay/idempotency failure(s) prevent autonomous graduation.`)
  if (recoveryFailures > 0) reasons.push(`${recoveryFailures} recovery failure(s) reduce autonomy score.`)
  if (ownerIncidents > 0) reasons.push(`${ownerIncidents} owner-safety incident(s) prevent autonomous graduation.`)
  return { actionClass, sampleSize, successRate, safetyRate, evidenceRate, recoveryRate, ownerSafetyRate, score, recommendedLevel: minLevel(recommendedLevel, getActionClassCeiling(actionClass)), reasons }
}

export async function getCurrentAutonomyLevel(actionClass: ActionClass): Promise<AutonomyLevel> {
  const row = await db.memory.findUnique({ where: { key: keyForDecision(actionClass) }, select: { value: true } })
  if (!row) return 'PROPOSED'
  try { const parsed = JSON.parse(row.value) as AutonomyDecision; if (LEVEL_ORDER.includes(parsed.level)) return parsed.level } catch {}
  return 'PROPOSED'
}

export async function createFirstHighRiskApprovalChallenge(): Promise<{ challengeId: string; challenge: string; expiresAt: string }> {
  const challengeId = randomUUID()
  const challenge = randomUUID()
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString()
  await db.memory.create({ data: { key: approvalChallengeKey(challengeId), value: JSON.stringify({ challengeId, challengeHash: sha256(challenge), expiresAt, createdAt: new Date().toISOString() }), category: APPROVAL_CHALLENGE_CATEGORY } })
  return { challengeId, challenge, expiresAt }
}

export async function approveFirstHighRiskGraduation(input: { ownerUserId: string; challengeId: string; approvalToken: string }): Promise<OwnerApprovalEvidence> {
  const challengeRow = await db.memory.findUnique({ where: { key: approvalChallengeKey(input.challengeId) } })
  if (!challengeRow) throw new Error('High-risk owner approval challenge was not found.')
  const challenge = JSON.parse(challengeRow.value) as { challengeHash: string; expiresAt: string }
  if (Date.parse(challenge.expiresAt) <= Date.now()) throw new Error('High-risk owner approval challenge has expired.')
  const configuredToken = process.env.AGENT007_OWNER_APPROVAL_SECRET?.trim()
  if (!configuredToken) throw new Error('Owner approval is unavailable: AGENT007_OWNER_APPROVAL_SECRET is not configured.')
  if (sha256(`${input.challengeId}:${input.approvalToken}:${configuredToken}`) !== sha256(`${input.challengeId}:${challenge.challengeHash}:${configuredToken}`)) {
    throw new Error('Owner approval token verification failed.')
  }
  const approval: OwnerApprovalEvidence = {
    approvalId: randomUUID(),
    ownerUserId: input.ownerUserId.trim(),
    challengeId: input.challengeId,
    issuedAt: new Date().toISOString(),
    expiresAt: challenge.expiresAt,
    signature: sha256(`${input.ownerUserId}|${input.challengeId}|${input.approvalToken}|${configuredToken}`),
  }
  await db.memory.create({ data: { key: approvalKey('HIGH_RISK'), value: JSON.stringify(approval), category: APPROVAL_CATEGORY } }).catch(() => {})
  await db.memory.delete({ where: { key: approvalChallengeKey(input.challengeId) } }).catch(() => {})
  return approval
}

async function consumeFirstHighRiskApproval(): Promise<OwnerApprovalEvidence | null> {
  const row = await db.memory.findUnique({ where: { key: approvalKey('HIGH_RISK') } })
  if (!row) return null
  try {
    const approval = JSON.parse(row.value) as OwnerApprovalEvidence
    if (Date.parse(approval.expiresAt) <= Date.now()) return null
    await db.memory.delete({ where: { key: approvalKey('HIGH_RISK') } })
    return approval
  } catch { return null }
}

export async function evaluateAndPersistAutonomy(actionClass: ActionClass): Promise<AutonomyDecision> {
  const measurement = await measureAutonomy(actionClass)
  const previousLevel = await getCurrentAutonomyLevel(actionClass)
  let target = measurement.recommendedLevel
  let decision: AutonomyDecision['decision'] = 'UNCHANGED'
  let reason = measurement.reasons.join(' ') || 'Evidence supports the current autonomy posture.'
  let approvalId: string | null = null

  if (measurement.safetyRate < 1 || measurement.ownerSafetyRate < 1) {
    target = 'PROPOSED'
    decision = levelRank(target) < levelRank(previousLevel) ? 'DOWNGRADED' : 'UNCHANGED'
    reason = measurement.reasons.join(' ')
  } else if (levelRank(target) > levelRank(previousLevel)) {
    if (actionClass === 'HIGH_RISK' && levelRank(previousLevel) < levelRank('SUPERVISED') && levelRank(target) >= levelRank('SUPERVISED')) {
      const approval = await consumeFirstHighRiskApproval()
      if (!approval) {
        target = previousLevel
        decision = 'BLOCKED'
        reason = 'First high-risk graduation requires explicit owner approval.'
      } else {
        approvalId = approval.approvalId
        decision = 'GRADUATED'
        reason = `Evidence supports ${target}; first high-risk graduation approved by owner.`
      }
    } else {
      decision = 'GRADUATED'
      reason = `Evidence score ${measurement.score} supports ${target} within immutable class ceiling.`
    }
  } else if (levelRank(target) < levelRank(previousLevel)) {
    decision = 'DOWNGRADED'
    reason = measurement.reasons.join(' ') || `Evidence score ${measurement.score} no longer supports ${previousLevel}.`
  }

  assertActionClassWithinCeiling(actionClass, target)
  const result: AutonomyDecision = {
    actionClass,
    previousLevel,
    level: target,
    decision,
    score: measurement.score,
    ceiling: getActionClassCeiling(actionClass),
    reason: reason.trim(),
    decidedAt: new Date().toISOString(),
    evidenceWindow: measurement.sampleSize,
    approvalId,
  }
  await db.memory.upsert({ where: { key: keyForDecision(actionClass) }, update: { category: DECISION_CATEGORY, value: JSON.stringify(result) }, create: { key: keyForDecision(actionClass), category: DECISION_CATEGORY, value: JSON.stringify(result) } })
  return result
}
