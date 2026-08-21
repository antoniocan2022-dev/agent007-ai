import { TOOL_REGISTRY } from './tools'
import { SUBAGENTS, getAllSubagents } from './subagents'
import type { ProviderId } from './subagent-governance'
import { getCanonicalProviderTelemetry } from './canonical-llm-router'

export const SYSTEM_MANIFEST_VERSION = 4
export const SYSTEM_MANIFEST_ID = 'agent007-system'

const CANONICAL_PROVIDER_COUNT: Record<Exclude<ProviderId, 'openai'>, true> = {
  groq: true,
  zai: true,
  mistral: true,
  gemini: true,
  cerebras: true,
}

export type SystemManifest = {
  manifestId: string
  manifestVersion: number
  generatedAt: string
  releaseCommit: string | null
  environment: string
  framework: 'nextjs'
  runtime: string
  infrastructure: {
    database: 'postgresql'
    hosting: 'vercel'
    deploymentTarget: 'production' | 'preview' | 'development'
  }
  organization: {
    specialistCount: number
    builtInSpecialistCount: number
    customSpecialistCount: number
    enabledSpecialistCount: number
    disabledSpecialistCount: number
  }
  capabilities: {
    toolCount: number
    providerCount: number
    configuredProviderCount: number
    healthyProviderCount: number
    availableProviderCount: number
  }
  adaptiveExecution: {
    enabled: true
    classes: readonly ['fast', 'standard', 'deep', 'mission']
    parallelPlanning: true
    governedProviderFallback: true
  }
  proof: {
    executionReceipts: true
    evidenceLedger: true
    verificationOfficer: true
  }
  governance: {
    truthfulExecutionContract: true
    ownerApprovalForProtectedActions: true
  }
}

function baseManifest(): SystemManifest {
  const environment = process.env.VERCEL_ENV || process.env.NODE_ENV || 'development'
  const deploymentTarget: SystemManifest['infrastructure']['deploymentTarget'] =
    environment === 'production' ? 'production' : environment === 'preview' ? 'preview' : 'development'
  const providerTelemetry = getCanonicalProviderTelemetry()
  return {
    manifestId: SYSTEM_MANIFEST_ID,
    manifestVersion: SYSTEM_MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    releaseCommit: process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || null,
    environment,
    framework: 'nextjs',
    runtime: process.version,
    infrastructure: { database: 'postgresql', hosting: 'vercel', deploymentTarget },
    organization: {
      specialistCount: SUBAGENTS.length,
      builtInSpecialistCount: SUBAGENTS.filter((agent) => agent.isBuiltin !== false).length,
      customSpecialistCount: 0,
      enabledSpecialistCount: SUBAGENTS.filter((agent) => agent.enabled !== false).length,
      disabledSpecialistCount: SUBAGENTS.filter((agent) => agent.enabled === false).length,
    },
    capabilities: {
      toolCount: Object.keys(TOOL_REGISTRY).length,
      providerCount: Object.keys(CANONICAL_PROVIDER_COUNT).length,
      configuredProviderCount: providerTelemetry.configuredCount,
      healthyProviderCount: providerTelemetry.healthyCount,
      availableProviderCount: providerTelemetry.availableCount,
    },
    adaptiveExecution: {
      enabled: true,
      classes: ['fast', 'standard', 'deep', 'mission'],
      parallelPlanning: true,
      governedProviderFallback: true,
    },
    proof: { executionReceipts: true, evidenceLedger: true, verificationOfficer: true },
    governance: { truthfulExecutionContract: true, ownerApprovalForProtectedActions: true },
  }
}

export function getSystemManifest(): SystemManifest {
  return baseManifest()
}

/** Resolve DB overlays/custom agents so the manifest represents the effective runtime organization. */
export async function getLiveSystemManifest(): Promise<SystemManifest> {
  const manifest = baseManifest()
  try {
    const effective = await getAllSubagents({ includeDisabled: true })
    const builtInCount = effective.filter((agent) => agent.isBuiltin !== false).length
    const customCount = effective.filter((agent) => agent.isBuiltin === false).length
    manifest.organization = {
      specialistCount: effective.length,
      builtInSpecialistCount: builtInCount,
      customSpecialistCount: customCount,
      enabledSpecialistCount: effective.filter((agent) => agent.enabled !== false).length,
      disabledSpecialistCount: effective.filter((agent) => agent.enabled === false).length,
    }
  } catch {
    // Fail closed to canonical code-defined inventory rather than inventing DB state.
  }
  return { ...manifest, generatedAt: new Date().toISOString() }
}
