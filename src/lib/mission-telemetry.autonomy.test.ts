import { describe, expect, test } from 'bun:test'
import {
  recordMissionResumption,
  recordOutcomeQuality,
  startMissionTelemetry,
} from './mission-telemetry'

describe('mission telemetry operational evidence', () => {
  test('resumption is explicit and defaults to missing evidence', () => {
    const telemetry = startMissionTelemetry('test')
    expect(telemetry.resumedWithoutHumanRestart).toBeUndefined()

    recordMissionResumption(telemetry, true)
    expect(telemetry.resumedWithoutHumanRestart).toBe(true)
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
})
