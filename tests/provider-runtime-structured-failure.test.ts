import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { runGovernedProviderChat } from '@/lib/provider-runtime-v2'
import { ProviderControlPlaneError, clearProviderCatalogCache } from '@/lib/provider-control-plane'
import { clearOutcomeIntelligenceForTests } from '@/lib/outcome-intelligence'
import { resetProviderHealthForTests } from '@/lib/provider-intelligence'
import { resetProviderStandingForTests } from '@/lib/provider-standing'

const ENV_KEYS = ['GROQ_API_KEY'] as const
const originalEnvironment = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as Record<(typeof ENV_KEYS)[number], string | undefined>
const originalFetch = globalThis.fetch

beforeEach(() => {
  clearProviderCatalogCache()
  clearOutcomeIntelligenceForTests()
  resetProviderHealthForTests()
  resetProviderStandingForTests()
  for (const key of ENV_KEYS) delete process.env[key]
})

afterEach(() => {
  clearProviderCatalogCache()
  clearOutcomeIntelligenceForTests()
  resetProviderHealthForTests()
  resetProviderStandingForTests()
  for (const key of ENV_KEYS) {
    const value = originalEnvironment[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  globalThis.fetch = originalFetch
})

describe('runGovernedProviderChat: the aggregate "all providers failed" throw carries a structured kind', () => {
  test('is a ProviderControlPlaneError whose kind matches the last attempted provider\'s real failure, not a plain Error', async () => {
    // "Next architecture" program, Stage 4: before this, exhausting every governed provider always
    // threw a plain Error -- the CEO layer had nothing but the message string to work with, and fell
    // back to regex-guessing at ceo-cognitive-lifecycle.ts's catch site. A billing failure (real
    // production incident shape) should now be distinguishable from a timeout or a rate limit without
    // parsing text.
    process.env.GROQ_API_KEY = 'test-groq'
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = String(init?.method ?? 'GET')
      if (method === 'GET' && url.includes('api.groq.com')) return new Response(JSON.stringify({ data: [{ id: 'llama-3.3-70b-versatile' }] }), { status: 200 })
      if (method === 'POST' && url.includes('api.groq.com')) return new Response(JSON.stringify({ error: { message: 'Request too large for the organization on this billing plan.' } }), { status: 402 })
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    let caught: unknown
    try {
      await runGovernedProviderChat({ messages: [{ role: 'user', content: 'hello' }], taskType: 'reasoning' })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ProviderControlPlaneError)
    expect((caught as InstanceType<typeof ProviderControlPlaneError>).kind).toBe('BILLING')
  })
})
