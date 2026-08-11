import { describe, expect, test } from 'bun:test'
import {
  completeMissionTelemetry,
  recordFailureState,
  recordMissionResumption,
  recordOutcomeQuality,
  startMissionTelemetry,
} from './mission-telemetry'
import { db } from './db'

describe('mission telemetry operational evidence', () => {
  test('resumption is explicit and defaults to missing evidence', () => {
    const telemetry = startMissionTelemetry('test')
    expect(telemetry.resumedWithoutHumanRestart).toBeUndefined()

    recordMissionResumption(telemetry, true)
    expect(telemetry.resumedWithoutHumanRestart).toBe(true)
  })

  test('failure state is explicit and defaults to missing evidence', () => {
    const telemetry = startMissionTelemetry('test')
    expect(telemetry.failureOccurred).toBeUndefined()

    recordFailureState(telemetry, false)
    expect(telemetry.failureOccurred).toBe(false)

    recordFailureState(telemetry, true)
    expect(telemetry.failureOccurred).toBe(true)
  })

  test('outcome quality accepts only finite values in range', () => {
    const telemetry = startMissionTelemetry('test')

    expect(recordOutcomeQuality(telemetry, 97)).toBe(true)
    expect(telemetry.outcomeQuality).toBe(97)

    expect(recordOutcomeQuality(telemetry, Number.NaN)).toBe(false)
    expect(recordOutcomeQuality(telemetry, Number.POSITIVE_INFINITY)).toBe(false)
    expect(recordOutcomeQuality(telemetry, -1)).toBe(false)
    expect(recordOutcomeQuality(telemetry, 101)).toBe(false)
    expect(telemetry.outcomeQuality).toBe(97)
  })

  test('completed telemetry is persisted and can be read back', async () => {
    const telemetry = startMissionTelemetry('persistence integration test')
    recordFailureState(telemetry, false)
    recordMissionResumption(telemetry, true)
    recordOutcomeQuality(telemetry, 96)

    try {
      const completed = await completeMissionTelemetry(telemetry)
      const persisted = await db.memory.findUnique({ where: { key: completed.missionId } })

      expect(persisted).not.toBeNull()
      expect(persisted?.category).toBe('mission_telemetry')
      expect(JSON.parse(persisted!.value)).toMatchObject({
        missionId: completed.missionId,
        status: 'completed',
        failureOccurred: false,
        resumedWithoutHumanRestart: true,
        outcomeQuality: 96,
      })
    } finally {
      await db.memory.delete({ where: { key: telemetry.missionId } }).catch(() => undefined)
    }
  })
})
