import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { clearProviderCatalogCache } from '../src/lib/provider-control-plane'
import { getProviderStanding, recordProviderStanding, resetProviderStandingForTests } from '../src/lib/provider-standing'
import { runGovernedProviderChat } from '../src/lib/provider-runtime-v2'
import { resetProviderHealthForTests } from '../src/lib/provider-intelligence'

// Provider Gateway Phase B (2026-09-19): this suite covers the two things Phase B actually shipped --
// (1) provider-standing.ts, a durable (Memory-table-backed, in-memory-cached) layer for the standing
// half of PROVIDER_FAILURE_POLICY ('cooldown'/'blocked') that survives a cold start, unlike
// provider-intelligence.ts's process-local circuit breaker; and (2) runGovernedProviderChat now
// consulting it so a durably-blocked provider is never selected, not even for the one bounded
// half-open probe. This sandbox's Prisma client is a stub that rejects every real call (see
// provider-standing.ts's own fail-open-on-read comment) -- these tests exercise the in-memory cache
// path, which is populated synchronously by recordProviderStanding before it ever attempts the DB
// write, so the behavior under test doesn't depend on a live database.

const ENV = ['GROQ_API_KEY', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'MISTRAL_API_KEY', 'CEREBRAS_API_KEY', 'OPENROUTER_API_KEY'] as const
const savedEnv: Record<string, string | undefined> = {}
const originalFetch = globalThis.fetch
function jsonResponse(payload: unknown, status = 200): Response { return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } }) }

beforeEach(() => { for (const env of ENV) { savedEnv[env] = process.env[env]; delete process.env[env] }; clearProviderCatalogCache(); resetProviderHealthForTests(); resetProviderStandingForTests() })
afterEach(() => { globalThis.fetch = originalFetch; for (const env of ENV) { const value = savedEnv[env]; if (value === undefined) delete process.env[env]; else process.env[env] = value }; clearProviderCatalogCache(); resetProviderHealthForTests(); resetProviderStandingForTests() })

describe('provider-standing.ts: durable standing survives what the in-memory circuit breaker cannot', () => {
  test('an unrecorded provider defaults to standing "none"', async () => {
    const standing = await getProviderStanding('groq')
    expect(standing.standing).toBe('none')
  })

  test('recordProviderStanding is immediately visible to a subsequent read via the in-memory cache, even though this sandbox has no live DB', async () => {
    await recordProviderStanding('groq', 'blocked', 'BILLING')
    const standing = await getProviderStanding('groq')
    expect(standing.standing).toBe('blocked')
    expect(standing.reason).toBe('BILLING')
    expect(standing.until).toBeGreaterThan(Date.now())
  })

  test('a cooldown standing carries a shorter window than a blocked standing by default', async () => {
    await recordProviderStanding('groq', 'cooldown', 'RATE_LIMIT')
    const cooldown = await getProviderStanding('groq')
    await recordProviderStanding('cloudflare', 'blocked', 'BILLING')
    const blocked = await getProviderStanding('cloudflare')
    expect(cooldown.until! - Date.now()).toBeLessThan(blocked.until! - Date.now())
  })

  test('recording "none" clears a prior blocked/cooldown standing', async () => {
    await recordProviderStanding('groq', 'blocked', 'BILLING')
    expect((await getProviderStanding('groq')).standing).toBe('blocked')
    await recordProviderStanding('groq', 'none')
    const cleared = await getProviderStanding('groq')
    expect(cleared.standing).toBe('none')
    expect(cleared.until).toBeUndefined()
  })

  test('an expired standing (past its "until" window) reads back as "none" without needing an explicit clear', async () => {
    await recordProviderStanding('groq', 'blocked', 'BILLING', -1)
    const standing = await getProviderStanding('groq')
    expect(standing.standing).toBe('none')
  })

  test('getProviderStandings batches multiple providers into one map', async () => {
    await recordProviderStanding('groq', 'blocked', 'BILLING')
    const { getProviderStandings } = await import('../src/lib/provider-standing')
    const standings = await getProviderStandings(['groq', 'cloudflare'])
    expect(standings.get('groq')?.standing).toBe('blocked')
    expect(standings.get('cloudflare')?.standing).toBe('none')
  })
})

describe('runGovernedProviderChat: a durably-blocked provider is never selected, including for the half-open probe', () => {
  test('a provider durably marked blocked (e.g. from a prior cold start) is skipped even though its in-memory circuit is closed', async () => {
    process.env.GROQ_API_KEY = 'test-groq'
    process.env.CLOUDFLARE_API_KEY = 'test-cloudflare'
    process.env.CLOUDFLARE_ACCOUNT_ID = 'account-123'
    // Simulate what a different, earlier serverless instance recorded before this one cold-started --
    // groq's in-memory circuit breaker here is closed (this process has zero observations of its own),
    // but the durable standing says blocked.
    await recordProviderStanding('groq', 'blocked', 'BILLING')
    let groqCalled = false
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('groq.com')) { groqCalled = true; throw new Error('groq should never be called: it is durably blocked') }
      if (url.includes('/models/search')) return jsonResponse({ result: [{ name: '@cf/google/gemma-4-26b-a4b-it' }] })
      if (url.includes('/chat/completions') && init?.method === 'POST') return jsonResponse({ choices: [{ message: { content: 'Cloudflare handled it.' } }] })
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch
    const result = await runGovernedProviderChat({ messages: [{ role: 'user', content: 'Say hello' }], taskType: 'general', maxProviderAttempts: 2 })
    expect(groqCalled).toBe(false)
    expect(result.provider).toBe('cloudflare')
    expect(result.attempts).toEqual(['cloudflare'])
  })

  test('a real BILLING failure durably blocks the provider for a subsequent call in the same process', async () => {
    process.env.GROQ_API_KEY = 'test-groq'
    process.env.CLOUDFLARE_API_KEY = 'test-cloudflare'
    process.env.CLOUDFLARE_ACCOUNT_ID = 'account-123'
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('groq.com') && init?.method === 'GET') return jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }] })
      if (url.includes('groq.com') && init?.method === 'POST') return jsonResponse({ error: { message: 'payment required' } }, 402)
      if (url.includes('/models/search')) return jsonResponse({ result: [{ name: '@cf/google/gemma-4-26b-a4b-it' }] })
      if (url.includes('/chat/completions') && init?.method === 'POST') return jsonResponse({ choices: [{ message: { content: 'Cloudflare handled it.' } }] })
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch
    const first = await runGovernedProviderChat({ messages: [{ role: 'user', content: 'Say hello' }], taskType: 'general', maxProviderAttempts: 2 })
    expect(first.provider).toBe('cloudflare')
    expect((await getProviderStanding('groq')).standing).toBe('blocked')

    // A second, independent call in the same process must not re-try groq either -- the durable
    // standing persists across calls, not just within the one that discovered the billing failure.
    let groqCalledAgain = false
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('groq.com')) { groqCalledAgain = true; throw new Error('groq should not be retried while durably blocked') }
      if (url.includes('/models/search')) return jsonResponse({ result: [{ name: '@cf/google/gemma-4-26b-a4b-it' }] })
      if (url.includes('/chat/completions') && init?.method === 'POST') return jsonResponse({ choices: [{ message: { content: 'Cloudflare again.' } }] })
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch
    const second = await runGovernedProviderChat({ messages: [{ role: 'user', content: 'Say hello again' }], taskType: 'general', maxProviderAttempts: 2 })
    expect(groqCalledAgain).toBe(false)
    expect(second.provider).toBe('cloudflare')
  })

  test('a real success clears a prior durable standing', async () => {
    process.env.GROQ_API_KEY = 'test-groq'
    await recordProviderStanding('groq', 'blocked', 'BILLING', -1) // already expired, so groq is selectable
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('groq.com') && init?.method === 'GET') return jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }] })
      if (url.includes('groq.com') && init?.method === 'POST') return jsonResponse({ choices: [{ message: { content: 'Groq is back.' } }] })
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch
    const result = await runGovernedProviderChat({ messages: [{ role: 'user', content: 'Say hello' }], taskType: 'general', maxProviderAttempts: 1 })
    expect(result.provider).toBe('groq')
    // recordProviderStanding(provider, 'none') is fire-and-forget (void ...catch), so give its
    // microtask a turn to land before asserting the clear.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect((await getProviderStanding('groq')).standing).toBe('none')
  })
})
