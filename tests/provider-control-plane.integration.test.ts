import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  PROVIDER_ORDER,
  PROVIDER_RUNTIME_CONFIG,
  ProviderControlPlaneError,
  clearProviderCatalogCache,
  classifyProviderError,
  resolveGovernedModel,
  resolveLiveCatalog,
} from '../src/lib/provider-control-plane'
import { runGovernedProviderChat } from '../src/lib/provider-runtime-v2'

const ENV = ['GROQ_API_KEY', 'ZAI_API_KEY', 'MISTRAL_API_KEY', 'GEMINI_API_KEY', 'CEREBRAS_API_KEY'] as const
const savedEnv: Record<string, string | undefined> = {}
const originalFetch = globalThis.fetch

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  for (const env of ENV) { savedEnv[env] = process.env[env]; delete process.env[env] }
  clearProviderCatalogCache()
})

afterEach(() => {
  globalThis.fetch = originalFetch
  for (const env of ENV) {
    const value = savedEnv[env]
    if (value === undefined) delete process.env[env]
    else process.env[env] = value
  }
  clearProviderCatalogCache()
})

describe('provider control plane', () => {
  test('has one canonical five-provider order and Gemini 3.7 first', () => {
    expect(PROVIDER_ORDER).toEqual(['groq', 'zai', 'mistral', 'gemini', 'cerebras'])
    expect(PROVIDER_RUNTIME_CONFIG.gemini.defaultModel).toBe('gemini-3.7-flash')
    expect(PROVIDER_RUNTIME_CONFIG.gemini.preferredModels).toContain('gemini-3.6-flash')
    expect(PROVIDER_RUNTIME_CONFIG.gemini.preferredModels).toContain('gemini-3.5-flash')
  })

  test('live catalog selects the best governed model instead of requiring one hard-coded model', async () => {
    process.env.GEMINI_API_KEY = 'test'
    const model = await resolveGovernedModel('gemini', 'reasoning', 'enhanced', undefined, async () => jsonResponse({ data: [{ id: 'gemini-3.6-flash' }, { id: 'not-governed' }] }))
    expect(model).toBe('gemini-3.6-flash')
  })

  test('live catalog failure is not mislabeled as no governed model', async () => {
    process.env.GEMINI_API_KEY = 'test'
    await expect(resolveGovernedModel('gemini', 'reasoning', 'enhanced', undefined, async () => jsonResponse({ error: 'credits exhausted' }, 402))).rejects.toMatchObject({ kind: 'BILLING', status: 402 })
    await expect(resolveGovernedModel('gemini', 'reasoning', 'enhanced', undefined, async () => jsonResponse({ error: 'too many requests' }, 429))).rejects.toMatchObject({ kind: 'RATE_LIMIT', status: 429 })
    await expect(resolveGovernedModel('gemini', 'reasoning', 'enhanced', undefined, async () => jsonResponse({ error: 'bad key' }, 401))).rejects.toMatchObject({ kind: 'AUTHENTICATION', status: 401 })
  })

  test('model disappearance is classified as governance/catalog mismatch', async () => {
    process.env.GEMINI_API_KEY = 'test'
    try {
      await resolveGovernedModel('gemini', 'reasoning', 'enhanced', undefined, async () => jsonResponse({ data: [{ id: 'unknown-future-model' }] }))
      throw new Error('expected governed model failure')
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderControlPlaneError)
      expect((error as ProviderControlPlaneError).kind).toBe('MODEL_NOT_GOVERNED')
    }
  })

  test('force refresh observes catalog changes instead of reusing stale global discovery state', async () => {
    process.env.GEMINI_API_KEY = 'test'
    let phase = 0
    const fetchImpl: typeof fetch = async () => {
      phase++
      return phase === 1 ? jsonResponse({ data: [{ id: 'gemini-3.6-flash' }] }) : jsonResponse({ data: [{ id: 'gemini-3.7-flash' }] })
    }
    const first = await resolveLiveCatalog('gemini', fetchImpl, true)
    const second = await resolveLiveCatalog('gemini', fetchImpl, true)
    expect(first.modelIds).toEqual(['gemini-3.6-flash'])
    expect(second.modelIds).toEqual(['gemini-3.7-flash'])
  })

  test('typed status classification keeps billing/rate-limit/auth separate from outages', () => {
    expect(classifyProviderError('gemini', 402, 'payment required').kind).toBe('BILLING')
    expect(classifyProviderError('gemini', 429, 'rate limit').kind).toBe('RATE_LIMIT')
    expect(classifyProviderError('gemini', 401, 'unauthorized').kind).toBe('AUTHENTICATION')
    expect(classifyProviderError('gemini', 503, 'upstream unavailable').kind).toBe('UPSTREAM')
  })

  test('provider fallback continues after a billing failure and succeeds on Gemini', async () => {
    process.env.GROQ_API_KEY = 'test-groq'
    process.env.GEMINI_API_KEY = 'test-gemini'
    let groqPostAttempts = 0
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/groq.com/') && init?.method === 'GET') return jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }] })
      if (url.includes('/groq.com/') && init?.method === 'POST') {
        groqPostAttempts++
        return jsonResponse({ error: { message: 'payment required' } }, 402)
      }
      if (url.includes('generativelanguage.googleapis.com') && init?.method === 'GET') return jsonResponse({ data: [{ id: 'gemini-3.7-flash' }] })
      if (url.includes('generativelanguage.googleapis.com') && init?.method === 'POST') return jsonResponse({ choices: [{ message: { content: 'CEO fallback response: operationally healthy.' } }] })
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    const result = await runGovernedProviderChat({ messages: [{ role: 'user', content: 'Say hello' }], taskType: 'general', maxProviderAttempts: 2 })
    expect(groqPostAttempts).toBe(1)
    expect(result.provider).toBe('gemini')
    expect(result.model).toBe('gemini-3.7-flash')
    expect(result.attempts).toEqual(['groq', 'gemini'])
    expect(result.content).toContain('operationally healthy')
  })
})
