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
    process.env.GROQ_API_KEY = 'test-groq'
    process.env.CLOUDFLARE_API_KEY = 'test-cloudflare'
    process.env.CLOUDFLARE_ACCOUNT_ID = 'account-123'

    let groqPosts = 0
    let cloudflarePosts = 0
    const calls: string[] = []

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = String(init?.method ?? 'GET')
      calls.push(`${method} ${url}`)

      if (method === 'GET' && url.includes('api.groq.com')) {
        return json({ data: [{ id: 'llama-3.3-70b-versatile' }] })
      }
      if (method === 'GET' && url.includes('/accounts/account-123/ai/models/search')) {
        return json({ result: [{ name: '@cf/google/gemma-4-26b-a4b-it' }] })
      }
      if (method === 'POST' && url.includes('api.groq.com')) {
        groqPosts += 1
        return json({ error: { message: 'upstream unavailable' } }, 503)
      }
      if (method === 'POST' && url.includes('/accounts/account-123/ai/v1/chat/completions')) {
        cloudflarePosts += 1
        return json({ choices: [{ message: { content: 'Recovered successfully through the validated Cloudflare reasoning provider.' } }] })
      }

      throw new Error(`Unexpected provider call: ${method} ${url}`)
    }) as typeof fetch

    const result = await runCeoCognitiveLifecycle({
      messages: [{ role: 'user', content: 'hi' }],
      timeoutMs: 20000,
    })

    expect(result.degraded).toBe(false)
    expect(result.provider).toBe('cloudflare')
    expect(result.model).toBe('@cf/google/gemma-4-26b-a4b-it')
    expect(result.content).toContain('Recovered successfully')
    expect(groqPosts).toBeGreaterThanOrEqual(1)
    expect(cloudflarePosts).toBeGreaterThanOrEqual(1)
    expect(calls.some((call) => call.includes('api.z.ai'))).toBe(false)
  })
})