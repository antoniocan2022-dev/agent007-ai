import { describe, expect, test } from 'bun:test'
import {
  classifyMissionStageFailure,
  computeNextAutoRetryAt,
  recordMissionStageFailureOnHeartbeat,
  isMissionDueForAutoRetry,
  MAX_MISSION_AUTO_RETRIES,
} from '@/lib/mission-pipeline-recovery'
import { ProviderControlPlaneError } from '@/lib/provider-control-plane'
import type { MissionHeartbeat } from '@/lib/mission-heartbeat'

function baseHeartbeat(overrides: Partial<MissionHeartbeat> = {}): MissionHeartbeat {
  return {
    missionId: 'mission_test',
    missionTitle: 'Test Mission',
    pipelineType: 'generic',
    objective: 'test objective',
    requiresOwnerApproval: false,
    status: 'failed',
    currentStage: null,
    completedStages: [],
    estimatedRemainingMs: null,
    estimatedCompletionAt: null,
    lastActivityAt: null,
    lastError: null,
    ceoWatchdog: { verdict: 'critical', message: 'failed', checkedAt: new Date().toISOString() },
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('classifyMissionStageFailure', () => {
  test('a retryable ProviderControlPlaneError (TIMEOUT) classifies as retryable', () => {
    const error = new ProviderControlPlaneError({ provider: 'groq', kind: 'TIMEOUT', message: 'timed out', retryable: true })
    expect(classifyMissionStageFailure(error)).toEqual({ retryable: true, reason: 'provider:TIMEOUT' })
  })

  test('a non-retryable ProviderControlPlaneError (BILLING) classifies as fatal', () => {
    // BILLING failures need owner intervention (add funds, fix plan) -- retrying automatically
    // would just burn the same doomed request again.
    const error = new ProviderControlPlaneError({ provider: 'groq', kind: 'BILLING', message: 'billing limit', retryable: false })
    expect(classifyMissionStageFailure(error).retryable).toBe(false)
  })

  test('a plain Error whose message names a timeout/network condition classifies as retryable', () => {
    expect(classifyMissionStageFailure(new Error('fetch failed: ETIMEDOUT')).retryable).toBe(true)
    expect(classifyMissionStageFailure(new Error('request timed out after 30s')).retryable).toBe(true)
  })

  test('a generic/unknown Error classifies as fatal, never auto-retried', () => {
    expect(classifyMissionStageFailure(new Error('Cannot read properties of undefined')).retryable).toBe(false)
  })

  test('a non-Error thrown value classifies as fatal', () => {
    expect(classifyMissionStageFailure('a string was thrown').retryable).toBe(false)
    expect(classifyMissionStageFailure(undefined).retryable).toBe(false)
  })
})

describe('computeNextAutoRetryAt', () => {
  test('backs off exponentially and caps at 30 minutes', () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    const first = Date.parse(computeNextAutoRetryAt(1, now)) - now.getTime()
    const second = Date.parse(computeNextAutoRetryAt(2, now)) - now.getTime()
    const third = Date.parse(computeNextAutoRetryAt(3, now)) - now.getTime()
    const farOut = Date.parse(computeNextAutoRetryAt(20, now)) - now.getTime()
    expect(first).toBe(2 * 60_000)
    expect(second).toBe(4 * 60_000)
    expect(third).toBe(8 * 60_000)
    expect(farOut).toBe(30 * 60_000)
  })
})

describe('recordMissionStageFailureOnHeartbeat', () => {
  test('a retryable failure increments autoRetryCount from the prior count and sets a future nextAutoRetryAt', () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    const hb = baseHeartbeat()
    const error = new ProviderControlPlaneError({ provider: 'groq', kind: 'NETWORK', message: 'network error', retryable: true })
    recordMissionStageFailureOnHeartbeat(hb, 2, error, now)
    expect(hb.autoRetryCount).toBe(3)
    expect(hb.lastFailureRetryable).toBe(true)
    expect(hb.nextAutoRetryAt).not.toBeNull()
    expect(Date.parse(hb.nextAutoRetryAt!)).toBeGreaterThan(now.getTime())
  })

  test('a fatal failure does not increment autoRetryCount and clears nextAutoRetryAt', () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    const hb = baseHeartbeat()
    recordMissionStageFailureOnHeartbeat(hb, 2, new Error('a real bug'), now)
    expect(hb.autoRetryCount).toBe(2)
    expect(hb.lastFailureRetryable).toBe(false)
    expect(hb.nextAutoRetryAt).toBeNull()
  })

  test('exceeding MAX_MISSION_AUTO_RETRIES makes an otherwise-retryable failure durably fatal', () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    const hb = baseHeartbeat()
    const error = new ProviderControlPlaneError({ provider: 'groq', kind: 'TIMEOUT', message: 'timed out', retryable: true })
    recordMissionStageFailureOnHeartbeat(hb, MAX_MISSION_AUTO_RETRIES, error, now)
    expect(hb.autoRetryCount).toBe(MAX_MISSION_AUTO_RETRIES + 1)
    expect(hb.lastFailureRetryable).toBe(false)
    expect(hb.nextAutoRetryAt).toBeNull()
  })

  test('appends the classification reason onto an existing lastError instead of overwriting it', () => {
    const hb = baseHeartbeat({ lastError: 'Stage 3 (forge) crashed: connection reset' })
    recordMissionStageFailureOnHeartbeat(hb, 0, new Error('network error'), new Date())
    expect(hb.lastError).toContain('connection reset')
    expect(hb.lastError).toContain('network-or-timeout')
  })
})

describe('isMissionDueForAutoRetry', () => {
  test('is false for a mission that is not in failed status', () => {
    const hb = baseHeartbeat({ status: 'working', lastFailureRetryable: true, autoRetryCount: 1, nextAutoRetryAt: new Date(Date.now() - 1000).toISOString() })
    expect(isMissionDueForAutoRetry(hb, new Date())).toBe(false)
  })

  test('is false when the last failure was classified fatal', () => {
    const hb = baseHeartbeat({ status: 'failed', lastFailureRetryable: false, nextAutoRetryAt: new Date(Date.now() - 1000).toISOString() })
    expect(isMissionDueForAutoRetry(hb, new Date())).toBe(false)
  })

  test('is false before the backoff window has elapsed', () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    const hb = baseHeartbeat({ status: 'failed', lastFailureRetryable: true, autoRetryCount: 1, nextAutoRetryAt: new Date(now.getTime() + 60_000).toISOString() })
    expect(isMissionDueForAutoRetry(hb, now)).toBe(false)
  })

  test('is true once the backoff window has elapsed for a retryable, in-budget failure', () => {
    const now = new Date('2026-01-01T00:10:00.000Z')
    const hb = baseHeartbeat({ status: 'failed', lastFailureRetryable: true, autoRetryCount: 1, nextAutoRetryAt: new Date('2026-01-01T00:00:00.000Z').toISOString() })
    expect(isMissionDueForAutoRetry(hb, now)).toBe(true)
  })

  test('is false once autoRetryCount has exceeded the max, even if lastFailureRetryable is stale-true', () => {
    const now = new Date('2026-01-01T00:10:00.000Z')
    const hb = baseHeartbeat({ status: 'failed', lastFailureRetryable: true, autoRetryCount: MAX_MISSION_AUTO_RETRIES + 1, nextAutoRetryAt: new Date('2026-01-01T00:00:00.000Z').toISOString() })
    expect(isMissionDueForAutoRetry(hb, now)).toBe(false)
  })
})
