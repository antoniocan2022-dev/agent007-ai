import type { ActiveProviderId, ProviderErrorKind } from './provider-control-plane'

export type ProviderErrorLifecycleState = 'active' | 'recurring' | 'historical' | 'resolved'
export interface ProviderErrorEvent { provider: ActiveProviderId; kind: ProviderErrorKind; at: number }
export interface ProviderErrorLifecycle { provider: ActiveProviderId; kind: ProviderErrorKind; state: ProviderErrorLifecycleState; lastErrorAt: number | null; lastSuccessAt: number | null; recentErrorCount: number }

const EVENTS = new Map<string, ProviderErrorEvent[]>()
const SUCCESSES = new Map<ActiveProviderId, number>()
const ACTIVE_WINDOW_MS = 10 * 60 * 1000
const RECURRING_WINDOW_MS = 15 * 60 * 1000
const HISTORICAL_WINDOW_MS = 24 * 60 * 60 * 1000
const MAX_EVENTS_PER_KEY = 32

function key(provider: ActiveProviderId, kind: ProviderErrorKind): string { return `${provider}:${kind}` }

export function recordProviderError(provider: ActiveProviderId, kind: ProviderErrorKind, at = Date.now()): void {
  const k = key(provider, kind)
  const events = EVENTS.get(k) ?? []
  events.push({ provider, kind, at })
  EVENTS.set(k, events.slice(-MAX_EVENTS_PER_KEY))
}

export function recordProviderSuccess(provider: ActiveProviderId, at = Date.now()): void {
  SUCCESSES.set(provider, at)
}

export function classifyProviderErrorLifecycle(provider: ActiveProviderId, kind: ProviderErrorKind, now = Date.now()): ProviderErrorLifecycle {
  const events = EVENTS.get(key(provider, kind)) ?? []
  const lastErrorAt = events.at(-1)?.at ?? null
  const lastSuccessAt = SUCCESSES.get(provider) ?? null
  const recentErrorCount = events.filter((event) => now - event.at <= RECURRING_WINDOW_MS).length
  let state: ProviderErrorLifecycleState
  if (lastErrorAt === null) state = 'resolved'
  else if (lastSuccessAt !== null && lastSuccessAt > lastErrorAt) state = 'resolved'
  else if (now - lastErrorAt > HISTORICAL_WINDOW_MS) state = 'historical'
  else if (now - lastErrorAt <= ACTIVE_WINDOW_MS && recentErrorCount >= 3) state = 'recurring'
  else state = 'active'
  return { provider, kind, state, lastErrorAt, lastSuccessAt, recentErrorCount }
}

export function getProviderErrorLifecycleSnapshot(now = Date.now()): ProviderErrorLifecycle[] {
  const seen = new Set<string>(); const output: ProviderErrorLifecycle[] = []
  for (const [k, events] of EVENTS.entries()) {
    const event = events.at(-1); if (!event || seen.has(k)) continue
    seen.add(k); output.push(classifyProviderErrorLifecycle(event.provider, event.kind, now))
  }
  return output.sort((a, b) => (b.lastErrorAt ?? 0) - (a.lastErrorAt ?? 0))
}

export function resetProviderErrorLifecycle(): void { EVENTS.clear(); SUCCESSES.clear() }
