import { describe, expect, it } from 'bun:test'
import { COMMERCIAL_CATEGORIES } from './commercial-control-plane'
import { PHASE6_TOOL_IDS, createWebhookSignature, verifyWebhookSignature, validatePhase6ExecutionContracts, registerCommercialProvider, getCommercialProvider, registerCommercialProviderAdapter, listCommercialProviderAdapters } from './commercial-execution-platform'

describe('Phase 6 Commercial Integration & Execution Platform', () => {
  it('exposes one canonical Phase 6 tool surface', () => {
    expect(PHASE6_TOOL_IDS).toHaveLength(9)
    expect(new Set(PHASE6_TOOL_IDS).size).toBe(PHASE6_TOOL_IDS.length)
    expect(validatePhase6ExecutionContracts()).toEqual([])
  })

  it('has dedicated persistence categories without collisions', () => {
    const categories = Object.values(COMMERCIAL_CATEGORIES)
    expect(new Set(categories).size).toBe(categories.length)
    expect(categories).toEqual(expect.arrayContaining([
      'commercial_provider',
      'commercial_action',
      'commercial_webhook',
      'commercial_provider_observation',
      'commercial_sandbox',
    ]))
  })

  it('signs and verifies webhook payloads with replay-window protection', () => {
    const body = JSON.stringify({ id: 'evt_1', value: 7 })
    const secret = 'phase6-test-secret'
    const timestamp = 1_800_000_000
    const signature = createWebhookSignature(body, secret, timestamp)
    expect(verifyWebhookSignature(body, signature, secret, timestamp)).toBe(true)
    expect(verifyWebhookSignature(body, signature, 'wrong-secret', timestamp)).toBe(false)
    expect(verifyWebhookSignature(body, signature, secret, timestamp + 301)).toBe(false)
  })

  it('registers and updates provider definitions idempotently', async () => {
    const providerId = `phase6-test-${Date.now()}`
    const definition = await registerCommercialProvider({ providerId, name: 'Phase 6 Test Provider', version: '1.0.0', capabilities: ['read', 'write'], businesses: ['revenue-recovery'], environments: ['sandbox'], webhookEvents: ['test.created'], status: 'enabled' })
    expect(definition.providerId).toBe(providerId)
    const fetched = await getCommercialProvider(providerId)
    expect(fetched?.version).toBe('1.0.0')
  })

  it('keeps provider adapters explicit and inspectable', () => {
    const providerId = `phase6-adapter-${Date.now()}`
    registerCommercialProviderAdapter({ providerId, execute: async () => ({ ok: true, observedAt: new Date().toISOString(), latencyMs: 1, output: { simulated: true } }) })
    expect(listCommercialProviderAdapters()).toContain(providerId)
  })
})
