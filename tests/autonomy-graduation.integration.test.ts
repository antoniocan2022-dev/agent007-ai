import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import {
  IMMUTABLE_ACTION_CLASS_CEILINGS,
  approveFirstHighRiskGraduation,
  assertActionClassWithinCeiling,
  createFirstHighRiskApprovalChallenge,
  evaluateAndPersistAutonomy,
  getActionClassCeiling,
  getCurrentAutonomyLevel,
  measureAutonomy,
  recordAutonomyEvidence,
} from '@/lib/autonomy-graduation'

describe('Autonomy graduation controls', () => {
  const prefix = randomUUID()
  const ownerUserId = `autonomy-test-${prefix}`
  const previousSecret = process.env.AGENT007_OWNER_APPROVAL_SECRET

  beforeAll(async () => {
    await db.user.create({
      data: {
        id: ownerUserId,
        email: `${ownerUserId}@example.test`,
        passwordHash: 'ci-autonomy-test-password-hash',
        name: 'Autonomy Graduation Test Owner',
      },
    })
  })

  afterAll(async () => {
    await db.memory.deleteMany({ where: { category: { in: ['autonomy_evidence', 'autonomy_decision', 'autonomy_owner_approval_challenge', 'autonomy_owner_approval'] } } }).catch(() => {})
    await db.user.delete({ where: { id: ownerUserId } }).catch(() => {})
    if (previousSecret === undefined) delete process.env.AGENT007_OWNER_APPROVAL_SECRET
    else process.env.AGENT007_OWNER_APPROVAL_SECRET = previousSecret
    await db.$disconnect()
  })

  test('immutable ceilings prevent unsafe action-class graduation', () => {
    expect(getActionClassCeiling('OBSERVE')).toBe('AUTONOMOUS')
    expect(getActionClassCeiling('MEDIUM_RISK')).toBe('SUPERVISED')
    expect(getActionClassCeiling('HIGH_RISK')).toBe('SUPERVISED')
    expect(getActionClassCeiling('IRREVERSIBLE')).toBe('ASSISTED')
    expect(() => assertActionClassWithinCeiling('HIGH_RISK', 'AUTONOMOUS')).toThrow('Autonomy ceiling violation')
    expect(() => assertActionClassWithinCeiling('IRREVERSIBLE', 'SUPERVISED')).toThrow('Autonomy ceiling violation')
    expect(Object.isFrozen(IMMUTABLE_ACTION_CLASS_CEILINGS)).toBe(true)
  })

  test('evidence is idempotent and measurement is evidence-derived', async () => {
    const idempotencyKey = `low-risk-${prefix}`
    const first = await recordAutonomyEvidence({
      actionClass: 'LOW_RISK',
      attempts: 10,
      successes: 10,
      verifiedOutcomes: 10,
      source: 'integration-test',
      idempotencyKey,
    })
    const second = await recordAutonomyEvidence({
      actionClass: 'LOW_RISK',
      attempts: 10,
      successes: 10,
      verifiedOutcomes: 10,
      source: 'integration-test',
      idempotencyKey,
    })
    expect(second.evidenceId).toBe(first.evidenceId)
    await expect(recordAutonomyEvidence({
      actionClass: 'LOW_RISK',
      attempts: 9,
      successes: 9,
      verifiedOutcomes: 9,
      source: 'integration-test',
      idempotencyKey,
    })).rejects.toThrow('immutable field')
    const measurement = await measureAutonomy('LOW_RISK')
    expect(measurement.sampleSize).toBeGreaterThanOrEqual(10)
    expect(measurement.successRate).toBe(1)
    expect(measurement.recommendedLevel).toBe('ASSISTED')
  })

  test('high-risk graduation is blocked until explicit owner approval', async () => {
    const idempotencyKey = `high-risk-${prefix}`
    await recordAutonomyEvidence({
      actionClass: 'HIGH_RISK',
      attempts: 30,
      successes: 30,
      verifiedOutcomes: 30,
      source: 'integration-test',
      idempotencyKey,
    })
    process.env.AGENT007_OWNER_APPROVAL_SECRET = `test-secret-${prefix}`
    const blocked = await evaluateAndPersistAutonomy('HIGH_RISK')
    expect(blocked.decision).toBe('BLOCKED')
    expect(blocked.level).toBe('PROPOSED')
    expect(blocked.approvalId).toBeNull()
    expect(await getCurrentAutonomyLevel('HIGH_RISK')).toBe('PROPOSED')
  })

  test('high-risk owner approval enables only the first supported graduation', async () => {
    const challenge = await createFirstHighRiskApprovalChallenge()
    const approval = await approveFirstHighRiskGraduation({
      ownerUserId,
      challengeId: challenge.challengeId,
      challenge: challenge.challenge,
      approvalToken: process.env.AGENT007_OWNER_APPROVAL_SECRET!,
    })
    expect(approval.ownerUserId).toBe(ownerUserId)
    const graduated = await evaluateAndPersistAutonomy('HIGH_RISK')
    expect(graduated.decision).toBe('GRADUATED')
    expect(graduated.level).toBe('SUPERVISED')
    expect(graduated.approvalId).toBe(approval.approvalId)

    const second = await evaluateAndPersistAutonomy('HIGH_RISK')
    expect(second.level).toBe('SUPERVISED')
    expect(second.decision).toBe('UNCHANGED')
    expect(second.approvalId).toBeNull()
  })

  test('a safety violation forces a downgrade to the safest level', async () => {
    await recordAutonomyEvidence({
      actionClass: 'HIGH_RISK',
      attempts: 1,
      successes: 0,
      safetyViolations: 1,
      source: 'integration-test',
      idempotencyKey: `high-risk-safety-${prefix}`,
    })
    const downgraded = await evaluateAndPersistAutonomy('HIGH_RISK')
    expect(downgraded.level).toBe('PROPOSED')
    expect(downgraded.decision).toBe('DOWNGRADED')
  })
})
