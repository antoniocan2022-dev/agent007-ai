import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { runGovernedProviderChat } from '@/lib/provider-runtime-v2'
import { clearProviderCatalogCache } from '@/lib/provider-control-plane'
import { clearOutcomeIntelligenceForTests } from '@/lib/outcome-intelligence'
import { resetProviderHealthForTests } from '@/lib/provider-intelligence'

const ENV_KEYS = ['GROQ_API_KEY', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'MISTRAL_API_KEY'] as const
const originalFetch = globalThis.fetch

beforeEach(() => {
  clearProviderCatalogCache()
  clearOutcomeIntelligenceForTests()
  resetProviderHealthForTests()
  process.env.GROQ_API_KEY = 'test-groq'
  process.env.CLOUDFLARE_API_KEY = 'test-cloudflare'
  process.env.CLOUDFLARE_ACCOUNT_ID = 'account-123'
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

// Deep-audit finding, root-caused directly against a real production trace: "Weigh the tradeoffs between
// doubling down on affiliate content vs. building a SaaS product" infers taskType 'creative' (matches the
// word "content"). TASK_CAPABILITIES.creative requires ['creative', 'reasoning'], but groq, cloudflare,
// and cerebras have ZERO governed model profiles with 'creative' -- only mistral and openrouter do. The
// live trace showed exactly this: "All governed providers failed (groq → cloudflare). Failure classes:
// groq:MODEL_NOT_GOVERNED | cloudflare:MODEL_NOT_GOVERNED" -- the request's low attempt budget (2) was
// entirely consumed by two providers that could never have worked for this taskType, so it threw before
// ever reaching mistral, which was healthy, configured, and fully capable. This is the same structural
// class of bug as the circuit-breaker candidate-filtering fix: a permanently disqualifying factor
// (no governed model for this taskType, same as a permanently-open circuit) wasn't filtered out before
// the attempt budget was spent.
describe('governed candidate selection filters by taskType capability before spending the attempt budget', () => {
  test('a low attempt budget still reaches a governed provider instead of exhausting itself on ungoverned ones first in provider order', async () => {
    const calls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const method = String(init?.method ?? 'GET')
      calls.push(`${method} ${url}`)
      if (method === 'GET') {
        if (url.includes('api.groq.com')) return jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }] })
        if (url.includes('/accounts/account-123/ai/models/search')) return jsonResponse({ result: [{ name: '@cf/google/gemma-4-26b-a4b-it' }] })
        if (url.includes('api.mistral.ai')) return jsonResponse({ data: [{ id: 'mistral-large-latest' }] })
      }
      if (method === 'POST') {
        // groq and cloudflare are ungoverned for 'creative' and must never even be attempted here --
        // if this test reaches them, the filter didn't work and this assertion catches it directly.
        if (url.includes('api.groq.com') || url.includes('api.cloudflare.com')) throw new Error(`ungoverned provider was attempted: ${url}`)
        if (url.includes('api.mistral.ai')) return jsonResponse({ choices: [{ message: { content: 'mistral handled the creative tradeoff analysis' } }] })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    const result = await runGovernedProviderChat({
      taskType: 'creative',
      messages: [{ role: 'user', content: 'Weigh the tradeoffs between doubling down on affiliate content vs. building a SaaS product, and give me a recommendation.' }],
      timeoutMs: 10000,
      maxProviderAttempts: 2,
      providerOrder: ['groq', 'cloudflare', 'mistral'],
    })

    expect(result.provider).toBe('mistral')
    expect(result.content).toBe('mistral handled the creative tradeoff analysis')
    expect(result.attempts).toEqual(['mistral'])
  })

  test('when truly no configured provider is governed for the taskType, it still fails honestly rather than hanging or silently succeeding', async () => {
    delete process.env.MISTRAL_API_KEY
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const method = String(init?.method ?? 'GET')
      if (method === 'GET') {
        if (url.includes('api.groq.com')) return jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }] })
        if (url.includes('/accounts/account-123/ai/models/search')) return jsonResponse({ result: [{ name: '@cf/google/gemma-4-26b-a4b-it' }] })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    await expect(runGovernedProviderChat({
      taskType: 'creative',
      messages: [{ role: 'user', content: 'Write ad copy for our launch.' }],
      timeoutMs: 5000,
      providerOrder: ['groq', 'cloudflare'],
    })).rejects.toThrow(/No governed providers configured and healthy/)
  })
})
