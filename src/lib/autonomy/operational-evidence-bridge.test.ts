import { describe, expect, test } from 'bun:test'
import { buildOperationalMissionEvidence } from './operational-evidence-bridge'

describe('operational evidence bridge', () => {
  const outcome = {
    completed: true,
    independentlyVerified: true,
    recoveredAfterFailure: true,
    resumedWithoutHumanRestart: true,
    outcomeQuality: 100,
  }

  test('converts eligible runtime evidence without inventing autonomy', () => {
    const evidence = buildOperationalMissionEvidence(
      {
        eligible: true,
        executionAutonomous: true,
      },
      outcome,
    )

    expect(evidence).toEqual({
      ...outcome,
      executedAutonomously: true,
    })
  })

  test('rejects ineligible missions', () => {
    expect(buildOperationalMissionEvidence(
      { eligible: false, executionAutonomous: true },
      outcome,
    )).toBeNull()
  })

  test('rejects missing execution-autonomy evidence', () => {
    expect(buildOperationalMissionEvidence(
      { eligible: true },
      outcome,
    )).toBeNull()
  })

  test('does not infer execution autonomy from other runtime evidence', () => {
    expect(buildOperationalMissionEvidence(
      {
        eligible: true,
        goalAutonomous: true,
        decisionAutonomous: true,
        verificationIndependent: true,
        governancePassed: true,
      },
      outcome,
    )).toBeNull()
  })
})
