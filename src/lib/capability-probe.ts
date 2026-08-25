import { db } from './db'
import { getCapabilityRuntimeState, setCapabilityProbeResult, type CapabilityRuntimeState } from './capability-runtime-state'

export interface CapabilityProbeContext {
  capabilityId: string
  forceRefresh?: boolean
}

export interface CapabilityProbeResult {
  ok: boolean
  details?: string
  proofLevel?: 'CONNECTIVITY' | 'AUTHENTICATION' | 'EXECUTION_VALIDATED'
}

export interface CapabilityProbe {
  id: string
  probe(context: CapabilityProbeContext): Promise<CapabilityProbeResult>
}

const probes = new Map<string, CapabilityProbe>()

export function registerCapabilityProbe(probe: CapabilityProbe): void {
  const id = probe.id.trim().toLowerCase()
  if (!id) throw new Error('Capability probe id is required.')
  if (probes.has(id)) throw new Error(`Capability probe already registered: ${id}`)
  probes.set(id, { ...probe, id })
}

export function getCapabilityProbe(id: string): CapabilityProbe | undefined {
  return probes.get(id.trim().toLowerCase())
}

export function listCapabilityProbes(): string[] {
  return [...probes.keys()].sort()
}

export async function runCapabilityProbe(id: string, context: Omit<CapabilityProbeContext, 'capabilityId'> = {}): Promise<CapabilityRuntimeState> {
  const normalizedId = id.trim().toLowerCase()
  const probe = getCapabilityProbe(normalizedId)
  if (!probe) throw new Error(`No capability probe registered: ${normalizedId}`)

  try {
    const result = await probe.probe({ ...context, capabilityId: normalizedId })
    const state = setCapabilityProbeResult(normalizedId, result)
    await db.memory.upsert({
      where: { key: `capability_runtime:${normalizedId}` },
      update: { category: 'capability_runtime', value: JSON.stringify({ ...state, proofLevel: result.proofLevel ?? 'CONNECTIVITY' }) },
      create: { key: `capability_runtime:${normalizedId}`, category: 'capability_runtime', value: JSON.stringify({ ...state, proofLevel: result.proofLevel ?? 'CONNECTIVITY' }) },
    })
    return state
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const state = setCapabilityProbeResult(normalizedId, { ok: false, details: message })
    await db.memory.upsert({
      where: { key: `capability_runtime:${normalizedId}` },
      update: { category: 'capability_runtime', value: JSON.stringify({ ...state, proofLevel: 'CONNECTIVITY' }) },
      create: { key: `capability_runtime:${normalizedId}`, category: 'capability_runtime', value: JSON.stringify({ ...state, proofLevel: 'CONNECTIVITY' }) },
    })
    return state
  }
}
