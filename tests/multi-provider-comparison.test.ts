import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { toolMultiProviderCompare } from '../src/lib/multi-provider-comparison'
import { clearProviderCatalogCache } from '../src/lib/provider-control-plane'
import { resetProviderHealthForTests } from '../src/lib/provider-intelligence'
import { resetProviderStandingForTests } from '../src/lib/provider-standing'

// Provider Gateway Phase C (2026-09-19): multi_provider_compare used to isolate a requested
// provider by mutating process.env.LLM_PROVIDER_ORDER, a mechanism callLlmWithRetry ->
// runCanonicalLlm never actually reads. Every call silently got whichever provider the
// canonical router's own ranking picked, then mislabeled that response with the REQUESTED
// provider's name -- so a "comparison" between two providers could secretly be the same
// provider's response shown twice under two different, false labels. Fixed by calling
// runCanonicalLlm directly with a request-scoped providerOrder, and labeling the result with
// the provider that ACTUALLY answered.

const ENV = ['GROQ_API_KEY', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'MISTRAL_API_KEY', 'CEREBRAS_API_KEY', 'OPENROUTER_API_KEY'] as const
const savedEnv: Record<string, string | undefined> = {}
const originalFetch = globalThis.fetch
function jsonResponse(payload: unknown, status = 200): Response { return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } }) }

beforeEach(() => { for (const env of ENV) { savedEnv[env] = process.env[env]; delete process.env[env] }; clearProviderCatalogCache(); resetProviderHealthForTests(); resetProviderStandingForTests() })
afterEach(() => { globalThis.fetch = originalFetch; for (const env of ENV) { const value = savedEnv[env]; if (value === undefined) delete process.env[env]; else process.env[env] = value }; clearProviderCatalogCache(); resetProviderHealthForTests(); resetProviderStandingForTests() })

describe('toolMultiProviderCompare: each requested provider is actually the one that answers, never a mislabeled substitute', () => {
  test('two configured providers each produce a response labeled with the provider that really answered it', async () => {
    process.env.GROQ_API_KEY = 'test-groq'
    process.env.MISTRAL_API_KEY = 'test-mistral'
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('groq.com') && init?.method === 'GET') return jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }] })
      if (url.includes('groq.com') && init?.method === 'POST') return jsonResponse({ choices: [{ message: { content: 'Groq says hello.' } }] })
      if (url.includes('mistral.ai') && init?.method === 'GET') return jsonResponse({ data: [{ id: 'mistral-large-latest' }] })
      if (url.includes('mistral.ai') && init?.method === 'POST') return jsonResponse({ choices: [{ message: { content: 'Mistral says hello.' } }] })
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch
    const result = await toolMultiProviderCompare({ prompt: 'Say hello', providers: ['groq', 'mistral'] })
    expect(result.ok).toBe(true)
    // Each provider's own distinct response content must appear under ITS OWN label, not the
    // other's -- this is exactly what the old env-mutation no-op could silently get wrong.
    expect(result.result).toContain('GROQ')
    expect(result.result).toContain('Groq says hello.')
    expect(result.result).toContain('MISTRAL')
    expect(result.result).toContain('Mistral says hello.')
    const groqSection = result.result.slice(result.result.indexOf('GROQ'), result.result.indexOf('MISTRAL'))
    expect(groqSection).toContain('Groq says hello.')
    expect(groqSection).not.toContain('Mistral says hello.')
  })

  test('consensus analysis correctly attributes the fastest provider and the longest response, even when they are different providers', async () => {
    // Fresh-audit fix: the report used to compute these two facts by re-sorting the same
    // `succeeded` array in place with two different comparators and reading `[0]` back out --
    // correct only by relying on each sort's mutation landing immediately before the read that
    // used it. Three providers with genuinely distinct speed and length, where the fastest is
    // NOT the one with the longest response, exercises that this is computed correctly rather
    // than by accident.
    process.env.GROQ_API_KEY = 'test-groq'
    process.env.MISTRAL_API_KEY = 'test-mistral'
    process.env.CEREBRAS_API_KEY = 'test-cerebras'
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('groq.com') && init?.method === 'GET') return jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }] })
      if (url.includes('groq.com') && init?.method === 'POST') { await new Promise((r) => setTimeout(r, 5)); return jsonResponse({ choices: [{ message: { content: 'short' } }] }) }
      if (url.includes('mistral.ai') && init?.method === 'GET') return jsonResponse({ data: [{ id: 'mistral-large-latest' }] })
      if (url.includes('mistral.ai') && init?.method === 'POST') { await new Promise((r) => setTimeout(r, 40)); return jsonResponse({ choices: [{ message: { content: 'x'.repeat(500) } }] }) }
      if (url.includes('cerebras.ai') && init?.method === 'GET') return jsonResponse({ data: [{ id: 'gpt-oss-120b' }] })
      if (url.includes('cerebras.ai') && init?.method === 'POST') { await new Promise((r) => setTimeout(r, 20)); return jsonResponse({ choices: [{ message: { content: 'medium length response' } }] }) }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch
    const result = await toolMultiProviderCompare({ prompt: 'Say hello', providers: ['groq', 'mistral', 'cerebras'] })
    expect(result.ok).toBe(true)
    expect(result.result).toContain('The fastest provider was: groq')
    expect(result.result).toContain('The longest response was from: mistral')
  })

  test('a requested provider that is unavailable (no credentials configured) is never silently answered by a different provider under its name', async () => {
    process.env.GROQ_API_KEY = 'test-groq'
    // mistral is deliberately left unconfigured
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('groq.com') && init?.method === 'GET') return jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }] })
      if (url.includes('groq.com') && init?.method === 'POST') return jsonResponse({ choices: [{ message: { content: 'Groq only.' } }] })
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch
    const result = await toolMultiProviderCompare({ prompt: 'Say hello', providers: ['groq', 'mistral'] })
    expect(result.ok).toBe(true)
    // mistral was filtered out up front for lacking credentials -- only groq was ever queried.
    expect(result.result).toContain('Providers queried: 1 (groq)')
    expect(result.result).not.toContain('MISTRAL')
  })

  test('a provider whose durable standing is blocked fails honestly for that provider rather than getting silently rerouted', async () => {
    process.env.GROQ_API_KEY = 'test-groq'
    process.env.MISTRAL_API_KEY = 'test-mistral'
    const { recordProviderStanding } = await import('../src/lib/provider-standing')
    await recordProviderStanding('groq', 'blocked', 'BILLING')
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('groq.com')) throw new Error('groq should never be called: it is durably blocked')
      if (url.includes('mistral.ai') && init?.method === 'GET') return jsonResponse({ data: [{ id: 'mistral-large-latest' }] })
      if (url.includes('mistral.ai') && init?.method === 'POST') return jsonResponse({ choices: [{ message: { content: 'Mistral says hello.' } }] })
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch
    const result = await toolMultiProviderCompare({ prompt: 'Say hello', providers: ['groq', 'mistral'] })
    expect(result.ok).toBe(true)
    expect(result.result).toContain('GROQ') // still shown, but as a failure
    expect(result.result).toContain('FAILED')
    expect(result.result).toContain('MISTRAL')
    expect(result.result).toContain('✓ SUCCESS')
  })
})
