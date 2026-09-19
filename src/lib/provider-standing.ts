import { db } from './db'
import type { ActiveProviderId } from './provider-control-plane'

// Provider Gateway Phase B (2026-09-19): the in-memory circuit breaker (provider-intelligence.ts)
// resets on every cold start -- globalThis is process-local, and Vercel serverless instances are
// short-lived and multiplied. That's a fine tradeoff for TRANSIENT infrastructure failures (a fresh
// instance deserves a clean slate; see that file's own cold-start-grace comment) but a real problem for
// the two PROVIDER_FAILURE_POLICY standings that mean something durable: 'blocked' (billing/auth --
// nothing about a fresh process makes an unpaid bill paid) and 'cooldown' (rate-limit backoff, which a
// fresh instance has no way to know is already in progress). Without persistence, every new cold start
// re-tries a provider that was blocked seconds ago on a different instance, wasting an attempt and
// adding latency to a request that was always going to fail the same way.
//
// This is deliberately NOT a merge of provider-intelligence.ts / performance-intelligence.ts /
// outcome-intelligence.ts into one store (the larger "ProviderStanding absorbs everything" redesign) --
// that's real, separately-scoped surgery. This is the bounded, durable piece: only the standing
// (none/cooldown/blocked) that actually needs to survive a cold start, backed by the existing Memory
// table every other small durable record in this codebase already uses (see ceo-evidence-trace.ts),
// not a new Prisma model this sandbox has no live database to verify a migration against.
export type ProviderStandingState = 'none' | 'cooldown' | 'blocked'
export interface ProviderStanding { provider: ActiveProviderId; standing: ProviderStandingState; reason?: string; until?: number; updatedAt: number }

const DEFAULT_COOLDOWN_MS = 60_000
// Blocked (billing/auth) usually needs a human to fix the underlying account problem -- a long,
// deliberately conservative window so the same broken credential doesn't keep getting retried all day,
// while still self-healing within a day if the caller never gets a chance to record a real success.
const DEFAULT_BLOCKED_MS = 24 * 60 * 60_000
const CACHE_TTL_MS = 5_000

function memoryKey(provider: ActiveProviderId): string { return `provider_standing_${provider}` }
function freshStanding(provider: ActiveProviderId): ProviderStanding { return { provider, standing: 'none', updatedAt: 0 } }

const cache = new Map<ActiveProviderId, { standing: ProviderStanding; cachedAt: number }>()

// An expired cooldown/blocked window reads back as 'none' -- callers never separately check `until`.
// Applied uniformly on every read path (cache hit AND DB read): a standing recorded with a short or
// already-past window must expire correctly even while still within the cache's own TTL, not only
// once the cache entry itself ages out.
function resolveExpiry(provider: ActiveProviderId, standing: ProviderStanding): ProviderStanding {
  return standing.until && standing.until < Date.now() ? { ...freshStanding(provider), updatedAt: standing.updatedAt } : standing
}

export async function getProviderStanding(provider: ActiveProviderId): Promise<ProviderStanding> {
  const cached = cache.get(provider)
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return resolveExpiry(provider, cached.standing)
  try {
    const row = await db.memory.findUnique({ where: { key: memoryKey(provider) } })
    const parsed: ProviderStanding = row ? JSON.parse(row.value) : freshStanding(provider)
    const resolved = resolveExpiry(provider, parsed)
    cache.set(provider, { standing: resolved, cachedAt: Date.now() })
    return resolved
  } catch {
    // Fail-open on read: a DB hiccup must never block every provider from being tried. The in-memory
    // circuit breaker is still the fast-path safety net underneath this durable layer regardless.
    return freshStanding(provider)
  }
}

export async function getProviderStandings(providers: readonly ActiveProviderId[]): Promise<Map<ActiveProviderId, ProviderStanding>> {
  const entries = await Promise.all(providers.map(async (provider) => [provider, await getProviderStanding(provider)] as const))
  return new Map(entries)
}

export async function recordProviderStanding(provider: ActiveProviderId, standing: ProviderStandingState, reason?: string, durationMs?: number): Promise<void> {
  const entry: ProviderStanding = {
    provider,
    standing,
    reason,
    until: standing === 'none' ? undefined : Date.now() + (durationMs ?? (standing === 'blocked' ? DEFAULT_BLOCKED_MS : DEFAULT_COOLDOWN_MS)),
    updatedAt: Date.now(),
  }
  cache.set(provider, { standing: entry, cachedAt: Date.now() })
  try {
    const value = JSON.stringify(entry)
    await db.memory.upsert({ where: { key: memoryKey(provider) }, create: { key: memoryKey(provider), value, category: 'provider_standing' }, update: { value, category: 'provider_standing' } })
  } catch (error) {
    console.warn('[provider-standing] persistence failed:', error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200))
  }
}

/** Test-only reset for deterministic suites; production code never calls this. */
export function resetProviderStandingForTests(): void { cache.clear() }
