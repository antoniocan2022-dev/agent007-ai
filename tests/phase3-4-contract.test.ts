import { describe, expect, it } from 'bun:test'
import {
  CAREER_STAGES,
  PHASE4_BUSINESS,
  validateCareerApplicationTransition,
  validateCareerStageTransition,
  validatePhase4Contracts,
} from '@/lib/phase4-career-command'
import {
  OPERATIONS_STAGES,
  PHASE3_BUSINESS,
  scoreAutomationFeasibility,
  validateOperationsStageTransition,
  validatePhase3Contracts,
} from '@/lib/phase3-operations-kit'

describe('Phase 3 — Small Business Operations Kit', () => {
  it('keeps the canonical business identity and ten-stage flow', () => {
    expect(PHASE3_BUSINESS).toBe('operations-kit')
    expect(OPERATIONS_STAGES).toHaveLength(10)
    expect(validatePhase3Contracts()).toEqual([])
  })

  it('allows only adjacent forward stage transitions', () => {
    for (let index = 0; index < OPERATIONS_STAGES.length - 1; index += 1) {
      expect(validateOperationsStageTransition(OPERATIONS_STAGES[index], OPERATIONS_STAGES[index + 1])).toBe(true)
    }
    expect(validateOperationsStageTransition('intake', 'diagnose')).toBe(false)
  })

  it('uses bounded deterministic automation-feasibility scoring', () => {
    expect(scoreAutomationFeasibility({
      repetitive: true,
      structuredInputs: true,
      deterministicOutput: true,
      externalSideEffects: false,
      sensitiveDecision: false,
    })).toBe(100)
    expect(scoreAutomationFeasibility({
      repetitive: false,
      structuredInputs: false,
      deterministicOutput: false,
      externalSideEffects: true,
      sensitiveDecision: true,
    })).toBe(0)
  })
})

describe('Phase 4 — Career Command Center', () => {
  it('keeps the canonical business identity and eight-stage flow', () => {
    expect(PHASE4_BUSINESS).toBe('career-command')
    expect(CAREER_STAGES).toHaveLength(8)
    expect(validatePhase4Contracts()).toEqual([])
  })

  it('requires sequential career stages', () => {
    for (let index = 0; index < CAREER_STAGES.length - 1; index += 1) {
      expect(validateCareerStageTransition(CAREER_STAGES[index], CAREER_STAGES[index + 1])).toBe(true)
    }
    expect(validateCareerStageTransition('profile', 'submit')).toBe(false)
  })

  it('cannot bypass explicit user approval before submission', () => {
    expect(validateCareerApplicationTransition('ready', 'approval_pending')).toBe(true)
    expect(validateCareerApplicationTransition('approval_pending', 'approved')).toBe(true)
    expect(validateCareerApplicationTransition('approved', 'submitted')).toBe(true)
    expect(validateCareerApplicationTransition('ready', 'submitted')).toBe(false)
    expect(validateCareerApplicationTransition('approval_pending', 'submitted')).toBe(false)
    expect(validateCareerApplicationTransition('draft', 'approved')).toBe(false)
  })

  it('does not permit autonomous hiring or eligibility transitions', () => {
    expect(validateCareerApplicationTransition('tracking', 'approved')).toBe(false)
    expect(validateCareerApplicationTransition('closed', 'approved')).toBe(false)
  })
})
