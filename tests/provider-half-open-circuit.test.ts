import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { pickHalfOpenCandidate, recordFailure, resetProviderHealthForTests } from '@/lib/provider-intelligence'
import { runGovernedProviderChat } from '@/lib/provider-runtime-v2'
import { clearProviderCatalogCache } from '@/lib/provider-control-plane'
import { clearOutcomeIntelligenceForTests } from '@/lib/outcome-intelligence'

type GlobalWithProviderHealth = typeof globalThis & { __providerHealthProcessStartedAt?: number }
const G = globalThis as GlobalWithProviderHealth
const ENV_KEYS = ['GROQ_API_KEY', 'CEREBRAS_API_KEY', 'MISTRAL_API_KEY'] as const
const originalFetch = globalThis.fetch

function openCircuit(provider: string) {
  // Past the 20s cold-start grace window, matching provider-intelligence-cold-start.test.ts's pattern.
  G.__providerHealthProcessStartedAt = Date.now() - 25_000
  recordFailure(provider)
  recordFailure(provider)
  recordFailure(provider)
}

beforeEach(() => {
  clearProviderCatalogCache()
  clearOutcomeIntelligenceForTests()
  resetProviderHealthForTests()
  process.env.GROQ_API_KEY = 'test-groq'
  process.env.CEREBRAS_API_KEY = 'test-cerebras'
  process.env.MISTRAL_API_KEY = 'test-mistral'
})

afterEach(() => {
  clearProviderCatalogCache()
  clearOutcomeIntelligenceForTests()
  resetProviderHealthForTests()
  for (const key of ENV_KEYS) delete process.env[key]
  globalThis.fetch = originalFetch
})

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

// Deep-audit finding, root-caused from a real production trace: a request landed with every configured
// provider's circuit open at once (plausible with a small 5-provider pool and a burst of real transient
// failures) and got a hard, instant, zero-attempt failure -- the live trace showed
// providerAttemptCount:0, attempts:[], 389ms. A circuit breaker with only closed/open states is an
// incomplete implementation of the pattern; the missing half-open state is what these tests lock in.
describe('pickHalfOpenCandidate', () => {
  test('returns null when given no candidates', () => {
    expect(pickHalfOpenCandidate([])).toBeNull()
  })

  test('returns the sole candidate when only one is given, regardless of its circuit state', () => {
    expect(pickHalfOpenCandidate(['groq'])).toBe('groq')
  })

  test('picks the candidate closest to its own cooldown expiry, not an arbitrary or first one', async () => {
    resetProviderHealthForTests()
    G.__providerHealthProcessStartedAt = Date.now() - 25_000
    // Open groq's circuit first (its 60s cooldown started earliest -- it will expire soonest).
    recordFailure('groq'); recordFailure('groq'); recordFailure('groq')
    // A real delay so cerebras's cooldown genuinely starts later than groq's -- recordFailure has no
    // injectable clock, so a millisecond-scale tie is otherwise possible between two synchronous bursts.
    await new Promise((resolve) => setTimeout(resolve, 10))
    recordFailure('cerebras'); recordFailure('cerebras'); recordFailure('cerebras')
    expect(pickHalfOpenCandidate(['cerebras', 'groq'])).toBe('groq')
  })
})

describe('runGovernedProviderChat half-open fallback', () => {
  test('when every configured provider is circuit-open, it spends one bounded probe instead of failing with zero attempts', async () => {
    openCircuit('groq')
    openCircuit('cerebras')
    openCircuit('mistral')
    let chatCalls = 0
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const method = String(init?.method ?? 'GET')
      if (method === 'GET') {
        if (url.includes('api.groq.com')) return jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }] })
        if (url.includes('api.cerebras.ai')) return jsonResponse({ data: [{ id: 'gpt-oss-120b' }] })
        if (url.includes('api.mistral.ai')) return jsonResponse({ data: [{ id: 'mistral-large-latest' }] })
      }
      if (method === 'POST') { chatCalls += 1; return jsonResponse({ choices: [{ message: { content: 'half-open probe succeeded' } }] }) }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    const result = await runGovernedProviderChat({ taskType: 'reasoning', messages: [{ role: 'user', content: 'test half-open fallback' }], timeoutMs: 5000 })
    expect(result.content).toBe('half-open probe succeeded')
    // Exactly one real HTTP attempt -- a bounded probe, not a retry storm across every open circuit.
    expect(chatCalls).toBe(1)
    expect(result.attempts.length).toBe(1)
  })

  test('a failed half-open probe still fails the request cleanly (no infinite fallback loop, no silent second chance)', async () => {
    openCircuit('groq')
    openCircuit('cerebras')
    openCircuit('mistral')
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const method = String(init?.method ?? 'GET')
      if (method === 'GET') {
        if (url.includes('api.groq.com')) return jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }] })
        if (url.includes('api.cerebras.ai')) return jsonResponse({ data: [{ id: 'gpt-oss-120b' }] })
        if (url.includes('api.mistral.ai')) return jsonResponse({ data: [{ id: 'mistral-large-latest' }] })
      }
      if (method === 'POST') return jsonResponse({ error: { message: 'still down' } }, 503)
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    await expect(runGovernedProviderChat({ taskType: 'reasoning', messages: [{ role: 'user', content: 'test failed half-open probe' }], timeoutMs: 5000 })).rejects.toThrow(/All governed providers failed/)
  })

  test('when at least one provider is genuinely circuit-closed, it is used directly -- the half-open path never activates while real options exist', async () => {
    openCircuit('groq')
    openCircuit('cerebras')
    // mistral's circuit is left closed.
    let mistralCalled = false
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const method = String(init?.method ?? 'GET')
      if (method === 'GET') {
        if (url.includes('api.groq.com')) return jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }] })
        if (url.includes('api.cerebras.ai')) return jsonResponse({ data: [{ id: 'gpt-oss-120b' }] })
        if (url.includes('api.mistral.ai')) return jsonResponse({ data: [{ id: 'mistral-large-latest' }] })
      }
      if (method === 'POST') { mistralCalled = url.includes('api.mistral.ai'); return jsonResponse({ choices: [{ message: { content: 'closed-circuit provider answered normally' } }] }) }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    const result = await runGovernedProviderChat({ taskType: 'reasoning', messages: [{ role: 'user', content: 'test normal closed-circuit path' }], timeoutMs: 5000 })
    expect(result.provider).toBe('mistral')
    expect(mistralCalled).toBe(true)
  })

  // Adversarial-combination finding: neither the circuit-breaker fix (#113) nor the taskType-governance
  // fix (#115) alone covers this -- it only shows up when BOTH conditions hold at once. groq and cerebras
  // have no governed model for 'creative'; mistral does. If every circuit is open AND the soonest-to-
  // recover provider (groq, opened first) happens to be the ungoverned one, picking the half-open
  // candidate by recovery proximity alone (ignoring governance) would spend the one bounded probe on
  // groq, filter it out afterward for lacking 'creative', and throw -- even though mistral, a genuinely
  // viable half-open candidate, was sitting right there the whole time, just slower to recover. Filtering
  // governance BEFORE half-open selection (not after) is what makes this combination resolve correctly.
  test('half-open selection under mixed circuit-open + governance-incapable providers picks the governed candidate, not merely the soonest to recover', async () => {
    // groq's circuit opens first (soonest to recover) but groq has no governed model for 'creative'.
    openCircuit('groq')
    await new Promise((resolve) => setTimeout(resolve, 10))
    // cerebras also lacks 'creative' and opens second.
    openCircuit('cerebras')
    await new Promise((resolve) => setTimeout(resolve, 10))
    // mistral opens last (slowest to recover) but is the only one of the three governed for 'creative'.
    openCircuit('mistral')

    let mistralProbed = false
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const method = String(init?.method ?? 'GET')
      if (method === 'GET') {
        if (url.includes('api.groq.com')) return jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }] })
        if (url.includes('api.cerebras.ai')) return jsonResponse({ data: [{ id: 'gpt-oss-120b' }] })
        if (url.includes('api.mistral.ai')) return jsonResponse({ data: [{ id: 'mistral-large-latest' }] })
      }
      if (method === 'POST') {
        if (url.includes('api.groq.com') || url.includes('api.cerebras.ai')) throw new Error(`ungoverned provider was attempted: ${url}`)
        mistralProbed = true
        return jsonResponse({ choices: [{ message: { content: 'mistral half-open probe succeeded despite recovering last' } }] })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    const result = await runGovernedProviderChat({ taskType: 'creative', messages: [{ role: 'user', content: 'Weigh affiliate content vs. a SaaS product and recommend one.' }], timeoutMs: 5000 })
    expect(result.provider).toBe('mistral')
    expect(mistralProbed).toBe(true)
  })
})
