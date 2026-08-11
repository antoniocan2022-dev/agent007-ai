import { describe, expect, test } from 'bun:test'
import {
  buildOperationalMissionEvidence,
  buildOperationalMissionEvidenceFromTelemetry,
} from './operational-evidence-bridge'

const outcome = {
  completed: true,
  independentlyVerified: true,
  recoveredAfterFailure: true,
  resumedWithoutHumanRestart: true,
  outcomeQuality: 100,
}

describe('operational evidence bridge', () => {
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

  test('maps persisted telemetry only when continuity and outcome quality are explicit', () => {
    const telemetry = {
      missionId: 'mission-test',
      goal: 'test',
      startedAt: 1,
      completedAt: 2,
      duration: 1,
      status: 'completed' as const,
      leadersUsed: ['echo'],
      toolsCalled: [],
      toolCallCount: 0,
      retries: 0,
      memoryReads: 0,
      memoryWrites: 1,
      confidence: 95,
      verificationScore: 95,
      verificationPassed: true,
      errors: [],
      cost: 0,
      tokensUsed: 0,
      latencyMs: 1,
      debateTriggered: false,
      executiveCorrections: 0,
      autonomyEvidence: {
        eligible: true,
        executionAutonomous: true,
        verificationIndependent: true,
        recoveryAutonomous: true,
      },
      resumedWithoutHumanRestart: true,
      outcomeQuality: 95,
    }

    const audit = {
      pipelineCompleted: true,
    } as any

    expect(buildOperationalMissionEvidenceFromTelemetry(telemetry, audit)).toEqual({
      completed: true,
      independentlyVerified: true,
      recoveredAfterFailure: true,
      resumedWithoutHumanRestart: true,
      executedAutonomously: true,
      outcomeQuality: 95,
    })
  })

  test('refuses telemetry without explicit continuity evidence', () => {
    const telemetry = {
      resumedWithoutHumanRestart: undefined,
      outcomeQuality: 95,
      autonomyEvidence: { eligible: true, executionAutonomous: true },
    } as any

    expect(buildOperationalMissionEvidenceFromTelemetry(telemetry, { pipelineCompleted: true } as any)).toBeNull()
  })
})
