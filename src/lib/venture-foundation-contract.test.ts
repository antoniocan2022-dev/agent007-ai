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
    expect(() => validateBusinessOutcome({
      ventureId: 'venture_001', missionId: 'm1', type: 'REVENUE_RECOGNIZED',
      amount: 25, currency: 'USD', status: 'recognized', sourceTransactionId: undefined,
    })).toThrow(/sourceTransactionId/)
  })

  test('V001 book contract enforces exactly 7 chapters and 25–30 pages', () => {
    const result = validateV001BookSpecification({ title: 'Book', chapterCount: 7, pageCount: 28 })
    expect(result.ok).toBe(true)
    expect(validateV001BookSpecification({ title: 'Book', chapterCount: 6, pageCount: 28 }).ok).toBe(false)
    expect(validateV001BookSpecification({ title: 'Book', chapterCount: 7, pageCount: 31 }).ok).toBe(false)
  })

  test('commercial lifecycle has monotonic payment progression', () => {
    expect(canAdvanceCommercial('INQUIRY', 'QUALIFIED')).toBe(true)
    expect(canAdvanceCommercial('QUALIFIED', 'PAID')).toBe(true)
    expect(canAdvanceCommercial('PAID', 'QUALIFIED')).toBe(false)
  })

  test('V001 definition remains canonical', () => {
    const result = validateVenture001Definition()
    expect(result.ok).toBe(true)
    expect(result.findings).toEqual([])
  })

  test('combined architecture contract passes without synthetic success', () => {
    expect(runArchitectureControlPlaneSelfCheck().ok).toBe(true)
    expect(runVentureFoundationContractAudit().ok).toBe(true)
    expect(validateV001BookSpecification({ title: 'Book', chapterCount: 7, pageCount: 28 }).ok).toBe(true)
    expect(canAdvanceBookStage('DRAFT', 'CONTENT_REVIEW')).toBe(true)
  })
})
