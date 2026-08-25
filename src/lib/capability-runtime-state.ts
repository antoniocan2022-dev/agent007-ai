import { db } from './db'

export type CapabilityRuntimeStatus = 'UNKNOWN' | 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'UNAVAILABLE'

export interface CapabilityRuntimeState {
  id: string
  status: CapabilityRuntimeStatus
  probedAt: number | null
  lastSuccessAt: number | null
  lastFailureAt: number | null
  consecutiveFailures: number
  details?: string
  proofLevel?: 'CONNECTIVITY' | 'AUTHENTICATION' | 'EXECUTION_VALIDATED'
}

const GLOBAL = globalThis as typeof globalThis & {
  __agent007CapabilityRuntimeState?: Record<string, CapabilityRuntimeState>
}

const stateStore = GLOBAL.__agent007CapabilityRuntimeState ??= {}

function normalize(id: string): string {
  return id.trim().toLowerCase()
}

function unknownState(key: string): CapabilityRuntimeState {
  return {
    id: key,
    status: 'UNKNOWN',
    probedAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    consecutiveFailures: 0,
  }
}

function parsePersistedState(value: string, key: string): CapabilityRuntimeState | null {
  try {
    const parsed = JSON.parse(value) as Partial<CapabilityRuntimeState>
    if (typeof parsed !== 'object' || parsed === null) return null
    if (typeof parsed.id !== 'string' || normalize(parsed.id) !== key) return null
    if (!['UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNHEALTHY', 'UNAVAILABLE'].includes(parsed.status as string)) return null
    if (parsed.probedAt !== null && typeof parsed.probedAt !== 'number') return null
    if (parsed.lastSuccessAt !== null && typeof parsed.lastSuccessAt !== 'number') return null
    if (parsed.lastFailureAt !== null && typeof parsed.lastFailureAt !== 'number') return null
    if (typeof parsed.consecutiveFailures !== 'number' || !Number.isInteger(parsed.consecutiveFailures) || parsed.consecutiveFailures < 0) return null
    return {
      id: key,
      status: parsed.status as CapabilityRuntimeStatus,
      probedAt: parsed.probedAt ?? null,
      lastSuccessAt: parsed.lastSuccessAt ?? null,
      lastFailureAt: parsed.lastFailureAt ?? null,
      consecutiveFailures: parsed.consecutiveFailures,
      ...(typeof parsed.details === 'string' ? { details: parsed.details.slice(0, 500) } : {}),
      ...(parsed.proofLevel === 'CONNECTIVITY' || parsed.proofLevel === 'AUTHENTICATION' || parsed.proofLevel === 'EXECUTION_VALIDATED' ? { proofLevel: parsed.proofLevel } : {}),
    }
  } catch {
    return null
  }
}

export function getCapabilityRuntimeState(id: string): CapabilityRuntimeState {
  const key = normalize(id)
  return stateStore[key] ?? unknownState(key)
}

/**
 * Durable read boundary. Database evidence is canonical; the process-local
 * object is only a fast cache/projection for synchronous callers.
 */
export async function getCapabilityRuntimeStatePersistent(id: string): Promise<CapabilityRuntimeState> {
  const key = normalize(id)
  const row = await db.memory.findUnique({ where: { key: `capability_runtime:${key}` }, select: { value: true } })
  const persisted = row ? parsePersistedState(row.value, key) : null
  if (persisted) {
    stateStore[key] = persisted
    return persisted
  }
  return getCapabilityRuntimeState(key)
}

export function setCapabilityProbeResult(
  id: string,
  result: { ok: boolean; details?: string; proofLevel?: CapabilityRuntimeState['proofLevel'] },
): CapabilityRuntimeState {
  const key = normalize(id)
  const now = Date.now()
  const previous = getCapabilityRuntimeState(key)
  const next: CapabilityRuntimeState = {
    id: key,
    status: result.ok
      ? previous.consecutiveFailures > 0 ? 'DEGRADED' : 'HEALTHY'
      : previous.lastSuccessAt ? 'DEGRADED' : 'UNHEALTHY',
    probedAt: now,
    lastSuccessAt: result.ok ? now : previous.lastSuccessAt,
    lastFailureAt: result.ok ? previous.lastFailureAt : now,
    consecutiveFailures: result.ok ? 0 : previous.consecutiveFailures + 1,
    ...(result.details ? { details: result.details.slice(0, 500) } : {}),
    ...(result.proofLevel ? { proofLevel: result.proofLevel } : {}),
  }
  stateStore[key] = next
  return next
}

export function markCapabilityUnavailable(id: string, details?: string): CapabilityRuntimeState {
  const key = normalize(id)
  const now = Date.now()
  const next: CapabilityRuntimeState = {
    id: key,
    status: 'UNAVAILABLE',
    probedAt: now,
    lastSuccessAt: null,
    lastFailureAt: now,
    consecutiveFailures: 0,
    ...(details ? { details: details.slice(0, 500) } : {}),
  }
  stateStore[key] = next
  return next
}

export function listCapabilityRuntimeStates(): CapabilityRuntimeState[] {
  return Object.values(stateStore).sort((a, b) => a.id.localeCompare(b.id))
}

export async function listCapabilityRuntimeStatesPersistent(): Promise<CapabilityRuntimeState[]> {
  const rows = await db.memory.findMany({ where: { category: 'capability_runtime' }, select: { value: true } })
  for (const row of rows) {
    const parsed = (() => {
      try { return JSON.parse(row.value) as CapabilityRuntimeState } catch { return null }
    })()
    if (!parsed?.id) continue
    const state = parsePersistedState(row.value, normalize(parsed.id))
    if (state) stateStore[state.id] = state
  }
  return listCapabilityRuntimeStates()
}
