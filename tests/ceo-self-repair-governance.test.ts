import { describe, expect, test } from 'bun:test'
import { classifySelfRepairRiskTier } from '@/lib/ceo-self-repair-governance'

describe('P0: governed self-repair risk tiering', () => {
  test.each([
    'confusion', 'typo_tolerance', 'incomplete_message', 'reference', 'continuation', 'self_assessment',
  ] as const)('%s with no domain is low risk (eligible for autonomous correction)', (inputClass) => {
    expect(classifySelfRepairRiskTier({ inputClass })).toBe('low')
  })

  test.each([
    'correction', 'strategic_question', 'explanation_request', 'action_request', 'unclassified',
  ] as const)('%s is high risk regardless of domain -- not on the allowlist', (inputClass) => {
    expect(classifySelfRepairRiskTier({ inputClass })).toBe('high')
    expect(classifySelfRepairRiskTier({ inputClass, domain: 'general_web' })).toBe('high')
  })

  test.each([
    'public_equity', 'security', 'regulatory', 'business_due_diligence', 'internal_finance',
  ])('an otherwise low-risk inputClass becomes high risk when the domain is %s', (domain) => {
    expect(classifySelfRepairRiskTier({ inputClass: 'self_assessment', domain })).toBe('high')
    expect(classifySelfRepairRiskTier({ inputClass: 'confusion', domain })).toBe('high')
  })

  test('domain matching is case-insensitive', () => {
    expect(classifySelfRepairRiskTier({ inputClass: 'self_assessment', domain: 'PUBLIC_EQUITY' })).toBe('high')
  })

  test('an unrecognized, non-critical domain does not force high risk for an allowlisted inputClass', () => {
    expect(classifySelfRepairRiskTier({ inputClass: 'self_assessment', domain: 'general_web' })).toBe('low')
    expect(classifySelfRepairRiskTier({ inputClass: 'self_assessment' })).toBe('low')
  })
})
