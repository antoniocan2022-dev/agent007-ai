import { describe, expect, test } from 'bun:test'
import { CEO_VENTURE_MANDATE, validateVentureMandate, isSpendWithinGuardrail, canActAutonomously } from './venture-mandate'
import { calculateOpportunityScore, calculateVentureHealth, isScorecardContractValid } from './venture-scorecard'

describe('CEO Venture Mandate', () => {
  test('mandate is internally valid', () => {
    expect(validateVentureMandate()).toEqual([])
    expect(CEO_VENTURE_MANDATE.maximumInitialCapital).toBe(100)
    expect(CEO_VENTURE_MANDATE.targetPortfolioSize).toBe(3)
  })

  test('spend and authority guardrails are deterministic', () => {
    expect(isSpendWithinGuardrail(10, 0)).toBe(true)
    expect(isSpendWithinGuardrail(10.01, 0)).toBe(false)
    expect(isSpendWithinGuardrail(5, 100)).toBe(false)
    expect(canActAutonomously('research')).toBe(true)
    expect(canActAutonomously('banking')).toBe(false)
  })
})

describe('Venture Scorecard', () => {
  test('scorecard contracts are valid', () => {
    expect(isScorecardContractValid()).toEqual([])
  })

  test('strong opportunity can advance only with strong evidence', () => {
    const result = calculateOpportunityScore({
      marketPain: 95,
      willingnessToPay: 94,
      competition: 82,
      acquisitionDifficulty: 88,
      automationPotential: 97,
      startupCost: 95,
      speedToMvp: 92,
      evidenceConfidence: 0.9,
      evidence: [
        { source: 'market-research', statement: 'Observed repeated customer pain.', confidence: 0.9 },
        { source: 'pricing-research', statement: 'Comparable offers have paying demand.', confidence: 0.9 },
      ],
    })

    expect(result.score).toBeGreaterThanOrEqual(87)
    expect(result.decisionReady).toBe(true)
    expect(result.confidence).toBe(0.9)
  })

  test('missing evidence cannot become an autonomous positive decision', () => {
    const result = calculateOpportunityScore({
      marketPain: 100,
      willingnessToPay: 100,
      competition: 100,
      acquisitionDifficulty: 100,
      automationPotential: 100,
      startupCost: 100,
      speedToMvp: 100,
      evidenceConfidence: 1,
      evidence: [],
    })

    expect(result.score).toBe(100)
    expect(result.decisionReady).toBe(false)
    expect(result.blockingReasons).toContain('No evidence supplied.')
  })

  test('health score distinguishes scale from weak evidence', () => {
    const scale = calculateVentureHealth({
      marketEvidence: 95,
      demand: 95,
      conversion: 90,
      revenue: 92,
      margin: 90,
      customerSatisfaction: 90,
      acquisitionEfficiency: 90,
      automation: 95,
      operationalRisk: 90,
      evidenceConfidence: 0.9,
      evidence: [
        { source: 'payments', statement: 'Revenue verified.', confidence: 0.9 },
        { source: 'customers', statement: 'Retention and demand verified.', confidence: 0.9 },
      ],
    })
    expect(scale.decision).toBe('scale')

    const weak = calculateVentureHealth({
      marketEvidence: 20,
      demand: 10,
      conversion: 10,
      revenue: 0,
      margin: 0,
      customerSatisfaction: 10,
      acquisitionEfficiency: 10,
      automation: 20,
      operationalRisk: 20,
      evidenceConfidence: 0.3,
      evidence: [{ source: 'observation', statement: 'Weak signal only.', confidence: 0.3 }],
    })
    expect(weak.decision).toBe('kill_or_pivot')
    expect(weak.blockingReasons.length).toBeGreaterThan(0)
  })
})
