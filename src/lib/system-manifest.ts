import { TOOL_REGISTRY } from './tools'
import { SUBAGENTS } from './subagents'

export const SYSTEM_MANIFEST_VERSION = 1
export const SYSTEM_MANIFEST_ID = 'agent007-system'

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
    customSpecialistCount: number | null
  }
  capabilities: {
    toolCount: number
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

export function getSystemManifest(): SystemManifest {
  const environment = process.env.VERCEL_ENV || process.env.NODE_ENV || 'development'
  const deploymentTarget: SystemManifest['infrastructure']['deploymentTarget'] =
    environment === 'production' ? 'production' : environment === 'preview' ? 'preview' : 'development'

  return {
    manifestId: SYSTEM_MANIFEST_ID,
    manifestVersion: SYSTEM_MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    releaseCommit: process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || null,
    environment,
    framework: 'nextjs',
    runtime: process.version,
    infrastructure: {
      database: 'postgresql',
      hosting: 'vercel',
      deploymentTarget,
    },
    organization: {
      specialistCount: SUBAGENTS.length,
      builtInSpecialistCount: SUBAGENTS.filter((agent) => agent.isBuiltin !== false).length,
      customSpecialistCount: null,
    },
    capabilities: {
      toolCount: Object.keys(TOOL_REGISTRY).length,
    },
    proof: {
      executionReceipts: true,
      evidenceLedger: true,
      verificationOfficer: true,
    },
    governance: {
      truthfulExecutionContract: true,
      ownerApprovalForProtectedActions: true,
    },
  }
}
