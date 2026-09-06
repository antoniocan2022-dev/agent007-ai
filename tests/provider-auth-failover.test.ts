import { afterEach, describe, expect, test } from 'bun:test'
import { runGovernedProviderChat } from '@/lib/provider-runtime-v2'

afterEach(() => { delete process.env.GROQ_API_KEY; delete process.env.CEREBRAS_API_KEY })

describe('Governed provider resilience', () => {
  test('skips a provider whose live catalog rejects authentication and reaches the next healthy provider', async () => {
    const originalFetch = globalThis.fetch
    process.env.GROQ_API_KEY = 'invalid-test-key'; process.env.CEREBRAS_API_KEY = 'valid-test-key'
    const calls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input); calls.push(url)
      if (url.includes('api.groq.com')) return new Response('{"error":"invalid_api_key"}', { status: 401 })
      if (url === 'https://api.cerebras.ai/v1/models') return new Response(JSON.stringify({ data: [{ id: 'gpt-oss-120b' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      return new Response(JSON.stringify({ choices: [{ message: { content: 'fallback works' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch
    try {
      const result = await runGovernedProviderChat({ taskType: 'reasoning', messages: [{ role: 'user', content: 'test active-provider failover' }], timeoutMs: 5000, providerOrder: ['groq', 'cerebras'] })
      expect(result.provider).toBe('cerebras'); expect(result.content).toBe('fallback works'); expect(result.attempts).toEqual(['groq', 'cerebras'])
      expect(calls).toEqual(['https://api.groq.com/openai/v1/models','https://api.cerebras.ai/v1/models','https://api.cerebras.ai/v1/chat/completions'])
    } finally { globalThis.fetch = originalFetch }
  })
  test('rate-limit classification is retryable without entering conversational state', async () => {
    const { classifyProviderError } = await import('@/lib/provider-control-plane')
    const classified = classifyProviderError('groq', 429, 'rate limit exceeded')
    expect(classified.kind).toBe('RATE_LIMIT'); expect(classified.retryable).toBe(true)
  })
})
