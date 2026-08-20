import { describe, expect, test } from 'bun:test'
import { evaluateCeoDecision } from '@/lib/ceo-decision-kernel'

describe('CEO Decision Kernel', () => {
  test('proceeds only when all mandatory gates pass', () => {
    const result = evaluateCeoDecision({
      missionId: 'test-mission',
      objective: 'complete verified research',
      artifactGatePassed: true,
      verificationDecision: 'PASS',
      evidenceCount: 3,
      criticalConflictCount: 0,
    })
    expect(result.decision).toBe('PROCEED')
    expect(result.confidence).toBe(100)
    expect(result.nextAction).toBe('EXECUTE')
  })

  test('holds when evidence or verification is incomplete', () => {
    const result = evaluateCeoDecision({
      missionId: 'test-mission',
      objective: 'complete verified research',
      artifactGatePassed: true,
      verificationDecision: 'CHALLENGE',
      evidenceCount: 0,
    })
    expect(result.decision).toBe('HOLD')
    expect(result.nextAction).toBe('COLLECT_EVIDENCE')
    expect(result.gates.verification).toBe('BLOCK')
  })

  test('rejects critical conflicts', () => {
    const result = evaluateCeoDecision({
      missionId: 'test-mission',
      objective: 'decide on a venture',
      artifactGatePassed: true,
      verificationDecision: 'PASS',
      evidenceCount: 4,
      criticalConflictCount: 1,
    })
    expect(result.decision).toBe('REJECT')
    expect(result.nextAction).toBe('REMEDIATE')
  })

  test('blocks protected actions until governance approval exists', () => {
    const result = evaluateCeoDecision({
      missionId: 'test-mission',
      objective: 'deploy',
      artifactGatePassed: true,
      verificationDecision: 'PASS',
      evidenceCount: 2,
      protectedActionRequested: true,
    })
    expect(result.decision).toBe('HOLD')
    expect(result.gates.governance).toBe('BLOCK')
  })
})
