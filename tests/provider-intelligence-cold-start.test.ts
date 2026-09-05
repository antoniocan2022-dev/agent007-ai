import { describe, expect, test, beforeEach } from 'bun:test'
import { recordFailure, isCircuitOpen } from '@/lib/provider-intelligence'

type GlobalWithProviderHealth = typeof globalThis & { __providerHealth?: Record<string, unknown>; __providerHealthProcessStartedAt?: number }
const G = globalThis as GlobalWithProviderHealth

describe('Cold-start-aware provider circuit breaker', () => {
  beforeEach(() => {
    // The module captured its own reference to this object at import time, so tests must clear its
    // keys in place rather than reassigning G.__providerHealth to a new object (which the module would
    // never see).
    const store = G.__providerHealth
    if (store) for (const key of Object.keys(store)) delete store[key]
  })

  test('a failure burst within the cold-start grace window does not trip the circuit breaker', () => {
    G.__providerHealthProcessStartedAt = Date.now()
    recordFailure('groq')
    recordFailure('groq')
    recordFailure('groq')
    expect(isCircuitOpen('groq')).toBe(false)
  })

  test('the same failure burst trips the circuit breaker once the grace window has elapsed', () => {
    G.__providerHealthProcessStartedAt = Date.now() - 25_000
    recordFailure('cloudflare')
    recordFailure('cloudflare')
    recordFailure('cloudflare')
    expect(isCircuitOpen('cloudflare')).toBe(true)
  })

  test('fewer than three failures never trips the circuit breaker, grace window or not', () => {
    G.__providerHealthProcessStartedAt = Date.now() - 25_000
    recordFailure('mistral')
    recordFailure('mistral')
    expect(isCircuitOpen('mistral')).toBe(false)
  })

  test('an unrecognized provider id is inert -- never reports as circuit-open', () => {
    G.__providerHealthProcessStartedAt = Date.now() - 25_000
    recordFailure('not-a-real-provider')
    recordFailure('not-a-real-provider')
    recordFailure('not-a-real-provider')
    expect(isCircuitOpen('not-a-real-provider')).toBe(false)
  })
})
