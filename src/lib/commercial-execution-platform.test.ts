import { describe, expect, it } from 'bun:test'
import { COMMERCIAL_CATEGORIES } from './commercial-control-plane'
import { PHASE6_TOOL_IDS, createWebhookSignature, getCommercialProvider, listCommercialProviderAdapters, registerCommercialProvider, registerCommercialProviderAdapter, validatePhase6ExecutionContracts, verifyWebhookSignature } from './commercial-execution-platform'

describe('Phase 6', () => {
  it('defines nine execution capabilities', () => {
    expect(PHASE6_TOOL_IDS).toHaveLength(9)
    expect(new Set(PHASE6_TOOL_IDS).size).toBe(9)
  })

  it('extends the commercial taxonomy safely', () => {
    const values = Object.values(COMMERCIAL_CATEGORIES)
    expect(new Set(values).size).toBe(values.length)
    expect(values.length).toBe(20)
  })

  it('keeps the public execution contract internally coherent', () => {
    expect(validatePhase6ExecutionContracts()).toEqual([])
  })

  it('verifies signed webhooks', () => {
    const body = '{"id":"evt_1"}'
    const secret = 'phase6-test-secret'
    const timestamp = 1800000000
    const signature = createWebhookSignature(body, secret, timestamp)
    expect(verifyWebhookSignature(body, signature, secret, timestamp)).toBe(true)
    expect(verifyWebhookSignature(body, signature, 'wrong-secret', timestamp)).toBe(false)
    expect(verifyWebhookSignature(body, signature, secret, timestamp + 301)).toBe(false)
  })

  it('persists provider definitions', async () => {
    const id = `phase6-test-${Date.now()}`
    const provider = await registerCommercialProvider({ providerId: id, name: 'Phase6Test', version: '1.0.0', capabilities: ['read'], businesses: ['revenue-recovery'], environments: ['sandbox'], webhookEvents: [], status: 'enabled' })
    expect(provider.providerId).toBe(id)
    expect((await getCommercialProvider(id))?.version).toBe('1.0.0')
  })

  it('keeps adapters inspectable', () => {
    const id = `phase6-adapter-${Date.now()}`
    registerCommercialProviderAdapter({ providerId: id, execute: async () => ({ ok: true, observedAt: new Date().toISOString(), latencyMs: 1 }) })
    expect(listCommercialProviderAdapters()).toContain(id)
  })
})
