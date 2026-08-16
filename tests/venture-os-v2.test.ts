import { describe, expect, test } from 'bun:test'
import {
  canAdvanceBookStage,
  canAdvanceCommercial,
  VENTURE_TEMPLATE_V1,
  runV001EvidenceTest,
} from '@/lib/venture-autonomy-control'

describe('Venture OS v2 architectural invariants', () => {
  test('V001 book pipeline has only canonical forward transitions', () => {
    expect(canAdvanceBookStage('BRIEF', 'OUTLINE')).toBe(true)
    expect(canAdvanceBookStage('OUTLINE', 'DRAFT')).toBe(true)
    expect(canAdvanceBookStage('PUBLISHED', 'BRIEF')).toBe(false)
    expect(canAdvanceBookStage('QA', 'PUBLISHED')).toBe(false)
  })

  test('commercial lifecycle rejects impossible transitions', () => {
    expect(canAdvanceCommercial('PAYMENT_PENDING', 'PAID')).toBe(true)
    expect(canAdvanceCommercial('PAID', 'PROSPECT')).toBe(false)
    expect(canAdvanceCommercial('REFUNDED', 'PAID')).toBe(false)
  })

  test('venture template is canonical and safety-bounded', () => {
    expect(VENTURE_TEMPLATE_V1.templateId).toBe('venture_template_v1')
    expect(new Set(VENTURE_TEMPLATE_V1.requiredCapabilities).size).toBe(VENTURE_TEMPLATE_V1.requiredCapabilities.length)
    expect(VENTURE_TEMPLATE_V1.safety.forbiddenActions).not.toContain('record_transaction')
    expect(VENTURE_TEMPLATE_V1.safety.forbiddenActions).toContain('transfer_funds')
  })

  test('end-to-end evidence test never fabricates readiness', async () => {
    const result = await runV001EvidenceTest()
    expect(result.ventureId).toBe('venture_001')
    expect(result.checks.sevenEvidenceDimensions).toBe(true)
    expect(result.checks.noSyntheticRevenue).toBe(true)
  })
})
