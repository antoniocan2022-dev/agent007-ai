import { getCanonicalRuntimeManifest, getCanonicalOrganizationPromptFromManifest } from './canonical-runtime-manifest'

export interface CanonicalOrganizationFacts {
  leaderCount: number
  specialistCount: number
  divisionCount: number
  businessCount: number
  leaderIds: readonly string[]
  divisionNames: readonly string[]
  businessKeys: readonly string[]
  fingerprint: string
}

export function getCanonicalOrganizationFacts(): CanonicalOrganizationFacts {
  const manifest = getCanonicalRuntimeManifest()
  return {
    leaderCount: manifest.organization.leaderCount,
    specialistCount: manifest.organization.specialistCount,
    divisionCount: manifest.organization.divisionCount,
    businessCount: manifest.organization.businessCount,
    leaderIds: manifest.organization.leaderIds,
    divisionNames: manifest.organization.divisionNames,
    businessKeys: manifest.organization.businessKeys,
    fingerprint: manifest.fingerprint,
  }
}

export function getCanonicalOrganizationPrompt(): string {
  return getCanonicalOrganizationPromptFromManifest()
}
