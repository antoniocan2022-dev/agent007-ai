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
import {
  allDescendantsOf,
  ancestorsOf,
  businessScopeFor,
  commercialBusinessIds,
  directReportsOf,
  leadersForBusiness,
  specialistsForBusiness,
  validateCommercialOrganization,
} from '@/lib/commercial-organization'

describe('Architecture Control Plane — canonical organization and commercial integrity', () => {
  test('canonical organization graph is internally coherent', () => {
    expect(validateCommercialOrganization()).toEqual([])
    expect(directReportsOf('ceo')).toEqual(['vid'])
    expect(directReportsOf('vid')).toContain('scout')
    expect(directReportsOf('vid')).toContain('vertex')
    expect(directReportsOf('vertex')).toEqual(['forge'])
    expect(directReportsOf('aurora')).toEqual(['quill', 'prism', 'seo_cro_specialist'])
    expect(ancestorsOf('developer')).toContain('forge')
    expect(allDescendantsOf('vid')).toContain('developer')
  })

  test('authority resolution is derived from the canonical organization graph', () => {
    expect(authorityLevelFor('ceo')).toBe('CEO')
    expect(authorityLevelFor('vid')).toBe('VID')
    expect(authorityLevelFor('scout')).toBe('LEADER')
    expect(authorityLevelFor('local_business_intelligence')).toBe('SPECIALIST')
    expect(authorityLevelFor('developer')).toBe('SPECIALIST')
    expect(authorityLevelFor('web_search')).toBe('TOOL')
    expect(authorityLevelFor('not_registered')).toBe('UNKNOWN')

    expect(() => assertDelegationAllowed({ actorId: 'ceo', actorLevel: 'CEO', targetId: 'vid', targetLevel: 'VID' })).not.toThrow()
    expect(() => assertDelegationAllowed({ actorId: 'ceo', actorLevel: 'CEO', targetId: 'scout', targetLevel: 'LEADER' })).toThrow(/Hierarchy violation/)
    expect(() => assertDelegationAllowed({ actorId: 'vid', actorLevel: 'VID', targetId: 'scout', targetLevel: 'LEADER' })).not.toThrow()
    expect(() => assertDelegationAllowed({ actorId: 'revenue_recovery_leader', actorLevel: 'LEADER', targetId: 'local_business_intelligence', targetLevel: 'SPECIALIST' })).not.toThrow()
    expect(() => assertDelegationAllowed({ actorId: 'revenue_recovery_leader', actorLevel: 'LEADER', targetId: 'job_matching', targetLevel: 'SPECIALIST' })).toThrow(/direct-report specialists/)
    expect(() => assertDelegationAllowed({ actorId: 'aurora', actorLevel: 'LEADER', targetId: 'web_search', targetLevel: 'TOOL' })).not.toThrow()
  })

  test('business scope is canonical and scales by data, not authority changes', () => {
    const businessIds = commercialBusinessIds()
    expect(businessIds).toEqual(expect.arrayContaining(['career-command', 'operations-kit', 'revenue-recovery']))
    expect(businessIds).toEqual([...businessIds].sort())
    expect(businessScopeFor('revenue_recovery_leader')).toEqual(['revenue-recovery'])
    expect(businessScopeFor('scout')).toEqual(['revenue-recovery', 'operations-kit', 'career-command'])
    expect(leadersForBusiness('revenue-recovery').map((leader) => leader.id)).toContain('revenue_recovery_leader')
    expect(leadersForBusiness('career-command').map((leader) => leader.id)).toContain('scout')
    expect(specialistsForBusiness('operations-kit').map((specialist) => specialist.id)).toContain('workflow_automation')
    expect(leadersForBusiness('unknown-business')).toEqual([])
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
