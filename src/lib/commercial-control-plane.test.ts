import { describe, expect, it } from 'bun:test'
import { COMMERCIAL_BUSINESSES, COMMERCIAL_CATEGORIES, validateCommercialControlPlaneContracts } from './commercial-control-plane'

describe('Commercial Control Plane', () => {
  it('defines exactly three venture units plus the shared platform', () => {
    expect(COMMERCIAL_BUSINESSES).toEqual(['revenue-recovery', 'operations-kit', 'career-command', 'shared-platform'])
    expect(COMMERCIAL_BUSINESSES.length).toBe(4)
  })

  it('uses unique persistence categories', () => {
    const values = Object.values(COMMERCIAL_CATEGORIES)
    expect(new Set(values).size).toBe(values.length)
    expect(values.length).toBe(10)
  })

  it('has a valid control-plane contract', () => {
    expect(validateCommercialControlPlaneContracts()).toEqual([])
  })
})
