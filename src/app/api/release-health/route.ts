import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { organizationGraphFingerprint } from '@/lib/organization-graph-fingerprint'
import { runGovernedProviderChat, type ProviderRuntimeResult } from '@/lib/provider-runtime-v2'
import { createReleaseAttestation, getReleaseIdentity, newReleaseRequestId, verifyReleaseTriplet } from '@/lib/release-attestation'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const GITHUB_MAIN_URL = 'https://api.github.com/repos/antoniocan2022-dev/agent007-ai/commits/main'

async function readGitHubMainSha(): Promise<{ sha: string | null; error?: string }> {
  try {
    const response = await fetch(GITHUB_MAIN_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Agent007-release-health' },
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    })
    if (!response.ok) return { sha: null, error: `GitHub main lookup HTTP ${response.status}` }
    const data = await response.json()
    return {
      sha: typeof data?.sha === 'string' ? data.sha : null,
      error: typeof data?.sha === 'string' ? undefined : 'GitHub main response contained no commit SHA',
    }
  } catch (error) {
    return { sha: null, error: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200) }
  }
}

async function verifyActualExecution(): Promise<{
  verified: boolean
  provider: string | null
  model: string | null
  responseMs: number | null
  error: string | null
}> {
  try {
    const result: ProviderRuntimeResult = await runGovernedProviderChat({
      messages: [
        { role: 'system', content: 'You are a production release health probe. Reply with exactly: OK' },
        { role: 'user', content: 'Say OK' },
      ],
      taskType: 'reasoning',
      verification: 'standard',
      temperature: 0,
      maxTokens: 64,
      timeoutMs: 5000,
      maxProviderAttempts: 2,
    })
    const verified = /^OK(?:\b|$)/i.test(result.content.trim())
    return {
      verified,
      provider: result.provider,
      model: result.model,
      responseMs: result.responseMs,
      error: verified ? null : `Unexpected provider canary response: ${result.content.trim().slice(0, 120)}`,
    }
  } catch (error) {
    return {
      verified: false,
      provider: null,
      model: null,
      responseMs: null,
      error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
    }
  }
}

export async function GET(req: NextRequest) {
  const requestId = newReleaseRequestId(req.headers.get('x-agent007-request-id') || randomUUID())
  const github = await readGitHubMainSha()
  const identity = getReleaseIdentity()
  const triplet = verifyReleaseTriplet({ githubMainSha: github.sha, identity })
  const actualExecution = await verifyActualExecution()
  const attestation = createReleaseAttestation(identity, requestId)
  const releaseGate = triplet.verified && actualExecution.verified && Boolean(identity.deploymentId)

  console.info('[agent007-release-attestation]', JSON.stringify({
    requestId,
    deploymentId: identity.deploymentId,
    executedCommitSha: identity.releaseCommitSha ?? identity.vercelCommitSha,
    environment: identity.environment,
    fingerprint: attestation.fingerprint,
    tripletVerified: triplet.verified,
    actualExecutionVerified: actualExecution.verified,
  }))

  return NextResponse.json(
    {
      ok: releaseGate,
      service: 'agent007',
      environment: identity.environment,
      requestId,
      releaseGate,
      deploymentId: identity.deploymentId ?? 'unknown',
      releaseCommit: identity.releaseCommitSha ?? 'unknown',
      organizationGraphFingerprint: organizationGraphFingerprint(),
      source: { system: 'github', mainSha: github.sha, verified: Boolean(github.sha), error: github.error ?? null },
      build: { system: 'vercel', deploymentId: identity.deploymentId, commitSha: identity.vercelCommitSha, verified: Boolean(identity.vercelCommitSha && identity.deploymentId) },
      deployment: { system: 'vercel-runtime', deploymentId: identity.deploymentId, commitSha: identity.vercelCommitSha, verified: Boolean(identity.vercelCommitSha && identity.deploymentId) },
      runtime: { system: 'release-health', deploymentId: identity.deploymentId, commitSha: identity.releaseCommitSha, verified: Boolean(identity.releaseCommitSha && identity.deploymentId) },
      actualExecution: {
        system: 'governed-provider-runtime',
        verified: actualExecution.verified,
        provider: actualExecution.provider,
        model: actualExecution.model,
        responseMs: actualExecution.responseMs,
        error: actualExecution.error,
        endpoint: '/api/agent',
      },
      releaseAttestation: attestation,
      evidenceHierarchy: ['source', 'build', 'deployment', 'runtime', 'actualExecution', 'releaseAttestation'],
      proof: {
        requestId,
        githubMainSha: github.sha,
        vercelDeploymentId: identity.deploymentId,
        vercelDeploymentSha: identity.vercelCommitSha,
        releaseHealthSha: identity.releaseCommitSha,
        tripletProof: triplet.verified,
        tripletFailureReason: triplet.reason,
        deploymentIdentityVerified: Boolean(identity.deploymentId && identity.vercelCommitSha),
        actualExecutionVerified: actualExecution.verified,
        runtimeAttestationVerified: Boolean(attestation.fingerprint && attestation.executedCommitSha),
        cspInterpretation: 'CSP whitelist is a browser policy signal, not provider health or execution proof.',
      },
    },
    { status: releaseGate ? 200 : 503, headers: { 'cache-control': 'no-store', 'x-agent007-request-id': requestId, 'x-agent007-release-commit': identity.releaseCommitSha ?? 'unknown', 'x-agent007-release-attestation': attestation.fingerprint } },
  )
}
