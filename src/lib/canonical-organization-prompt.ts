import { getCanonicalRuntimeManifest, getCanonicalOrganizationPromptFromManifest } from './canonical-runtime-manifest'

export type CanonicalOrganizationFacts = ReturnType<typeof getCanonicalOrganizationFacts>

export function getCanonicalOrganizationFacts() {
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
