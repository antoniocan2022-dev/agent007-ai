import { describe, expect, test } from 'bun:test'
import { runArchitectureControlPlaneSelfCheck, assertDelegationAllowed, canTransitionMission, validateBusinessOutcome } from './architecture-control-plane'
import { runVentureFoundationContractAudit } from './venture-foundation-contract'
import { validateVenture001Definition } from './venture-001'
import { canAdvanceBookStage, canAdvanceCommercial, validateV001BookSpecification } from './venture-autonomy-control'

describe('Venture OS architecture 5–13', () => {
  test('universal hierarchy rejects CEO bypasses and accepts governed chain', () => {
    expect(() => assertDelegationAllowed({ actorId: 'ceo', actorLevel: 'CEO', targetId: 'aurora', targetLevel: 'LEADER' })).toThrow(/CEO may delegate only to its VID/)
    expect(() => assertDelegationAllowed({ actorId: 'vid', actorLevel: 'VID', targetId: 'aurora', targetLevel: 'LEADER' })).not.toThrow()
    expect(() => assertDelegationAllowed({ actorId: 'aurora', actorLevel: 'LEADER', targetId: 'quill', targetLevel: 'SPECIALIST' })).not.toThrow()
    expect(() => assertDelegationAllowed({ actorId: 'aurora', actorLevel: 'LEADER', targetId: 'prism', targetLevel: 'SPECIALIST' })).not.toThrow()
  })

  test('mission state machine has no terminal-state bypass', () => {
    expect(canTransitionMission('COMPLETED', 'IN_PROGRESS')).toBe(false)
    expect(canTransitionMission('VERIFIED', 'OWNER_APPROVAL')).toBe(true)
  })

  test('business outcome ledger rejects synthetic revenue', () => {
    const errors = validateBusinessOutcome({
      ventureId: 'venture_001', missionId: 'm1', type: 'REVENUE_RECOGNIZED',
      transactionId: null, customerId: null, amount: 25, currency: 'USD',
      source: 'synthetic-test', occurredAt: new Date().toISOString(), metadata: {},
    })
    expect(errors.some((error) => /transactionId evidence/.test(error))).toBe(true)
  })

  test('V001 book contract enforces exactly 7 chapters and 25–30 pages', () => {
    expect(validateV001BookSpecification({ chapterCount: 7, pageCount: 28 }).length).toBe(0)
    expect(validateV001BookSpecification({ chapterCount: 6, pageCount: 28 }).length).toBeGreaterThan(0)
    expect(validateV001BookSpecification({ chapterCount: 7, pageCount: 31 }).length).toBeGreaterThan(0)
  })

  test('commercial lifecycle has monotonic payment progression', () => {
    expect(canAdvanceCommercial('PROSPECT', 'QUALIFIED')).toBe(true)
    expect(canAdvanceCommercial('QUALIFIED', 'OFFERED')).toBe(true)
    expect(canAdvanceCommercial('PAID', 'QUALIFIED')).toBe(false)
  })

  test('V001 definition remains canonical', () => {
    expect(validateVenture001Definition()).toEqual([])
  })

  test('combined architecture contract passes without synthetic success', () => {
    expect(runArchitectureControlPlaneSelfCheck().ok).toBe(true)
    expect(runVentureFoundationContractAudit().ok).toBe(true)
    expect(validateV001BookSpecification({ chapterCount: 7, pageCount: 28 }).length).toBe(0)
    expect(canAdvanceBookStage('DRAFT', 'EDIT')).toBe(true)
  })
})
