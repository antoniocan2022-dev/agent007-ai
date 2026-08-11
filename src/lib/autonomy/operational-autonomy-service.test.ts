import { describe, expect, test } from 'bun:test'
import { buildOperationalAutonomySnapshot } from './operational-autonomy-service'

const telemetry = {
  missionId: 'mission-1',
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
  auditId: 'audit-1',
  missionId: 'mission-1',
  pipelineCompleted: true,
} as any

describe('operational autonomy service', () => {
  test('scores only missions with complete explicit evidence', () => {
    const snapshot = buildOperationalAutonomySnapshot([telemetry], [audit])

    expect(snapshot.telemetrySampleSize).toBe(1)
    expect(snapshot.scoreableMissionCount).toBe(1)
    expect(snapshot.evidenceCoverage).toBe(100)
    expect(snapshot.scorecard.confidence).toBe('insufficient')
    expect(snapshot.scorecard.score).toBe(95)
  })

  test('does not count missions with missing continuity evidence', () => {
    const incomplete = { ...telemetry, resumedWithoutHumanRestart: undefined }
    const snapshot = buildOperationalAutonomySnapshot([incomplete], [audit])

    expect(snapshot.telemetrySampleSize).toBe(1)
    expect(snapshot.scoreableMissionCount).toBe(0)
    expect(snapshot.evidenceCoverage).toBe(0)
    expect(snapshot.scorecard.confidence).toBe('insufficient')
  })
})
