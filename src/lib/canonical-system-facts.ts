import { getCanonicalRuntimeManifest } from './canonical-runtime-manifest'
import { listCapabilityRuntimeStates, type CapabilityRuntimeState } from './capability-runtime-state'

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
    states: CapabilityRuntimeState[]
  }
  manifestVersion: '1.0'
  fingerprint: string
  generatedAt: string
}

export async function getCanonicalSystemFacts(): Promise<CanonicalSystemFacts> {
  const manifest = getCanonicalRuntimeManifest()
  const states = listCapabilityRuntimeStates()
  return {
    organization: {
      leaderCount: manifest.organization.leaderCount,
      specialistCount: manifest.organization.specialistCount,
      divisionCount: manifest.organization.divisionCount,
      businessCount: manifest.organization.businessCount,
    },
    providers: manifest.providers,
    capabilities: { knownRuntimeStates: states.length, states },
    manifestVersion: manifest.manifestVersion,
    fingerprint: manifest.fingerprint,
    generatedAt: manifest.generatedAt,
  }
}
