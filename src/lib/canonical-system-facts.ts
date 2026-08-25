import { getCanonicalRuntimeManifest, type CanonicalRuntimeManifest } from './canonical-runtime-manifest'

export type CanonicalSystemFacts = CanonicalRuntimeManifest

export async function getCanonicalSystemFacts(): Promise<CanonicalSystemFacts> {
  return getCanonicalRuntimeManifest()
}
