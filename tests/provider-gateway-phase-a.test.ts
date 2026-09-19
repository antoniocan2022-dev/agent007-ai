import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { classifyProviderError, compactMessagesForRequestSize, estimateRequestTokens, estimateTokens, getProviderFailurePolicy, getGovernedCandidates, resolveGovernedModel, ProviderControlPlaneError, clearProviderCatalogCache, DEFAULT_MAX_INPUT_TOKENS } from '../src/lib/provider-control-plane'
import { runGovernedProviderChat } from '../src/lib/provider-runtime-v2'
import { getProviderAvailabilityStatus, recordFailure, resetProviderHealthForTests } from '../src/lib/provider-intelligence'

// Provider Gateway Phase A (2026-09-19): this suite locks in the fix for a real production incident --
// Groq's HTTP 413 (request too large) was being misclassified as BILLING because classifyProviderError
// only checked status===402 plus a message-text regex, and Groq's own 413 body text happened to match
// that regex. That wrongly told the recovery path Groq's ACCOUNT was the problem (see
// PROVIDER_FAILURE_POLICY's 'blocked'/no-retry BILLING policy) when the provider itself was fine and
// only that one oversized request wasn't going to work. See tests/provider-control-plane.integration.test.ts
// for the pre-existing classification suite this one is deliberately kept separate from (this one is
// scoped to what Phase A specifically added/changed).

const ENV = ['GROQ_API_KEY', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'MISTRAL_API_KEY', 'CEREBRAS_API_KEY', 'OPENROUTER_API_KEY'] as const
const savedEnv: Record<string, string | undefined> = {}
const originalFetch = globalThis.fetch
function jsonResponse(payload: unknown, status = 200): Response { return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } }) }

beforeEach(() => { for (const env of ENV) { savedEnv[env] = process.env[env]; delete process.env[env] }; clearProviderCatalogCache(); resetProviderHealthForTests() })
afterEach(() => { globalThis.fetch = originalFetch; for (const env of ENV) { const value = savedEnv[env]; if (value === undefined) delete process.env[env]; else process.env[env] = value }; clearProviderCatalogCache(); resetProviderHealthForTests() })

describe('classifyProviderError: REQUEST_TOO_LARGE is checked before the BILLING text-match', () => {
  test('a bare HTTP 413 classifies as REQUEST_TOO_LARGE, never BILLING, regardless of message text', () => {
    expect(classifyProviderError('groq', 413, 'Request too large').kind).toBe('REQUEST_TOO_LARGE')
  })

  test('the real production incident shape: a 413 whose body text incidentally matches the billing regex', () => {
    // Groq's real 413 bodies read like "Request too large ... on tokens per minute (TPM): Limit 6000,
    // Requested 9000 ... reduce your message size" -- wording that can incidentally contain phrases the
    // billing regex (quota exceeded / insufficient .* balance) is looking for. The status check must win.
    const classified = classifyProviderError('groq', 413, 'Request too large for model on tokens per minute (TPM). Limit 6000, Requested 9000. Quota exceeded for this window, please reduce your message size.')
    expect(classified.kind).toBe('REQUEST_TOO_LARGE')
    expect(classified.retryable).toBe(true)
  })

  test('a genuine billing failure (status 402) still classifies as BILLING, unaffected by the 413 fix', () => {
    expect(classifyProviderError('groq', 402, 'payment required').kind).toBe('BILLING')
  })

  test('a non-413 status with request-too-large wording in the body also classifies correctly', () => {
    expect(classifyProviderError('mistral', 400, 'This model\'s maximum context length is 32768 tokens').kind).toBe('REQUEST_TOO_LARGE')
  })
})

describe('classifyProviderError: "quota exceeded" is ambiguous between billing and rate-limiting, and must resolve to the cheaper mistake', () => {
  test('a bare "quota exceeded" message with no status classifies as RATE_LIMIT (60s cooldown), never BILLING (24h block)', () => {
    // Deep-audit finding: real rate-limiters (requests-per-minute/day quotas) commonly use this exact
    // phrase too, not just billing systems, and don't always set HTTP 429. Misreading a transient quota
    // as a billing failure durably blocks a healthy provider for a day; the reverse mistake self-heals
    // in a minute -- so the ambiguous phrase must resolve to RATE_LIMIT, not BILLING.
    const classified = classifyProviderError('groq', undefined, 'Quota exceeded for requests per minute, please retry shortly.')
    expect(classified.kind).toBe('RATE_LIMIT')
    expect(classified.retryable).toBe(true)
  })

  test('an explicit HTTP 402 with billing wording still classifies as BILLING even when "quota" also appears', () => {
    expect(classifyProviderError('groq', 402, 'Monthly quota exceeded: insufficient account balance, please add a payment method').kind).toBe('BILLING')
  })

  test('a genuine billing message without any "quota" wording still classifies as BILLING', () => {
    expect(classifyProviderError('groq', undefined, 'Your account has insufficient credit balance').kind).toBe('BILLING')
  })
})

describe('PROVIDER_FAILURE_POLICY: what a failure means is not the same question as whether the provider is unhealthy', () => {
  test('REQUEST_TOO_LARGE never affects provider health and retries the same provider after compaction', () => {
    const policy = getProviderFailurePolicy('REQUEST_TOO_LARGE')
    expect(policy.affectsProviderHealth).toBe(false)
    expect(policy.standing).toBe('none')
    expect(policy.retrySameProviderAfterCompaction).toBe(true)
  })

  test('BILLING blocks the provider and is never retried -- retrying can never fix an account problem', () => {
    const policy = getProviderFailurePolicy('BILLING')
    expect(policy.affectsProviderHealth).toBe(false)
    expect(policy.standing).toBe('blocked')
    expect(policy.retryable).toBe(false)
  })

  test('RATE_LIMIT cools the provider down but does not mark it as a health failure (it is temporary pressure, not an outage)', () => {
    const policy = getProviderFailurePolicy('RATE_LIMIT')
    expect(policy.affectsProviderHealth).toBe(false)
    expect(policy.standing).toBe('cooldown')
    expect(policy.retryable).toBe(true)
  })

  test('genuine infrastructure failures (UPSTREAM, TIMEOUT, NETWORK) still affect provider health, matching the pre-Phase-A circuit breaker behavior', () => {
    for (const kind of ['UPSTREAM', 'TIMEOUT', 'NETWORK', 'CATALOG_UNAVAILABLE', 'UNKNOWN'] as const) {
      expect(getProviderFailurePolicy(kind).affectsProviderHealth).toBe(true)
    }
  })

  test('MODEL_UNAVAILABLE and MODEL_NOT_GOVERNED never affect provider health -- the model is the problem, not the provider', () => {
    expect(getProviderFailurePolicy('MODEL_UNAVAILABLE').affectsProviderHealth).toBe(false)
    expect(getProviderFailurePolicy('MODEL_NOT_GOVERNED').affectsProviderHealth).toBe(false)
  })
})

describe('compactMessagesForRequestSize', () => {
  test('leaves a request under budget untouched', () => {
    const messages = [{ role: 'system', content: 'You are helpful.' }, { role: 'user', content: 'Hi' }]
    expect(compactMessagesForRequestSize(messages, 6000)).toEqual(messages)
  })

  test('truncates the largest non-system message first, preserving message count and roles', () => {
    const huge = 'x'.repeat(40000)
    const messages = [{ role: 'system', content: 'You are helpful.' }, { role: 'user', content: huge }, { role: 'assistant', content: 'ok' }]
    const compacted = compactMessagesForRequestSize(messages, 1000)
    expect(compacted).toHaveLength(3)
    expect(compacted.map((m) => m.role)).toEqual(['system', 'user', 'assistant'])
    expect(String(compacted[1]!.content).length).toBeLessThan(huge.length)
    expect(String(compacted[1]!.content)).toContain('truncated')
    expect(compacted[0]!.content).toBe('You are helpful.')
    expect(compacted[2]!.content).toBe('ok')
  })

  test('preserves head and tail of the truncated content, not just a hard cutoff', () => {
    const content = `HEAD-MARKER ${'x'.repeat(40000)} TAIL-MARKER`
    const compacted = compactMessagesForRequestSize([{ role: 'user', content }], 500)
    const result = String(compacted[0]!.content)
    expect(result).toContain('HEAD-MARKER')
    expect(result).toContain('TAIL-MARKER')
  })

  test('estimateRequestTokens sums estimated tokens across string-content messages', () => {
    const messages = [{ role: 'user', content: 'a'.repeat(400) }, { role: 'assistant', content: 'b'.repeat(400) }]
    expect(estimateRequestTokens(messages)).toBe(estimateTokens('a'.repeat(400)) + estimateTokens('b'.repeat(400)))
  })

  test('compacts many small messages that individually never cross the old 200-token floor but cumulatively exceed budget', () => {
    // Deep-audit finding: compaction used to skip any message under ~200 estimated tokens outright, so a
    // request built from many small messages (each under that floor) could never be compacted at all,
    // even when their sum was far over budget -- the function would silently leave every one of them
    // completely untouched. Each message here is ~190 tokens (760 chars); 40 of them sum to ~7600 tokens.
    // A 400-char-per-message floor (targetCharsForThisMessage's own minimum) means this can't reach an
    // arbitrarily low target with 40 messages, but it must materially shrink them -- the old bug shrank
    // by exactly zero.
    const messages = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `msg-${i}-` + 'x'.repeat(750) }))
    const originalTokens = estimateRequestTokens(messages)
    expect(originalTokens).toBeGreaterThan(1000)
    const compacted = compactMessagesForRequestSize(messages, 1000)
    expect(estimateRequestTokens(compacted)).toBeLessThan(originalTokens * 0.7)
    expect(compacted).toHaveLength(40)
    expect(compacted.some((m) => String(m.content).includes('truncated'))).toBe(true)
  })

  test('never touches array/multimodal message content it cannot safely measure or truncate', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'describe this image' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] },
      { role: 'assistant', content: 'y'.repeat(40000) },
    ]
    const compacted = compactMessagesForRequestSize(messages, 500)
    expect(compacted[0]!.content).toEqual(messages[0]!.content)
    expect(String(compacted[1]!.content).length).toBeLessThan(40000)
  })
})

describe('getProviderAvailabilityStatus: a provider with zero observations is UNKNOWN, never DEGRADED', () => {
  test('an unconfigured provider reports NOT_CONFIGURED', () => {
    expect(getProviderAvailabilityStatus('groq')).toBe('NOT_CONFIGURED')
  })

  test('a configured provider with zero calls reports UNKNOWN, not a score-derived DEGRADED/HEALTHY label', () => {
    process.env.GROQ_API_KEY = 'test'
    expect(getProviderAvailabilityStatus('groq')).toBe('UNKNOWN')
  })

  test('a configured provider whose circuit is open reports CIRCUIT_OPEN', () => {
    process.env.GROQ_API_KEY = 'test'
    // Past the cold-start grace window (provider-intelligence.ts's COLD_START_GRACE_MS), same technique
    // tests/provider-intelligence-cold-start.test.ts uses -- a failure burst within that window is
    // deliberately not evidence of a real outage and must not trip the breaker.
    const G = globalThis as typeof globalThis & { __providerHealthProcessStartedAt?: number }
    G.__providerHealthProcessStartedAt = Date.now() - 25_000
    recordFailure('groq'); recordFailure('groq'); recordFailure('groq')
    expect(getProviderAvailabilityStatus('groq')).toBe('CIRCUIT_OPEN')
  })
})

describe('resolveGovernedModel: an explicit model override cannot silently violate the quality tier a strict request requires', () => {
  // Deep-audit finding (post-merge review of the whole provider architecture): getGovernedCandidates
  // only used the quality>=90 "strict" bar as a soft ranking nudge among AUTO-selected candidates.
  // An explicit requestedModel bypassed it entirely -- most sharply for OpenRouter, where a
  // requested model skips live-catalog validation and is returned unconditionally. A dual-review
  // (or financial/security) request naming openrouter/free (quality 75) got it with no signal the
  // request's own quality guarantee was violated.
  test('an explicit low-quality OpenRouter model is rejected for a dual-review request', async () => {
    process.env.OPENROUTER_API_KEY = 'test'
    await expect(resolveGovernedModel('openrouter', 'reasoning', 'dual-review', 'openrouter/free')).rejects.toThrow(ProviderControlPlaneError)
    await expect(resolveGovernedModel('openrouter', 'reasoning', 'dual-review', 'openrouter/free')).rejects.toThrow(/does not meet the quality bar/)
  })

  test('the same explicit low-quality model is still honored for a standard (non-strict) request', async () => {
    process.env.OPENROUTER_API_KEY = 'test'
    const model = await resolveGovernedModel('openrouter', 'reasoning', 'standard', 'openrouter/free')
    expect(model).toBe('openrouter/free')
  })

  test('a high-quality explicit model still passes a dual-review request', async () => {
    process.env.OPENROUTER_API_KEY = 'test'
    const model = await resolveGovernedModel('openrouter', 'reasoning', 'dual-review', 'anthropic/claude-sonnet-5')
    expect(model).toBe('anthropic/claude-sonnet-5')
  })

  test('a financial task rejects an explicit low-quality model even without dual-review verification', async () => {
    process.env.OPENROUTER_API_KEY = 'test'
    await expect(resolveGovernedModel('openrouter', 'financial', 'standard', 'openrouter/free')).rejects.toThrow(ProviderControlPlaneError)
  })

  test('cloudflare (which is governed for both financial and security) never top-ranks a below-floor model for a strict request', () => {
    // Not every provider is governed for every taskType (financial requires long-context, which
    // e.g. groq's profiles lack) -- that's TASK_CAPABILITIES filtering, unrelated to this fix.
    // Cloudflare's single profile (quality 94) is governed for both, so it's a real, non-empty
    // check that auto-selection's top choice already clears the same bar this fix now enforces
    // as a hard gate on explicit requests.
    for (const taskType of ['financial', 'security'] as const) {
      const candidates = getGovernedCandidates('cloudflare', taskType, 'dual-review')
      expect(candidates.length).toBeGreaterThan(0)
      expect(candidates[0]).toBe('@cf/google/gemma-4-26b-a4b-it')
    }
  })
})

describe('runGovernedProviderChat: REQUEST_TOO_LARGE retries the same provider after compaction instead of failing over', () => {
  test('a 413 on the first attempt is recovered by retrying the SAME provider with compacted messages, never reaching a second provider', async () => {
    process.env.GROQ_API_KEY = 'test-groq'
    process.env.CLOUDFLARE_API_KEY = 'test-cloudflare'
    process.env.CLOUDFLARE_ACCOUNT_ID = 'account-123'
    let groqPostAttempts = 0
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('groq.com') && init?.method === 'GET') return jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }] })
      if (url.includes('groq.com') && init?.method === 'POST') {
        groqPostAttempts++
        if (groqPostAttempts === 1) return jsonResponse({ error: { message: 'Request too large for model on tokens per minute (TPM). Limit 6000, Requested 9000.' } }, 413)
        return jsonResponse({ choices: [{ message: { content: 'Groq succeeded after compaction.' } }] })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch
    const huge = 'evidence '.repeat(20000)
    const result = await runGovernedProviderChat({ messages: [{ role: 'user', content: huge }], taskType: 'general', maxProviderAttempts: 2 })
    expect(groqPostAttempts).toBe(2)
    expect(result.provider).toBe('groq')
    expect(result.content).toContain('after compaction')
    // Never reached Cloudflare -- the retry-same-provider path resolved it without falling over.
    expect(result.attempts).toEqual(['groq'])
  })

  test('a REQUEST_TOO_LARGE failure never trips the circuit breaker, even after the compacted retry also fails', async () => {
    process.env.GROQ_API_KEY = 'test-groq'
    process.env.CLOUDFLARE_API_KEY = 'test-cloudflare'
    process.env.CLOUDFLARE_ACCOUNT_ID = 'account-123'
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('groq.com') && init?.method === 'GET') return jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }] })
      if (url.includes('groq.com') && init?.method === 'POST') return jsonResponse({ error: { message: 'Request too large. Quota exceeded for tokens per minute.' } }, 413)
      if (url.includes('/models/search')) return jsonResponse({ result: [{ name: '@cf/google/gemma-4-26b-a4b-it' }] })
      if (url.includes('/chat/completions') && init?.method === 'POST') return jsonResponse({ choices: [{ message: { content: 'Cloudflare took over.' } }] })
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch
    const huge = 'evidence '.repeat(20000)
    const result = await runGovernedProviderChat({ messages: [{ role: 'user', content: huge }], taskType: 'general', maxProviderAttempts: 2 })
    expect(result.provider).toBe('cloudflare')
    expect(result.attempts).toEqual(['groq', 'cloudflare'])
    // Groq failed twice (original + compacted retry) but must still read as healthy -- REQUEST_TOO_LARGE
    // never affects provider health per PROVIDER_FAILURE_POLICY.
    process.env.GROQ_API_KEY = 'test-groq'
    const { isCircuitOpen } = await import('../src/lib/provider-intelligence')
    expect(isCircuitOpen('groq')).toBe(false)
  })
})
