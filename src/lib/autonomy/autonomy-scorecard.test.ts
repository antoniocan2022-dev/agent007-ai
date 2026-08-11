import { describe, expect, it } from 'bun:test'
import { calculateAutonomyScorecard, meetsAutonomyTarget, type OperationalMissionEvidence } from './autonomy-scorecard'

const mission = (overrides: Partial<OperationalMissionEvidence> = {}): OperationalMissionEvidence => ({
  completed: true,
  independentlyVerified: true,
  failureOccurred: false,
  recoveredAfterFailure: false,
  resumedWithoutHumanRestart: true,
  executedAutonomously: true,
  outcomeQuality: 100,
  ...overrides,
})

describe('operational autonomy scorecard', () => {
  it('does not claim an established score with insufficient evidence', () => {
    const scorecard = calculateAutonomyScorecard([mission(), mission()])

    expect(scorecard.confidence).toBe('insufficient')
    expect(meetsAutonomyTarget(scorecard, 95)).toBe(false)
  })

  it('distinguishes owner-approved execution from autonomous execution', () => {
    const scorecard = calculateAutonomyScorecard(
      Array.from({ length: 20 }, () => mission({ executedAutonomously: false })),
    )

    expect(scorecard.confidence).toBe('established')
    expect(scorecard.dimensions.autonomousExecution).toBe(0)
    expect(scorecard.score).toBeLessThan(95)
  })

  it('penalizes observed failures that were not autonomously recovered', () => {
    const scorecard = calculateAutonomyScorecard(
      Array.from({ length: 20 }, () => mission({ failureOccurred: true, recoveredAfterFailure: false })),
    )

    expect(scorecard.confidence).toBe('established')
    expect(scorecard.dimensions.recovery).toBe(0)
    expect(scorecard.score).toBe(85)
    expect(meetsAutonomyTarget(scorecard, 95)).toBe(false)
  })

  it('does not penalize healthy missions for recovery they never needed', () => {
    const scorecard = calculateAutonomyScorecard(
      Array.from({ length: 20 }, () => mission()),
    )

    expect(scorecard.dimensions.recovery).toBe(100)
    expect(scorecard.score).toBe(100)
    expect(meetsAutonomyTarget(scorecard, 95)).toBe(true)
  })

  it('requires recovery evidence when a failure actually occurred', () => {
    const scorecard = calculateAutonomyScorecard(
      Array.from({ length: 20 }, () => mission({ failureOccurred: true, recoveredAfterFailure: true })),
    )

    expect(scorecard.confidence).toBe('established')
    expect(scorecard.dimensions.recovery).toBe(100)
    expect(meetsAutonomyTarget(scorecard, 95)).toBe(true)
  })

  it('treats non-finite outcome quality as invalid evidence instead of allowing score inflation', () => {
    const scorecard = calculateAutonomyScorecard(
      Array.from({ length: 20 }, () => mission({ outcomeQuality: Number.POSITIVE_INFINITY })),
    )

    expect(scorecard.dimensions.outcomeQuality).toBe(0)
    expect(scorecard.score).toBe(90)
    expect(meetsAutonomyTarget(scorecard, 95)).toBe(false)
  })
})
