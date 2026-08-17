import { describe, expect, test } from 'bun:test'
import { runArchitectureControlPlaneSelfCheck, assertDelegationAllowed, canTransitionMission, validateBusinessOutcome } from './architecture-control-plane'
import { runVentureFoundationContractAudit } from './venture-foundation-contract'
import { validateVenture001Definition } from './venture-001'
import { canAdvanceBookStage, canAdvanceCommercial, validateV001BookSpecification } from './venture-autonomy-control'

describe('Venture OS architecture 5–13', () => {
  test('universal hierarchy rejects CEO bypasses and accepts governed chain', () => {
    expect(() => assertDelegationAllowed({ actorId: 'ceo', actorLevel: 'CEO', targetId: 'aurora', targetLevel: 'LEADER' })).toThrow(/only to VID/)
    expect(() => assertDelegationAllowed({ actorId: 'vid', actorLevel: 'VID', targetId: 'aurora', targetLevel: 'LEADER' })).not.toThrow()
    expect(() => assertDelegationAllowed({ actorId: 'aurora', actorLevel: 'LEADER', targetId: 'quill', targetLevel: 'SPECIALIST' })).not.toThrow()
    expect(() => assertDelegationAllowed({ actorId: 'aurora', actorLevel: 'LEADER', targetId: 'prism', targetLevel: 'SPECIALIST' })).not.toThrow()
  })

  test('mission state machine has no terminal-state bypass', () => {
    expect(canTransitionMission('COMPLETED', 'IN_PROGRESS')).toBe(false)
    expect(canTransitionMission('VERIFIED', 'OWNER_APPROVAL')).toBe(true)
  })

  test('business outcome ledger rejects synthetic revenue', () => {
    const errors = validateBusinessOutcome({ ventureId: 'venture_001', missionId: null, type: 'REVENUE_RECOGNIZED', transactionId: null, customerId: null, amount: 10, currency: 'USD', source: 'test', occurredAt: new Date().toISOString(), metadata: {} })
    expect(errors.some((error) => /transactionId/i.test(error))).toBe(true)
  })

  test('V001 book contract enforces exactly 7 chapters and 25–30 pages', () => {
    expect(validateV001BookSpecification({ chapterCount: 7, pageCount: 25, chapters: ['1', '2', '3', '4', '5', '6', '7'] })).toEqual([])
    expect(validateV001BookSpecification({ chapterCount: 6, pageCount: 31, chapters: ['1', '2'] }).length).toBeGreaterThan(0)
    expect(canAdvanceBookStage('QA', 'PUBLISH_READY')).toBe(true)
    expect(canAdvanceBookStage('PUBLISHED', 'QA')).toBe(false)
  })

  test('commercial lifecycle has monotonic payment progression', () => {
    expect(canAdvanceCommercial('PAYMENT_PENDING', 'PAID')).toBe(true)
    expect(canAdvanceCommercial('PAID', 'PROSPECT')).toBe(false)
    expect(canAdvanceCommercial('FULFILLED', 'REFUND_PENDING')).toBe(true)
  })

  test('V001 definition remains canonical', () => {
    expect(validateVenture001Definition()).toEqual([])
  })

  test('combined architecture contract passes without synthetic success', () => {
    expect(runArchitectureControlPlaneSelfCheck().ok).toBe(true)
    const audit = runVentureFoundationContractAudit()
    expect(audit.ok).toBe(true)
    expect(audit.checks).toHaveLength(10)
    expect(audit.checks.every((check) => check.ok)).toBe(true)
  })
})
