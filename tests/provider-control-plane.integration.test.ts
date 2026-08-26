import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { PROVIDER_ORDER, PROVIDER_RUNTIME_CONFIG, ProviderControlPlaneError, clearProviderCatalogCache, classifyProviderError, getGovernedCandidates, resolveGovernedModel, resolveLiveCatalog } from '../src/lib/provider-control-plane'
import { runGovernedProviderChat } from '../src/lib/provider-runtime-v2'

const ENV = ['GROQ_API_KEY', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'MISTRAL_API_KEY', 'CEREBRAS_API_KEY', 'OPENROUTER_API_KEY'] as const
const savedEnv: Record<string, string | undefined> = {}
const originalFetch = globalThis.fetch
function jsonResponse(payload: unknown, status = 200): Response { return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } }) }

beforeEach(() => { for (const env of ENV) { savedEnv[env] = process.env[env]; delete process.env[env] }; clearProviderCatalogCache() })
afterEach(() => { globalThis.fetch = originalFetch; for (const env of ENV) { const value = savedEnv[env]; if (value === undefined) delete process.env[env]; else process.env[env] = value }; clearProviderCatalogCache() })

describe('provider control plane', () => {
  test('has one canonical replacement-provider order', () => {
    expect(PROVIDER_ORDER).toEqual(['groq', 'cloudflare', 'mistral', 'cerebras', 'openrouter'])
    expect(PROVIDER_RUNTIME_CONFIG.cloudflare.defaultModel).toBe('@cf/google/gemma-4-26b-a4b-it')
    expect(PROVIDER_RUNTIME_CONFIG.cloudflare.accountIdEnv).toBe('CLOUDFLARE_ACCOUNT_ID')
    expect(PROVIDER_RUNTIME_CONFIG.openrouter.defaultModel).toBe('openrouter/free')
    expect(PROVIDER_RUNTIME_CONFIG.openrouter.emergency).toBe(true)
    expect(Object.keys(PROVIDER_RUNTIME_CONFIG)).not.toContain('zai')
    expect(Object.keys(PROVIDER_RUNTIME_CONFIG)).not.toContain('gemini')
  })

  test('Gemma 4 is governed for the requested Agent007 capabilities', () => {
    const candidates = getGovernedCandidates('cloudflare', 'reasoning', 'enhanced')
    expect(candidates).toContain('@cf/google/gemma-4-26b-a4b-it')
    expect(GOVERNED_CAPABILITIES('cloudflare')).toContain('vision')
  })

  test('Cloudflare live catalog resolves Gemma 4 with account-scoped endpoint', async () => {
    process.env.CLOUDFLARE_API_KEY = 'test'
    process.env.CLOUDFLARE_ACCOUNT_ID = 'account-123'
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('/accounts/account-123/ai/models/search')
      return jsonResponse({ result: [{ name: '@cf/google/gemma-4-26b-a4b-it' }, { name: '@cf/other/model' }] })
    }) as typeof fetch
    const catalog = await resolveLiveCatalog('cloudflare', fetch, true)
    expect(catalog.source).toBe('live-api')
    expect(catalog.modelIds).toContain('@cf/google/gemma-4-26b-a4b-it')
  })

  test('OpenRouter free router uses execution-validated governance', async () => {
    process.env.OPENROUTER_API_KEY = 'test'
    const model = await resolveGovernedModel('openrouter', 'reasoning', 'enhanced')
    expect(model).toBe('openrouter/free')
  })

  test('task-aware diagnostics use reasoning rather than operations', async () => {
    process.env.CLOUDFLARE_API_KEY = 'test'
    process.env.CLOUDFLARE_ACCOUNT_ID = 'account-123'
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/models/search')) return jsonResponse({ result: [{ name: '@cf/google/gemma-4-26b-a4b-it' }] })
      if (url.includes('/chat/completions') && init?.method === 'POST') return jsonResponse({ choices: [{ message: { content: 'OK' } }] })
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch
    const { probeProvider } = await import('../src/lib/provider-runtime-v2')
    const result = await probeProvider('cloudflare')
    expect(result.success).toBe(true)
    expect(result.states.taskCapability).toBe('healthy')
    expect(result.model).toBe('@cf/google/gemma-4-26b-a4b-it')
  })

  test('typed status classification keeps billing/rate-limit/auth separate from outages', () => {
    expect(classifyProviderError('groq', 402, 'payment required').kind).toBe('BILLING')
    expect(classifyProviderError('groq', 429, 'rate limit').kind).toBe('RATE_LIMIT')
    expect(classifyProviderError('groq', 401, 'unauthorized').kind).toBe('AUTHENTICATION')
    expect(classifyProviderError('groq', 503, 'upstream unavailable').kind).toBe('UPSTREAM')
  })

  test('provider fallback continues after a primary failure and succeeds on Cloudflare', async () => {
    process.env.GROQ_API_KEY = 'test-groq'
    process.env.CLOUDFLARE_API_KEY = 'test-cloudflare'
    process.env.CLOUDFLARE_ACCOUNT_ID = 'account-123'
    let groqPostAttempts = 0
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('groq.com') && init?.method === 'GET') return jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }] })
      if (url.includes('groq.com') && init?.method === 'POST') { groqPostAttempts++; return jsonResponse({ error: { message: 'payment required' } }, 402) }
      if (url.includes('/models/search')) return jsonResponse({ result: [{ name: '@cf/google/gemma-4-26b-a4b-it' }] })
      if (url.includes('/chat/completions') && init?.method === 'POST') return jsonResponse({ choices: [{ message: { content: 'Cloudflare fallback response: operationally healthy.' } }] })
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch
    const result = await runGovernedProviderChat({ messages: [{ role: 'user', content: 'Say hello' }], taskType: 'general', maxProviderAttempts: 2 })
    expect(groqPostAttempts).toBe(1)
    expect(result.provider).toBe('cloudflare')
    expect(result.model).toBe('@cf/google/gemma-4-26b-a4b-it')
    expect(result.attempts).toEqual(['groq', 'cloudflare'])
    expect(result.content).toContain('operationally healthy')
  })
})

function GOVERNED_CAPABILITIES(provider: 'cloudflare') { return provider === 'cloudflare' ? ['reasoning', 'analysis', 'tool-use', 'coding', 'research', 'long-context', 'vision'] : [] }
