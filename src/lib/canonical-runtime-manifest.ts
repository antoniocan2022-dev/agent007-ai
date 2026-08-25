import { createHash } from 'node:crypto'
import { COMMERCIAL_LEADERS, COMMERCIAL_SPECIALISTS, getCommercialBusinesses, getCommercialDivisions } from './commercial-organization'
import { PROVIDER_ORDER } from './provider-control-plane'
import { listCapabilityRuntimeStates } from './capability-runtime-state'
import { TOOL_REGISTRY } from './tools'

export interface CanonicalRuntimeManifest {
  manifestVersion: '1.0'
  generatedAt: string
  organization: {
    leaderCount: number
    specialistCount: number
    divisionCount: number
    businessCount: number
    leaderIds: readonly string[]
    divisionNames: readonly string[]
    businessKeys: readonly string[]
  }
  providers: {
    registeredCount: number
    registeredIds: readonly string[]
  }
  capabilities: {
    toolCount: number
    runtimeStateCount: number
    healthyCount: number
    degradedCount: number
    unhealthyCount: number
    unavailableCount: number
    unknownCount: number
  }
  fingerprint: string
}

let cached: CanonicalRuntimeManifest | null = null
let cachedAt = 0
const CACHE_TTL_MS = 60_000

function fingerprintInput() {
  const leaderIds = COMMERCIAL_LEADERS.map((node) => `${node.id}:${node.level}:${node.reportsTo ?? ''}:${node.division}:${node.businesses.join(',')}`)
  const specialistIds = COMMERCIAL_SPECIALISTS.map((node) => `${node.id}:${node.level}:${node.reportsTo ?? ''}:${node.division}:${node.businesses.join(',')}`)
  return JSON.stringify({
    leaderIds,
    specialistIds,
    divisions: getCommercialDivisions(),
    businesses: getCommercialBusinesses(),
    providers: PROVIDER_ORDER,
    toolNames: Object.keys(TOOL_REGISTRY).sort(),
  })
}

export function getCanonicalRuntimeManifest(forceRefresh = false): CanonicalRuntimeManifest {
  const now = Date.now()
  if (!forceRefresh && cached && now - cachedAt < CACHE_TTL_MS) return cached

  const runtimeStates = listCapabilityRuntimeStates()
  const counts = {
    healthyCount: runtimeStates.filter((state) => state.status === 'HEALTHY').length,
    degradedCount: runtimeStates.filter((state) => state.status === 'DEGRADED').length,
    unhealthyCount: runtimeStates.filter((state) => state.status === 'UNHEALTHY').length,
    unavailableCount: runtimeStates.filter((state) => state.status === 'UNAVAILABLE').length,
    unknownCount: runtimeStates.filter((state) => state.status === 'UNKNOWN').length,
  }
  const fingerprint = createHash('sha256').update(fingerprintInput()).digest('hex')
  const manifest: CanonicalRuntimeManifest = {
    manifestVersion: '1.0',
    generatedAt: new Date(now).toISOString(),
    organization: {
      leaderCount: COMMERCIAL_LEADERS.filter((node) => node.level === 'LEADER').length,
      specialistCount: COMMERCIAL_SPECIALISTS.length,
      divisionCount: getCommercialDivisions().length,
      businessCount: getCommercialBusinesses().length,
      leaderIds: COMMERCIAL_LEADERS.filter((node) => node.level === 'LEADER').map((node) => node.id),
      divisionNames: getCommercialDivisions(),
      businessKeys: getCommercialBusinesses(),
    },
    providers: { registeredCount: PROVIDER_ORDER.length, registeredIds: PROVIDER_ORDER },
    capabilities: {
      toolCount: Object.keys(TOOL_REGISTRY).length,
      runtimeStateCount: runtimeStates.length,
      ...counts,
    },
    fingerprint,
  }
  cached = manifest
  cachedAt = now
  return manifest
}

export function getCanonicalOrganizationPromptFromManifest(): string {
  const manifest = getCanonicalRuntimeManifest()
  return [
    `CANONICAL ORGANIZATION: ${manifest.organization.leaderCount} executive leaders, ${manifest.organization.specialistCount} specialists, ${manifest.organization.divisionCount} divisions, ${manifest.organization.businessCount} businesses.`,
    `LEADERS: ${manifest.organization.leaderIds.join('|')}.`,
    `DIVISIONS: ${manifest.organization.divisionNames.join(' | ')}.`,
    `BUSINESS SCOPE: ${manifest.organization.businessKeys.join(' | ')}.`,
    `SYSTEM PROVIDERS: ${manifest.providers.registeredCount}. TOOLS: ${manifest.capabilities.toolCount}.`,
    `RUNTIME MANIFEST FINGERPRINT: ${manifest.fingerprint}.`,
    'ORGANIZATIONAL TRUTH: hierarchy, reporting relationships, authority level, and business scope are derived from the canonical commercial organization graph. Do not invent or hardcode a different team structure.',
  ].join('\n')
}

export function invalidateCanonicalRuntimeManifest(): void {
  cached = null
  cachedAt = 0
}
