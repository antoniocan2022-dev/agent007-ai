import { describe, expect, it } from 'bun:test'
import { calculateAutonomyScorecard, meetsAutonomyTarget, type OperationalMissionEvidence } from './autonomy-scorecard'

const mission = (overrides: Partial<OperationalMissionEvidence> = {}): OperationalMissionEvidence => ({
  completed: true,
  independentlyVerified: true,
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

  it('requires recovery and continuity evidence for a 95+ score', () => {
    const scorecard = calculateAutonomyScorecard(
      Array.from({ length: 20 }, () => mission({ recoveredAfterFailure: false })),
    )

    expect(scorecard.confidence).toBe('established')
    expect(meetsAutonomyTarget(scorecard, 95)).toBe(false)
  })

  it('can establish a 95+ score only with complete operational evidence', () => {
    const scorecard = calculateAutonomyScorecard(
      Array.from({ length: 20 }, () => mission({ recoveredAfterFailure: true })),
    )

    expect(scorecard.confidence).toBe('established')
    expect(scorecard.score).toBe(100)
    expect(meetsAutonomyTarget(scorecard, 95)).toBe(true)
  })

  it('treats non-finite outcome quality as invalid evidence instead of allowing score inflation', () => {
    const scorecard = calculateAutonomyScorecard(
      Array.from({ length: 20 }, () => mission({ outcomeQuality: Number.POSITIVE_INFINITY })),
    )

    expect(scorecard.dimensions.outcomeQuality).toBe(0)
    expect(scorecard.score).toBe(75)
    expect(meetsAutonomyTarget(scorecard, 95)).toBe(false)
  })
})
