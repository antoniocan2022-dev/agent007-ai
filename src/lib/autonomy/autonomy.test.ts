import { describe, expect, test } from 'bun:test'
import {
  AUTONOMY_DIMENSIONS,
  DEFAULT_AUTONOMY_GATES,
  calculateAutonomyIndex,
  type AutonomyMeasurements,
} from './autonomy-index'
import { classifyAutonomyAction } from './autonomy-policy'
import { buildAutonomyTelemetrySummary } from './autonomy-telemetry'
import {
  canTransition,
  getAllowedMissionEvents,
  isTerminalMissionState,
  transitionMission,
} from './mission-state'
import { scoreExecutiveDecision } from './decision-score'

const strongMeasurements = (): AutonomyMeasurements =>
  Object.fromEntries(
    Object.keys(AUTONOMY_DIMENSIONS).map((key) => [
      key,
      { score: 98, coverage: 1, sampleSize: 100 },
    ]),
  ) as AutonomyMeasurements

describe('Autonomy Index', () => {
  test('passes only when every dimension has adequate evidence', () => {
    const result = calculateAutonomyIndex(strongMeasurements(), DEFAULT_AUTONOMY_GATES)

    expect(result.score).toBe(98)
    expect(result.passed).toBe(true)
    expect(result.confidence).toBe(100)
    expect(result.failingGates).toEqual([])
  })

  test('does not let aggregate coverage hide a blind dimension', () => {
    const measurements = strongMeasurements()
    measurements.learning = { score: 100, coverage: 0, sampleSize: 0 }

    const result = calculateAutonomyIndex(measurements, DEFAULT_AUTONOMY_GATES)

    expect(result.gates.coverage).toBe(false)
    expect(result.gates.sampleSize).toBe(false)
    expect(result.score).toBeLessThanOrEqual(89)
    expect(result.passed).toBe(false)
  })
})

describe('Autonomy Governor', () => {
  test('requires approval when a financial cost is unknown', () => {
    const result = classifyAutonomyAction({
      category: 'financial',
      reversible: true,
      externalSideEffect: false,
      affectsProduction: false,
      affectsSecurity: false,
      affectsFinancialState: true,
      containsPersonalData: false,
      policyApproved: true,
      confidence: 0.99,
    })

    expect(result.autonomous).toBe(false)
    expect(result.authority).toBe('HUMAN_APPROVAL')
  })

  test('forbids destructive actions even when flags are inconsistent', () => {
    const result = classifyAutonomyAction({
      category: 'data_destructive',
      reversible: true,
      externalSideEffect: false,
      affectsProduction: false,
      affectsSecurity: false,
      affectsFinancialState: false,
      containsPersonalData: false,
      policyApproved: true,
      confidence: 1,
    })

    expect(result.authority).toBe('FORBIDDEN')
    expect(result.autonomous).toBe(false)
  })
})

describe('Mission state machine', () => {
  test('supports failure and autonomous recovery', () => {
    expect(transitionMission('EXECUTING', 'FAIL')).toBe('FAILED')
    expect(transitionMission('FAILED', 'RECOVER')).toBe('RECOVERING')
    expect(transitionMission('RECOVERING', 'START')).toBe('EXECUTING')
  })

  test('requires verification before completion', () => {
    expect(canTransition('EXECUTING', 'COMPLETE')).toBe(false)
    expect(canTransition('VERIFYING', 'COMPLETE')).toBe(true)
    expect(isTerminalMissionState('COMPLETED')).toBe(true)
    expect(getAllowedMissionEvents('COMPLETED')).toEqual([])
  })
})

describe('Executive decision scoring', () => {
  test('returns deterministic priority for strong evidence', () => {
    const result = scoreExecutiveDecision({
      expectedValue: 100,
      probabilityOfSuccess: 100,
      strategicAlignment: 100,
      urgency: 80,
      reversibility: 100,
      confidence: 100,
      risk: 0,
      cost: 0,
    })

    expect(result.score).toBe(88)
    expect(result.expectedReturn).toBe(100)
    expect(result.riskAdjustedValue).toBe(100)
    expect(result.priority).toBe('P1')
  })
})

describe('Autonomy telemetry', () => {
  test('treats missing evidence as missing coverage, not success', () => {
    const summary = buildAutonomyTelemetrySummary([
      { eligible: true, executionAutonomous: true },
      { eligible: true, executionAutonomous: false },
    ])

    expect(summary.measurements.execution.score).toBe(50)
    expect(summary.measurements.execution.coverage).toBe(1)
    expect(summary.measurements.goalMission.coverage).toBe(0)
    expect(summary.index.passed).toBe(false)
    expect(summary.index.failingGates).toContain('coverage')
    expect(summary.index.failingGates).toContain('sampleSize')
  })
})
