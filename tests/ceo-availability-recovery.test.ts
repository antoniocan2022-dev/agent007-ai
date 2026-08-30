import { afterEach, describe, expect, test } from 'bun:test'
import { runCeoCognitiveLifecycle } from '@/lib/ceo-cognitive-lifecycle'

const originalFetch = globalThis.fetch
const PROVIDERS = ['GROQ_API_KEY', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'MISTRAL_API_KEY', 'CEREBRAS_API_KEY', 'OPENROUTER_API_KEY'] as const

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  globalThis.fetch = originalFetch
  for (const key of PROVIDERS) delete process.env[key]
})

describe('CEO availability recovery contract', () => {
  test('does not enter degraded mode when the validated availability provider can execute recovery', async () => {
    process.env.CLOUDFLARE_API_KEY = 'test-cloudflare'
    process.env.CLOUDFLARE_ACCOUNT_ID = 'account-123'
    process.env.MISTRAL_API_KEY = 'test-mistral'

    let cloudflarePosts = 0
    let mistralPosts = 0
    const calls: string[] = []

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = String(init?.method ?? 'GET')
      calls.push(`${method} ${url}`)

      if (method === 'GET' && url.includes('/accounts/account-123/ai/models/search')) {
        return json({ result: [{ name: '@cf/google/gemma-4-26b-a4b-it' }] })
      }
      if (method === 'GET' && url.includes('api.mistral.ai/v1/models')) {
        return json({ data: [{ id: 'mistral-large-latest' }] })
      }
      if (method === 'POST' && url.includes('/accounts/account-123/ai/v1/chat/completions')) {
        cloudflarePosts += 1
        return json({ error: { message: 'upstream unavailable' } }, 503)
      }
      if (method === 'POST' && url.includes('api.mistral.ai/v1/chat/completions')) {
        mistralPosts += 1
        return json({ choices: [{ message: { content: 'Recovered successfully through the validated Mistral reasoning provider.' } }] })
      }

      throw new Error(`Unexpected provider call: ${method} ${url}`)
    }) as typeof fetch

    const result = await runCeoCognitiveLifecycle({
      messages: [{ role: 'user', content: 'hi' }],
      timeoutMs: 20000,
    })

    expect(result.degraded).toBe(false)
    expect(result.provider).toBe('mistral')
    expect(result.model).toBe('mistral-large-latest')
    expect(result.content).toContain('Recovered successfully')
    expect(cloudflarePosts).toBeGreaterThanOrEqual(1)
    expect(mistralPosts).toBeGreaterThanOrEqual(1)
    expect(calls.some((call) => call.includes('api.z.ai'))).toBe(false)
  })
})