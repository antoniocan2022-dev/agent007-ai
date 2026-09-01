import { createHash, randomUUID } from 'node:crypto'

export interface ReleaseIdentity {
  deploymentId: string | null
  vercelCommitSha: string | null
  releaseCommitSha: string | null
  environment: string
}

export interface ReleaseAttestation {
  schemaVersion: 1
  requestId: string
  deploymentId: string | null
  executedCommitSha: string | null
  environment: string
  fingerprint: string
}

export function getReleaseIdentity(): ReleaseIdentity {
  const vercelCommitSha = process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null
  return {
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID?.trim() || null,
    vercelCommitSha,
    releaseCommitSha: process.env.RELEASE_COMMIT_SHA?.trim() || vercelCommitSha,
    environment: process.env.VERCEL_ENV?.trim() || process.env.NODE_ENV || 'unknown',
  }
}

export function newReleaseRequestId(candidate?: string | null): string {
  const value = candidate?.trim()
  return value && value.length <= 120 ? value : randomUUID()
}

export function createReleaseAttestation(identity: ReleaseIdentity, requestId: string): ReleaseAttestation {
  const executedCommitSha = identity.releaseCommitSha ?? identity.vercelCommitSha
  const material = [identity.deploymentId ?? 'unknown', executedCommitSha ?? 'unknown', identity.environment, requestId].join(':')
  const fingerprint = createHash('sha256').update(`agent007-release-attestation:v1:${material}`).digest('hex')
  return {
    schemaVersion: 1,
    requestId,
    deploymentId: identity.deploymentId,
    executedCommitSha,
    environment: identity.environment,
    fingerprint,
  }
}

export function verifyReleaseTriplet(input: {
  githubMainSha: string | null
  identity: ReleaseIdentity
}): { verified: boolean; reason: string | null } {
  const { githubMainSha, identity } = input
  if (!githubMainSha || !identity.vercelCommitSha || !identity.releaseCommitSha) return { verified: false, reason: 'One or more release SHAs are unavailable.' }
  if (githubMainSha !== identity.vercelCommitSha) return { verified: false, reason: 'GitHub main SHA differs from the Vercel deployment SHA.' }
  if (identity.vercelCommitSha !== identity.releaseCommitSha) return { verified: false, reason: 'Vercel deployment SHA differs from the runtime release SHA.' }
  return { verified: true, reason: null }
}
