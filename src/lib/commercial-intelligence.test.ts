import { describe, expect, it } from 'bun:test'
import { COMMERCIAL_CATEGORIES } from './commercial-control-plane'
import { analyzeCommercialCausality, evaluateCommercialCausalOutcome, recordCommercialCausalObservation, validateCommercialCausalContracts } from './commercial-causal-engine'
import { recallCommercialMemory, rememberCommercial, validateCommercialMemoryContracts } from './commercial-memory'
import { getCommercialWorldSnapshot, upsertCommercialWorldEntity, upsertCommercialWorldRelation, validateCommercialWorldModelContracts } from './commercial-world-model'
import { COMMERCIAL_INTELLIGENCE_LAYERS, validateCommercialIntelligenceContracts } from './commercial-intelligence'

describe('Commercial Intelligence Triad', () => {
  it('exposes exactly the three canonical layers', () => {
    expect(COMMERCIAL_INTELLIGENCE_LAYERS).toEqual(['memory', 'world-model', 'causal-engine'])
    expect(validateCommercialIntelligenceContracts()).toEqual([])
    expect(validateCommercialMemoryContracts()).toEqual([])
    expect(validateCommercialWorldModelContracts()).toEqual([])
    expect(validateCommercialCausalContracts()).toEqual([])
  })

  it('keeps the expanded persistence taxonomy unique', () => {
    const values = Object.values(COMMERCIAL_CATEGORIES)
    expect(values).toHaveLength(20)
    expect(new Set(values).size).toBe(values.length)
  })

  it('deduplicates commercial memory and recalls the canonical entry', async () => {
    const tenantId = `triad-memory-${Date.now()}`
    const input = { tenantId, business: 'revenue-recovery' as const, scope: 'revenue-recovery', kind: 'lesson' as const, subjectType: 'recovery-strategy', subjectId: 'strategy-1', statement: 'Fast follow-up improves recovered bookings.', source: 'triad-test', evidenceIds: [], confidence: 0.7, importance: 0.8, tags: ['recovery'], occurredAt: new Date().toISOString() }
    expect((await rememberCommercial(input)).created).toBe(true)
    expect((await rememberCommercial(input)).created).toBe(false)
    const recalled = await recallCommercialMemory({ tenantId, business: 'revenue-recovery', query: 'fast follow-up recovered bookings', limit: 5 })
    expect(recalled).toHaveLength(1)
    expect(recalled[0]?.memoryId).toBeTruthy()
  })

  it('builds a relationship-aware world model without duplicate entities', async () => {
    const tenantId = `triad-world-${Date.now()}`
    const tenant = await upsertCommercialWorldEntity({ tenantId, business: 'operations-kit', type: 'tenant', sourceCategory: 'commercial_tenant', sourceId: 'tenant-1', label: 'Test tenant', attributes: {}, observedAt: new Date().toISOString() })
    const customer = await upsertCommercialWorldEntity({ tenantId, business: 'operations-kit', type: 'customer', sourceCategory: 'commercial_customer', sourceId: 'customer-1', label: 'Test customer', attributes: { status: 'customer', value: 100 }, observedAt: new Date().toISOString() })
    await upsertCommercialWorldRelation({ tenantId, business: 'operations-kit', fromEntityId: tenant.entityId, toEntityId: customer.entityId, type: 'contains', confidence: 1, source: 'triad-test' })
    await upsertCommercialWorldEntity({ tenantId, business: 'operations-kit', type: 'customer', sourceCategory: 'commercial_customer', sourceId: 'customer-1', label: 'Test customer', attributes: { status: 'customer', value: 125 }, observedAt: new Date().toISOString() })
    const snapshot = await getCommercialWorldSnapshot(tenantId, 'operations-kit')
    expect(snapshot.integrity.ok).toBe(true)
    expect(snapshot.entities.filter((entity) => entity.type === 'customer')).toHaveLength(1)
    expect(snapshot.relations).toHaveLength(1)
  })

  it('creates a causal hypothesis, then lets verified outcome evidence update it', async () => {
    const tenantId = `triad-causal-${Date.now()}`
    const cause = await recordCommercialCausalObservation({ tenantId, business: 'career-command', kind: 'intervention', metric: 'qualified_application_rate', entityType: 'campaign', entityId: 'campaign-1', value: 10, occurredAt: '2026-08-14T14:00:00.000Z', source: 'triad-test', evidenceIds: [], dimensions: {} })
    const effect = await recordCommercialCausalObservation({ tenantId, business: 'career-command', kind: 'outcome', metric: 'qualified_application_rate', entityType: 'campaign', entityId: 'campaign-1', value: 15, occurredAt: '2026-08-14T15:00:00.000Z', source: 'triad-test', evidenceIds: [], dimensions: {} })
    const analysis = await analyzeCommercialCausality({ tenantId, business: 'career-command', causeObservationId: cause.observation.observationId, effectObservationId: effect.observation.observationId, assumptions: ['No major targeting change occurred during the interval.'], confounders: [] })
    expect(analysis.hypothesis.status).toBe('candidate')
    expect(analysis.hypothesis.direction).toBe('positive')
    expect(analysis.hypothesis.effectDelta).toBe(5)
    const supported = await evaluateCommercialCausalOutcome({ tenantId, hypothesisId: analysis.hypothesis.hypothesisId, outcome: 'supported', evidenceIds: ['verified-outcome-1'] })
    expect(supported?.status).toBe('supported')
    expect(supported?.confidence).toBeGreaterThan(analysis.hypothesis.confidence)
  })
})
