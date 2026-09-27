import { randomUUID } from 'node:crypto'
import { organizationGraphFingerprint } from './organization-graph-fingerprint'
import { runGovernedProviderChat, type ProviderRuntimeResult } from './provider-runtime-v2'
import { createReleaseAttestation, getReleaseIdentity, newReleaseRequestId, verifyReleaseTriplet, type ReleaseAttestation, type ReleaseIdentity } from './release-attestation'
import { verifyBehavioralProbes, type BehavioralProbeResult } from './release-health-probes'

// Deep-audit fix: the full source->build->deployment->runtime->actualExecution->behavioralProbes->
// releaseAttestation evidence chain previously lived only inline in /api/release-health's GET handler,
// so nothing else -- in particular, the CEO's own self_verify_integrity tool, which only ever checks
// data/config (tool registry, memory, sub-agents, schedules, communication) -- could invoke this same
// deep infrastructure verification from inside a chat turn. Extracted here as one shared function so
// the HTTP route and the new toolVerifyReleaseHealth call the exact same logic, not two independently-
// maintained copies of the same evidence chain.

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
    return { verified, provider: result.provider, model: result.model, responseMs: result.responseMs, error: verified ? null : `Unexpected provider canary response: ${result.content.trim().slice(0, 120)}` }
  } catch (error) {
    return { verified: false, provider: null, model: null, responseMs: null, error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300) }
  }
}

export interface ReleaseHealthResult {
  ok: boolean
  service: 'agent007'
  environment: string
  requestId: string
  releaseGate: boolean
  deploymentId: string
  releaseCommit: string
  organizationGraphFingerprint: string
  source: { system: 'github'; mainSha: string | null; verified: boolean; error: string | null }
  build: { system: 'vercel'; deploymentId: string | null; commitSha: string | null; verified: boolean }
  deployment: { system: 'vercel-runtime'; deploymentId: string | null; commitSha: string | null; verified: boolean }
  runtime: { system: 'release-health'; deploymentId: string | null; commitSha: string | null; verified: boolean }
  actualExecution: { system: 'governed-provider-runtime'; verified: boolean; provider: string | null; model: string | null; responseMs: number | null; error: string | null; endpoint: '/api/release-health'; probeType: 'in-process-provider-canary' }
  behavioralProbes: { system: 'ceo-fixed-behavior-probes'; verified: boolean; probes: readonly BehavioralProbeResult[] }
  releaseAttestation: ReleaseAttestation
  evidenceHierarchy: readonly string[]
  proof: {
    requestId: string
    githubMainSha: string | null
    vercelDeploymentId: string | null
    vercelDeploymentSha: string | null
    releaseHealthSha: string | null
    tripleProof: boolean
    tripletProof: boolean
    tripletFailureReason: string | null
    deploymentIdentityVerified: boolean
    actualExecutionVerified: boolean
    behavioralProbesVerified: boolean
    runtimeAttestationVerified: boolean
    cspInterpretation: string
  }
}

/**
 * Runs the full production release-verification chain and returns its result. The single source of
 * truth for both /api/release-health (the HTTP route external monitors poll) and
 * toolVerifyReleaseHealth (the chat-callable tool this exists to back) -- neither re-implements any
 * part of this evidence chain independently.
 */
export async function runReleaseHealthCheck(requestIdCandidate?: string | null): Promise<ReleaseHealthResult> {
  const requestId = newReleaseRequestId(requestIdCandidate ?? randomUUID())
  const github = await readGitHubMainSha()
  const identity: ReleaseIdentity = getReleaseIdentity()
  const triplet = verifyReleaseTriplet({ githubMainSha: github.sha, identity })
  const actualExecution = await verifyActualExecution()
  const behavioralProbes = verifyBehavioralProbes()
  const attestation = createReleaseAttestation(identity, requestId)
  const releaseGate = triplet.verified && actualExecution.verified && behavioralProbes.verified && Boolean(identity.deploymentId)
  const tripleProof = triplet.verified

  return {
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
    actualExecution: { system: 'governed-provider-runtime', verified: actualExecution.verified, provider: actualExecution.provider, model: actualExecution.model, responseMs: actualExecution.responseMs, error: actualExecution.error, endpoint: '/api/release-health', probeType: 'in-process-provider-canary' },
    behavioralProbes: { system: 'ceo-fixed-behavior-probes', verified: behavioralProbes.verified, probes: behavioralProbes.probes },
    releaseAttestation: attestation,
    evidenceHierarchy: ['source', 'build', 'deployment', 'runtime', 'actualExecution', 'behavioralProbes', 'releaseAttestation'],
    proof: {
      requestId,
      githubMainSha: github.sha,
      vercelDeploymentId: identity.deploymentId,
      vercelDeploymentSha: identity.vercelCommitSha,
      releaseHealthSha: identity.releaseCommitSha,
      tripleProof,
      tripletProof: tripleProof,
      tripletFailureReason: triplet.reason,
      deploymentIdentityVerified: Boolean(identity.deploymentId && identity.vercelCommitSha),
      actualExecutionVerified: actualExecution.verified,
      behavioralProbesVerified: behavioralProbes.verified,
      runtimeAttestationVerified: Boolean(attestation.fingerprint && attestation.executedCommitSha),
      cspInterpretation: 'CSP whitelist is a browser policy signal, not provider health or execution proof.',
    },
  }
}
