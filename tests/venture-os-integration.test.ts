import { describe, expect, test } from 'bun:test'
import { assertDelegationAllowed, canTransitionMission, validateBusinessOutcome } from '@/lib/architecture-control-plane'
import { canAdvanceBookStage, canAdvanceCommercial, validateV001BookSpecification, VENTURE_TEMPLATE_V1, runV001EvidenceTest } from '@/lib/venture-autonomy-control'

describe('Venture OS closed-loop integration invariants', () => {
  test('hierarchy requires CEO → VID → leader → specialist/tool', () => {
    expect(() => assertDelegationAllowed({ actorId: 'agent007', actorLevel: 'CEO', targetId: 'vid', targetLevel: 'VID' })).not.toThrow()
    expect(() => assertDelegationAllowed({ actorId: 'vid', actorLevel: 'VID', targetId: 'pulse', targetLevel: 'LEADER' })).not.toThrow()
    // Use a canonical registered specialist. The control plane deliberately rejects
    // fabricated/unknown identities, so a placeholder such as "custom_specialist"
    // must not be used for a successful hierarchy assertion.
    expect(() => assertDelegationAllowed({ actorId: 'pulse', actorLevel: 'LEADER', targetId: 'quill', targetLevel: 'SPECIALIST' })).not.toThrow()
    expect(() => assertDelegationAllowed({ actorId: 'agent007', actorLevel: 'CEO', targetId: 'pulse', targetLevel: 'LEADER' })).toThrow()
    expect(() => assertDelegationAllowed({ actorId: 'vid', actorLevel: 'VID', targetId: 'custom_specialist', targetLevel: 'SPECIALIST' })).toThrow(/unregistered target identity/)
  })

  test('mission state machine cannot bypass review or approval', () => {
    expect(canTransitionMission('PLANNED', 'IN_PROGRESS')).toBe(true)
    expect(canTransitionMission('IN_PROGRESS', 'REVIEW')).toBe(true)
    expect(canTransitionMission('REVIEW', 'DELIVERED')).toBe(true)
    expect(canTransitionMission('DELIVERED', 'VERIFIED')).toBe(true)
    expect(canTransitionMission('VERIFIED', 'OWNER_APPROVAL')).toBe(true)
    expect(canTransitionMission('PLANNED', 'COMPLETED')).toBe(false)
    expect(canTransitionMission('COMPLETED', 'IN_PROGRESS')).toBe(false)
  })

  test('artifact-backed business outcomes remain evidence-gated', () => {
    const common = { ventureId: 'venture_001', missionId: 'mission_x', customerId: 'customer_x', amount: 25, currency: 'USD', source: 'provider:test', occurredAt: new Date().toISOString(), metadata: {} }
    expect(validateBusinessOutcome({ ...common, type: 'TRANSACTION', transactionId: 'txn_123' })).toEqual([])
    expect(validateBusinessOutcome({ ...common, type: 'REVENUE_RECOGNIZED', transactionId: null })).toContain('REVENUE_RECOGNIZED requires transactionId evidence.')
  })

  test('V001 book pipeline is forward-only and release-gated', () => {
    expect(canAdvanceBookStage('BRIEF', 'OUTLINE')).toBe(true)
    expect(canAdvanceBookStage('QA', 'PUBLISH_READY')).toBe(true)
    expect(canAdvanceBookStage('PUBLISHED', 'BRIEF')).toBe(false)
    expect(validateV001BookSpecification({ chapterCount: 7, pageCount: 25, chapters: ['1','2','3','4','5','6','7'] })).toEqual([])
    expect(validateV001BookSpecification({ chapterCount: 7, pageCount: 31, chapters: ['1','2','3','4','5','6','7'] }).length).toBeGreaterThan(0)
  })

  test('commercial lifecycle has explicit terminal outcomes', () => {
    expect(canAdvanceCommercial('PAYMENT_PENDING', 'PAID')).toBe(true)
    expect(canAdvanceCommercial('PAID', 'FULFILLMENT')).toBe(true)
    expect(canAdvanceCommercial('FULFILLED', 'REFUND_PENDING')).toBe(true)
    expect(canAdvanceCommercial('REFUNDED', 'PAID')).toBe(false)
    expect(canAdvanceCommercial('CANCELLED', 'PAID')).toBe(false)
  })

  test('template safety boundaries remain canonical', () => {
    expect(VENTURE_TEMPLATE_V1.templateId).toBe('venture_template_v1')
    expect(VENTURE_TEMPLATE_V1.requiredCapabilities.length).toBeGreaterThan(0)
    expect(VENTURE_TEMPLATE_V1.safety.forbiddenActions).toContain('transfer_funds')
    expect(VENTURE_TEMPLATE_V1.safety.ownerApprovalActions).toContain('production_deploy')
  })

  test('V001 evidence test is deterministic without production DB', async () => {
    const result = await runV001EvidenceTest()
    expect(result.ventureId).toBe('venture_001')
    expect(result.checks.sevenEvidenceDimensions).toBe(true)
    expect(result.checks.readinessGatePolicy).toBe(true)
    expect(result.checks.bookSpecification).toBe(true)
    expect(result.checks.commercialLifecycle).toBe(true)
    expect(result.checks.noSyntheticRevenue).toBe(true)
  })
})
