export type CapabilityRuntimeStatus = 'UNKNOWN' | 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'UNAVAILABLE'

export interface CapabilityRuntimeState {
  id: string
  status: CapabilityRuntimeStatus
  probedAt: number | null
  lastSuccessAt: number | null
  lastFailureAt: number | null
  consecutiveFailures: number
  details?: string
}

const GLOBAL = globalThis as typeof globalThis & {
  __agent007CapabilityRuntimeState?: Record<string, CapabilityRuntimeState>
}

const stateStore = GLOBAL.__agent007CapabilityRuntimeState ??= {}

function normalize(id: string): string {
  return id.trim().toLowerCase()
}

export function getCapabilityRuntimeState(id: string): CapabilityRuntimeState {
  const key = normalize(id)
  return stateStore[key] ?? {
    id: key,
    status: 'UNKNOWN',
    probedAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    consecutiveFailures: 0,
  }
}

export function setCapabilityProbeResult(
  id: string,
  result: { ok: boolean; details?: string },
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
