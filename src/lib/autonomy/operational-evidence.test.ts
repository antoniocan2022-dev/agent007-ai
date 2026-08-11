import { describe, expect, test } from 'bun:test'
import { buildOperationalMissionEvidence } from './operational-evidence'

const baseTelemetry = {
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
    governancePassed: true,
  },
}

const baseAudit = {
  auditId: 'audit-test',
  missionId: 'mission-test',
  goal: 'test',
  timestamp: new Date().toISOString(),
  pipelineCompleted: true,
  stagesCompleted: ['UNDERSTAND', 'PLAN', 'CONTEXT', 'DISPATCH', 'EXECUTE', 'VERIFY', 'DECIDE', 'LEARN'],
  stagesFailed: [],
  leadersUsed: ['echo'],
  debateTriggered: false,
  memoryUpdated: true,
  verificationPassed: true,
  verificationScore: 95,
  confidence: 95,
  warnings: [],
  errors: [],
  retries: 0,
  durationMs: 1,
  tokensUsed: 0,
  cost: 0,
  toolsCalled: [],
  lessonsLearned: 'test',
  executiveCorrections: 0,
  overallVerdict: 'SUCCESS' as const,
  qualityScore: 95,
}

describe('Operational evidence adapter', () => {
  test('requires explicit autonomous resumption evidence', () => {
    expect(buildOperationalMissionEvidence(baseTelemetry, baseAudit)).toBeNull()
  })

  test('does not infer continuity from retries or completion', () => {
    const telemetry = {
      ...baseTelemetry,
      retries: 1,
      resumedWithoutHumanRestart: undefined,
    }
    expect(buildOperationalMissionEvidence(telemetry, baseAudit)).toBeNull()
  })

  test('maps explicit runtime evidence into the operational scorecard contract', () => {
    const telemetry = {
      ...baseTelemetry,
      resumedWithoutHumanRestart: true,
    }
    expect(buildOperationalMissionEvidence(telemetry, baseAudit)).toEqual({
      completed: true,
      independentlyVerified: true,
      recoveredAfterFailure: true,
      resumedWithoutHumanRestart: true,
      executedAutonomously: true,
      outcomeQuality: 95,
    })
  })

  test('invalid audit quality cannot become scorecard evidence', () => {
    const telemetry = { ...baseTelemetry, resumedWithoutHumanRestart: true }
    const audit = { ...baseAudit, qualityScore: Number.NaN }
    expect(buildOperationalMissionEvidence(telemetry, audit)).toBeNull()
  })
})
