import { describe, expect, test } from 'bun:test'
import {
  VENTURE_001_CONTRACT,
  assertDelegationAllowed,
  assertMissionTransition,
  authorityLevelFor,
  buildArtifactId,
  buildOutcomeId,
  canTransitionMission,
  runArchitectureControlPlaneSelfCheck,
} from '@/lib/architecture-control-plane'

describe('Architecture Control Plane — changes 5–9', () => {
  test('enforces the universal hierarchy', () => {
    expect(authorityLevelFor('ceo')).toBe('CEO')
    expect(authorityLevelFor('vid')).toBe('VID')
    expect(authorityLevelFor('scout')).toBe('LEADER')

    expect(() => assertDelegationAllowed({
      actorId: 'ceo', actorLevel: 'CEO', targetId: 'vid', targetLevel: 'VID',
    })).not.toThrow()

    expect(() => assertDelegationAllowed({
      actorId: 'ceo', actorLevel: 'CEO', targetId: 'scout', targetLevel: 'LEADER',
    })).toThrow(/Hierarchy violation/)

    expect(() => assertDelegationAllowed({
      actorId: 'vid', actorLevel: 'VID', targetId: 'scout', targetLevel: 'LEADER',
    })).not.toThrow()
  })

  test('keeps mission transitions formal and terminal states safe', () => {
    expect(canTransitionMission('PLANNED', 'IN_PROGRESS')).toBe(true)
    expect(canTransitionMission('VERIFIED', 'OWNER_APPROVAL')).toBe(true)
    expect(canTransitionMission('COMPLETED', 'IN_PROGRESS')).toBe(false)
    expect(() => assertMissionTransition('COMPLETED', 'IN_PROGRESS')).toThrow(/illegal transition/)
  })

  test('creates deterministic artifact and outcome identities', () => {
    const artifactInput = {
      ventureId: 'venture_001', missionId: 'm1', stage: 'REVIEW' as const,
      artifactType: 'data' as const, value: 'artifact payload',
    }
    expect(buildArtifactId(artifactInput)).toBe(buildArtifactId(artifactInput))

    const outcomeInput = {
      ventureId: 'venture_001', missionId: 'm1', type: 'TRANSACTION' as const,
      transactionId: 'txn_123', customerId: 'cus_123', amount: 25,
      occurredAt: '2026-08-16T19:00:00.000Z',
    }
    expect(buildOutcomeId(outcomeInput)).toBe(buildOutcomeId(outcomeInput))
    expect(buildArtifactId(artifactInput)).not.toBe(buildOutcomeId(outcomeInput))
  })

  test('Venture 001 contract is explicit and internally coherent', () => {
    expect(VENTURE_001_CONTRACT.ventureId).toBe('venture_001')
    expect(VENTURE_001_CONTRACT.allowedActions).toContain('record_transaction')
    expect(VENTURE_001_CONTRACT.forbiddenActions).toContain('transfer_funds')
    expect(VENTURE_001_CONTRACT.allowedActions.some((a) => VENTURE_001_CONTRACT.forbiddenActions.includes(a))).toBe(false)
    expect(VENTURE_001_CONTRACT.ownerApprovalRequiredFor).toContain('public_launch')
  })

  test('self-check reports a clean architecture baseline', () => {
    const result = runArchitectureControlPlaneSelfCheck()
    expect(result.ok).toBe(true)
    expect(result.findings).toEqual([])
  })
})
