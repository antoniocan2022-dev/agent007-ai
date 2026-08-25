import { describe, expect, test } from 'bun:test'
import { formatCeoVentureEvidence, extractVentureId, type CeoVentureState } from '../src/lib/ceo-venture-state'

describe('CEO canonical venture decision integration', () => {
  test('CEO evidence includes the canonical decision and authority result', () => {
    const state: CeoVentureState = {
      ventureId: 'venture_001',
      venture: null,
      commercial: null,
      kpi: null,
      decision: {
        engineVersion: 6,
        businessId: 'biz_test',
        lifecycle: 'active',
        decision: 'experiment',
        confidence: 0.82,
        autonomousEligible: true,
        irreversibleActionBlocked: false,
        score: 68,
        reasons: [],
        scorecard: {},
      },
      operationCheckpoint: null,
    }
    const evidence = formatCeoVentureEvidence(state)
    expect(evidence).toContain('CANONICAL_DECISION: decision=experiment')
    expect(evidence).toContain('confidence=0.820')
    expect(evidence).toContain('autonomousEligible=true')
    expect(evidence).toContain('irreversibleActionBlocked=false')
    expect(evidence).toContain('TRUTH RULE')
  })

  test('venture objective parsing remains deterministic', () => {
    expect(extractVentureId('Review Venture 001 performance')).toBe('venture_001')
    expect(extractVentureId('venture-002 requires attention')).toBe('venture_002')
    expect(extractVentureId('portfolio review')).toBeNull()
  })
})
