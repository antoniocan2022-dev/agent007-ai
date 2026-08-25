import { COMMERCIAL_LEADERS, COMMERCIAL_SPECIALISTS, getCommercialDivisions, getCommercialBusinesses } from './commercial-organization'
import { PROVIDER_ORDER } from './provider-control-plane'
import { listCapabilityRuntimeStates } from './capability-runtime-state'

export interface CanonicalSystemFacts {
  organization: {
    leaderCount: number
    specialistCount: number
    divisionCount: number
    businessCount: number
  }
  providers: {
    registeredCount: number
    registeredIds: readonly string[]
  }
  capabilities: {
    knownRuntimeStates: number
    states: ReturnType<typeof listCapabilityRuntimeStates>
  }
}

export async function getCanonicalSystemFacts(): Promise<CanonicalSystemFacts> {
  try {
    const { TOOL_REGISTRY } = await import('./tools')
    void TOOL_REGISTRY
  } catch {
    // Tool count is intentionally omitted from this contract because registry
    // loading is optional and must never turn a health/facts request into a failure.
  }

  return {
    organization: {
      leaderCount: COMMERCIAL_LEADERS.filter((node) => node.level === 'LEADER').length,
      specialistCount: COMMERCIAL_SPECIALISTS.length,
      divisionCount: getCommercialDivisions().length,
      businessCount: getCommercialBusinesses().length,
    },
    providers: {
      registeredCount: PROVIDER_ORDER.length,
      registeredIds: PROVIDER_ORDER,
    },
    capabilities: {
      knownRuntimeStates: listCapabilityRuntimeStates().length,
      states: listCapabilityRuntimeStates(),
    },
  }
}
