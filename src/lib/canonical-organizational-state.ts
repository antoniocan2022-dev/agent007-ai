import { TOOL_REGISTRY } from './tools'
import { getAllGovernanceProfiles } from './subagent-governance'
import { CORE_PROVIDER_PRIORITY, SECONDARY_PROVIDER_PRIORITY, PROVIDER_PRIORITY, PROVIDER_PARALLEL_LIMIT } from './provider-intelligence-policy'
import { PROVIDER_RUNTIME_CONFIG, getConfiguredProviders } from './provider-runtime-v2'

export const CANONICAL_STATE_VERSION = '2.0.0'
export const CRON_POLICY = Object.freeze({ enabled: false, schedules: [] as readonly string[], reason: 'Production cron execution is disabled until explicit owner authorization.' })
export const RELEASE_POLICY = Object.freeze({ productionDeployment: 'manual-authorization-only' as const, automaticDeployments: false })

export function getCanonicalOrganizationalState() {
  const profiles = getAllGovernanceProfiles()
  return {
    stateVersion: CANONICAL_STATE_VERSION,
    generatedAt: new Date().toISOString(),
    organization: { name: 'Agent007 AI', executive: 'CEO_AGENT007', director: 'VID Director' },
    agents: { totalGovernedProfiles: profiles.length, ids: profiles.map((p) => p.id).sort() },
    tools: { registryCount: Object.keys(TOOL_REGISTRY).length },
    providers: {
      defaultPriority: PROVIDER_PRIORITY,
      corePriority: CORE_PROVIDER_PRIORITY,
      secondaryPriority: SECONDARY_PROVIDER_PRIORITY,
      configured: getConfiguredProviders(),
      parallelLimit: PROVIDER_PARALLEL_LIMIT,
      runtime: Object.fromEntries(Object.entries(PROVIDER_RUNTIME_CONFIG).map(([id, config]) => [id, { label: config.label, capabilities: [], canParallel: true }])),
    },
    cronPolicy: CRON_POLICY,
    releasePolicy: RELEASE_POLICY,
    coherence: { singleSourceOfTruth: true as const, capabilityAccessModel: 'governed-per-agent' as const },
  }
}

export function validateCanonicalOrganizationalState(state = getCanonicalOrganizationalState()): string[] {
  const errors: string[] = []
  const expected = [...CORE_PROVIDER_PRIORITY, ...SECONDARY_PROVIDER_PRIORITY]
  if (state.providers.defaultPriority.join('|') !== expected.join('|')) errors.push('Provider priority drift detected')
  if (new Set(state.providers.defaultPriority).size !== state.providers.defaultPriority.length) errors.push('Provider priority contains duplicates')
  if (state.agents.totalGovernedProfiles !== state.agents.ids.length) errors.push('Agent profile count mismatch')
  if (state.cronPolicy.enabled) errors.push('Canonical cron policy is unexpectedly enabled')
  if (state.releasePolicy.automaticDeployments) errors.push('Automatic production deployment is unexpectedly enabled')
  if (state.providers.parallelLimit < 2) errors.push('Parallel provider limit must be at least 2')
  return errors
}
