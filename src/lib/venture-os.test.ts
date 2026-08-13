import { describe, expect, test } from 'bun:test'
import {
  VENTURE_OS_ID,
  VENTURE_OS_VERSION,
  validateVentureOSContracts,
} from './venture-os'
import {
  VENTURE_SCORE_CATEGORIES,
  VENTURE_SCORE_THRESHOLD,
  VID_WORKFLOW_STAGES,
} from './vid-data'
import { CEO_VENTURE_MANDATE, validateVentureMandate } from './venture-mandate'
import { isScorecardContractValid, VENTURE_SCORECARD_VERSION } from './venture-scorecard'

describe('Venture OS contracts', () => {
  test('uses one canonical identity and current contract versions', () => {
    expect(VENTURE_OS_ID).toBe('venture-os')
    expect(VENTURE_OS_VERSION).toBe(3)
    expect(CEO_VENTURE_MANDATE.version).toBeGreaterThan(0)
    expect(VENTURE_SCORECARD_VERSION).toBe(2)
  })

  test('legacy VID Venture Score weights total exactly 100', () => {
    const total = VENTURE_SCORE_CATEGORIES.reduce((sum, item) => sum + item.weight, 0)
    expect(total).toBe(100)
    expect(VENTURE_SCORE_THRESHOLD).toBeGreaterThanOrEqual(0)
    expect(VENTURE_SCORE_THRESHOLD).toBeLessThanOrEqual(100)
  })

  test('CEO mandate and scorecard contracts are valid', () => {
    expect(validateVentureMandate()).toEqual([])
    expect(isScorecardContractValid()).toEqual([])
  })

  test('VID workflow is contiguous and duplicate-free', () => {
    expect(VID_WORKFLOW_STAGES.map((stage) => stage.step)).toEqual(
      VID_WORKFLOW_STAGES.map((_, index) => index + 1),
    )

    const names = VID_WORKFLOW_STAGES.map((stage) => stage.name.trim().toLowerCase())
    expect(new Set(names).size).toBe(names.length)
  })

  test('cross-system Venture OS integrity checks pass', () => {
    const errors = validateVentureOSContracts().filter((issue) => issue.severity === 'error')
    expect(errors).toEqual([])
  })
})
