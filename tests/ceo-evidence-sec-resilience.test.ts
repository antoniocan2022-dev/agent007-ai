import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { DEFAULT_SEC_UA, getSecTickerMap, resetSecCachesForTests, resolveSecUserAgent } from '../src/lib/ceo-issuer-resolution'
// ceo-evidence-executor.ts is deliberately never live-imported here, matching
// external-world-search-finance-wiring.test.ts's own established precedent for this exact file (see its
// "fetchMarketDataSource itself is not live-called here" comment): it pulls in dispatchTool -> the full
// tool registry -> auth.ts -> next-auth, a real declared dependency (package.json) that isn't installed
// in every sandbox this suite runs in. The deadline fix is verified by static source assertion instead.

// Live-production incident (2026-09-19): asking "give me updates about GEOS and MIND technology"
// degraded on every attempt. Root cause traced to two things via real Vercel runtime logs:
//   1. Every SEC EDGAR call 403'd because the User-Agent this codebase sent never met SEC's fair-access
//      policy -- and nothing remembered that, so the initial evidence pass AND the recovery pass (which
//      keeps profile:'public_equity' and re-runs the whole plan) both re-attempted the identical, doomed
//      SEC calls.
//   2. fetchMarketDataSource's 6-tool sequential fallback chain per ticker had no overall deadline, so
//      an unconfigured or slow tool early in the chain could eat a large share of the request's latency
//      budget before ever reaching a tool that might actually succeed.
// This suite locks in the fast-fail fixes for both: a short negative-cache for SEC's HTTP 401/403 (never
// for timeouts/5xx -- those are exactly the transient failures a retry might still recover from), and a
// bounded deadline on the market-data fallback chain.

const originalFetch = globalThis.fetch
function jsonResponse(payload: unknown, status = 200): Response { return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } }) }

beforeEach(() => { resetSecCachesForTests() })
afterEach(() => { globalThis.fetch = originalFetch; resetSecCachesForTests() })

describe('resolveSecUserAgent: single source of truth for the SEC-facing User-Agent', () => {
  const savedEnv = process.env.SEC_USER_AGENT
  afterEach(() => { if (savedEnv === undefined) delete process.env.SEC_USER_AGENT; else process.env.SEC_USER_AGENT = savedEnv })

  test('uses SEC_USER_AGENT when configured', () => {
    process.env.SEC_USER_AGENT = 'Agent007 AI owner@example.com'
    expect(resolveSecUserAgent()).toBe('Agent007 AI owner@example.com')
  })

  test('falls back to the documented default when unset', () => {
    delete process.env.SEC_USER_AGENT
    expect(resolveSecUserAgent()).toBe(DEFAULT_SEC_UA)
  })

  test('ignores a blank/whitespace-only override and falls back to the default', () => {
    process.env.SEC_USER_AGENT = '   '
    expect(resolveSecUserAgent()).toBe(DEFAULT_SEC_UA)
  })
})

describe('getSecTickerMap: a real SEC 401/403 is remembered so later calls in the same turn fail fast', () => {
  test('a 403 response is negative-cached: a second call never hits the network again', async () => {
    let fetchCalls = 0
    globalThis.fetch = (async () => { fetchCalls++; return jsonResponse({ error: 'forbidden' }, 403) }) as typeof fetch
    await expect(getSecTickerMap()).rejects.toThrow(/HTTP 403/)
    expect(fetchCalls).toBe(1)
    await expect(getSecTickerMap()).rejects.toThrow(/SEC access is currently blocked/)
    expect(fetchCalls).toBe(1) // still 1 -- the second call never reached fetch
  })

  test('a 401 response is negative-cached the same way as 403', async () => {
    let fetchCalls = 0
    globalThis.fetch = (async () => { fetchCalls++; return jsonResponse({ error: 'unauthorized' }, 401) }) as typeof fetch
    await expect(getSecTickerMap()).rejects.toThrow(/HTTP 401/)
    await expect(getSecTickerMap()).rejects.toThrow(/SEC access is currently blocked/)
    expect(fetchCalls).toBe(1)
  })

  test('a transient failure (network error, not 401/403) is never negative-cached -- a later call retries normally', async () => {
    let fetchCalls = 0
    globalThis.fetch = (async () => { fetchCalls++; throw new Error('fetch failed: network error') }) as typeof fetch
    await expect(getSecTickerMap()).rejects.toThrow(/network error/)
    // A second call must reach the network again, not the "currently blocked" fast-fail path.
    await expect(getSecTickerMap()).rejects.toThrow(/network error/)
    expect(fetchCalls).toBe(2)
  })

  test('a transient 503 is never negative-cached', async () => {
    let fetchCalls = 0
    globalThis.fetch = (async () => { fetchCalls++; return jsonResponse({}, 503) }) as typeof fetch
    await expect(getSecTickerMap()).rejects.toThrow(/HTTP 503/)
    await expect(getSecTickerMap()).rejects.toThrow(/HTTP 503/)
    expect(fetchCalls).toBe(2)
  })

  test('a successful response clears any prior negative-cache path and is itself cached', async () => {
    let fetchCalls = 0
    globalThis.fetch = (async () => { fetchCalls++; return jsonResponse({ '0': { cik_str: 940578, title: 'Geospace Technologies Corporation', ticker: 'GEOS' } }) }) as typeof fetch
    const first = await getSecTickerMap()
    expect(first.GEOS?.cik_str).toBe(940578)
    const second = await getSecTickerMap()
    expect(second).toBe(first) // same cached object, no second fetch
    expect(fetchCalls).toBe(1)
  })
})

describe('fetchMarketDataSource: the 6-tool sequential fallback chain has a bounded overall deadline', () => {
  const src = readFileSync(new URL('../src/lib/ceo-evidence-executor.ts', import.meta.url), 'utf8')

  test('a deadline is computed once, before the loop, and checked on every iteration', () => {
    expect(src).toMatch(/const MARKET_DATA_CHAIN_DEADLINE_MS = [\d_]+/)
    expect(src).toMatch(/const deadline = Date\.now\(\) \+ MARKET_DATA_CHAIN_DEADLINE_MS/)
    // The check must run inside the per-tool for-loop, before the try/dispatch -- not just once
    // before the loop starts (which would only guard the very first tool, not tools 2-6).
    expect(src).toMatch(/for \(const toolName of MARKET_DATA_TOOL_ORDER\) \{\s*\n\s*throwIfCeoRequestAborted\(signal\)\s*\n\s*if \(Date\.now\(\) >= deadline\) break/)
  })

  test('the deadline is a real, bounded budget (neither near-zero nor effectively unbounded)', () => {
    const match = src.match(/const MARKET_DATA_CHAIN_DEADLINE_MS = ([\d_]+)/)
    expect(match).not.toBeNull()
    const deadlineMs = Number(match![1].replace(/_/g, ''))
    expect(deadlineMs).toBeGreaterThan(2000) // a single real network round-trip must fit
    expect(deadlineMs).toBeLessThan(60_000) // must not be able to consume the whole request budget alone
  })
})
