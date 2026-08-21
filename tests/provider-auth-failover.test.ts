import { afterEach, describe, expect, test } from 'bun:test'
import { runGovernedProviderChat } from '@/lib/provider-runtime-v2'

describe('Governed provider authentication failover', () => {
  afterEach(() => {
    // Restore test process environment without leaking provider credentials between tests.
    delete process.env.GROQ_API_KEY
    delete process.env.OPENAI_API_KEY
    delete process.env.ZAI_API_KEY
    delete process.env.MISTRAL_API_KEY
  })

  test('skips a configured provider that returns 401 and reaches the next healthy provider', async () => {
    const originalFetch = globalThis.fetch
    process.env.GROQ_API_KEY = 'invalid-test-key'
    process.env.OPENAI_API_KEY = 'valid-test-key'
    const calls: string[] = []

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('api.groq.com')) return new Response('{"error":"invalid_api_key"}', { status: 401 })
      return new Response(JSON.stringify({ choices: [{ message: { content: 'fallback works' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch

    try {
      const result = await runGovernedProviderChat({
        taskType: 'reasoning',
        messages: [{ role: 'user', content: 'test auth failover' }],
        timeoutMs: 5000,
      })
      expect(result.provider).toBe('openai')
      expect(result.content).toBe('fallback works')
      expect(result.attempts).toEqual(['groq', 'openai'])
      expect(calls).toEqual([
        'https://api.groq.com/openai/v1/chat/completions',
        'https://api.openai.com/v1/chat/completions',
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
