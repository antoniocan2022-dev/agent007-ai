import { describe, expect, it } from 'bun:test'
import { COMMERCIAL_CAPABILITIES, validateCommercialCapabilityMap } from './commercial-capability-map'
import { COMMERCIAL_LEADERS, validateCommercialLeaders } from './commercial-organization'
import { COMMERCIAL_SPECIALISTS, validateCommercialSpecialists } from './commercial-specialists'

describe('Commercial architecture', () => {
  it('has unique capability IDs and valid scopes', () => {
    expect(validateCommercialCapabilityMap()).toEqual([])
    expect(new Set(COMMERCIAL_CAPABILITIES.map((item) => item.id)).size).toBe(COMMERCIAL_CAPABILITIES.length)
  })

  it('has unique leaders and valid reporting lines', () => {
    expect(validateCommercialLeaders()).toEqual([])
  })

  it('has no duplicate specialists and every specialist reports to a known leader', () => {
    expect(validateCommercialSpecialists(COMMERCIAL_LEADERS.map((leader) => leader.id))).toEqual([])
    expect(new Set(COMMERCIAL_SPECIALISTS.map((item) => item.id)).size).toBe(COMMERCIAL_SPECIALISTS.length)
  })
})
