import { describe, expect, test } from 'bun:test'
import { assertDelegationAllowed, canTransitionMission, runArchitectureControlPlaneSelfCheck, validateBusinessOutcome } from '@/lib/architecture-control-plane'
import { canAdvanceBookStage, canAdvanceCommercial, validateV001BookSpecification, VENTURE_TEMPLATE_V1, runV001EvidenceTest } from '@/lib/venture-autonomy-control'

describe('Agent007 architecture 5-16 invariants', () => {
  test('hierarchy rejects forged authority identities', () => {
    expect(() => assertDelegationAllowed({ actorId: 'ceo', actorLevel: 'CEO', targetId: 'vid', targetLevel: 'VID' })).not.toThrow()
    expect(() => assertDelegationAllowed({ actorId: 'ceo', actorLevel: 'SPECIALIST', targetId: 'vid', targetLevel: 'VID' })).toThrow()
    expect(() => assertDelegationAllowed({ actorId: 'vid', actorLevel: 'VID', targetId: 'unknown-ceo', targetLevel: 'CEO' })).toThrow()
    expect(runArchitectureControlPlaneSelfCheck().ok).toBe(true)
  })

  test('mission state machine is fail-closed and terminal states stay terminal', () => {
    expect(canTransitionMission('PLANNED', 'IN_PROGRESS')).toBe(true)
    expect(canTransitionMission('VERIFIED', 'OWNER_APPROVAL')).toBe(true)
    expect(canTransitionMission('COMPLETED', 'IN_PROGRESS')).toBe(false)
    expect(canTransitionMission('FAILED', 'IN_PROGRESS')).toBe(false)
  })

  test('business outcome ledger rejects synthetic monetary evidence', () => {
    const base = { ventureId: 'venture_001', missionId: null, customerId: null, amount: 10, currency: 'USD', source: 'test', occurredAt: new Date().toISOString(), metadata: {} }
    expect(validateBusinessOutcome({ ...base, type: 'REVENUE_RECOGNIZED', transactionId: null })).toContain('REVENUE_RECOGNIZED requires transactionId evidence.')
    expect(validateBusinessOutcome({ ...base, type: 'TRANSACTION', transactionId: 'txn_1' })).toEqual([])
    expect(validateBusinessOutcome({ ...base, type: 'KPI_SNAPSHOT', transactionId: null, amount: null, currency: null })).toEqual([])
  })

  test('V001 book pipeline has only canonical forward transitions', () => {
    expect(canAdvanceBookStage('BRIEF', 'OUTLINE')).toBe(true)
    expect(canAdvanceBookStage('OUTLINE', 'DRAFT')).toBe(true)
    expect(canAdvanceBookStage('PUBLISHED', 'BRIEF')).toBe(false)
    expect(canAdvanceBookStage('QA', 'PUBLISHED')).toBe(false)
  })

  test('V001 specification is exactly seven chapters and 25-30 pages', () => {
    expect(validateV001BookSpecification({ chapterCount: 7, pageCount: 25, chapters: ['1','2','3','4','5','6','7'] })).toEqual([])
    expect(validateV001BookSpecification({ chapterCount: 7, pageCount: 30, chapters: ['1','2','3','4','5','6','7'] })).toEqual([])
    expect(validateV001BookSpecification({ chapterCount: 6, pageCount: 25, chapters: ['1','2','3','4','5','6'] }).length).toBeGreaterThan(0)
    expect(validateV001BookSpecification({ chapterCount: 7, pageCount: 31, chapters: ['1','2','3','4','5','6','7'] }).length).toBeGreaterThan(0)
    expect(validateV001BookSpecification({ chapterCount: 7, pageCount: 25, chapters: ['1','2','3','4','5','6','6'] }).length).toBeGreaterThan(0)
  })

  test('commercial lifecycle rejects impossible transitions', () => {
    expect(canAdvanceCommercial('PAYMENT_PENDING', 'PAID')).toBe(true)
    expect(canAdvanceCommercial('PAID', 'PROSPECT')).toBe(false)
    expect(canAdvanceCommercial('REFUNDED', 'PAID')).toBe(false)
  })

  test('venture template is canonical, reusable, and safety-bounded', () => {
    expect(VENTURE_TEMPLATE_V1.templateId).toBe('venture_template_v1')
    expect(new Set(VENTURE_TEMPLATE_V1.requiredCapabilities).size).toBe(VENTURE_TEMPLATE_V1.requiredCapabilities.length)
    expect(VENTURE_TEMPLATE_V1.safety.forbiddenActions).toContain('transfer_funds')
    expect(VENTURE_TEMPLATE_V1.safety.ownerApprovalActions).toContain('production_deploy')
  })

  test('end-to-end V001 evidence test never fabricates readiness or revenue', async () => {
    const result = await runV001EvidenceTest()
    expect(result.ventureId).toBe('venture_001')
    expect(result.checks.sevenEvidenceDimensions).toBe(true)
    expect(result.checks.readinessGatePolicy).toBe(true)
    expect(result.checks.commercialLifecycle).toBe(true)
    expect(result.checks.canonicalCommercialPersistence).toBe(true)
    expect(result.checks.noSyntheticRevenue).toBe(true)
  })
})
