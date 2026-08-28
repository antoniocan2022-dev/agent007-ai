import { NextResponse } from 'next/server'
import { organizationGraphFingerprint } from '@/lib/organization-graph-fingerprint'
import { runGovernedProviderChat, type ProviderRuntimeResult } from '@/lib/provider-runtime-v2'

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
    return { sha: typeof data?.sha === 'string' ? data.sha : null, error: typeof data?.sha === 'string' ? undefined : 'GitHub main response contained no commit SHA' }
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

export async function GET() {
  const github = await readGitHubMainSha()
  const vercelCommitSha = process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null
  const releaseHealthSha = process.env.RELEASE_COMMIT_SHA?.trim() || vercelCommitSha
  const tripleProof = Boolean(github.sha && vercelCommitSha && releaseHealthSha && github.sha === vercelCommitSha && vercelCommitSha === releaseHealthSha)
  const environment = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown'
  const actualExecution = await verifyActualExecution()
  const releaseGate = tripleProof && actualExecution.verified

  return NextResponse.json(
    {
      ok: releaseGate,
      service: 'agent007',
      environment,
      releaseGate,
      releaseCommit: releaseHealthSha ?? 'unknown',
      organizationGraphFingerprint: organizationGraphFingerprint(),
      source: { system: 'github', mainSha: github.sha, verified: Boolean(github.sha), error: github.error ?? null },
      build: { system: 'vercel', commitSha: vercelCommitSha, verified: Boolean(vercelCommitSha) },
      deployment: { system: 'vercel-runtime', commitSha: vercelCommitSha, verified: Boolean(vercelCommitSha) },
      runtime: { system: 'release-health', commitSha: releaseHealthSha, verified: Boolean(releaseHealthSha) },
      actualExecution: {
        system: 'governed-provider-runtime',
        verified: actualExecution.verified,
        provider: actualExecution.provider,
        model: actualExecution.model,
        responseMs: actualExecution.responseMs,
        error: actualExecution.error,
        endpoint: '/api/agent',
      },
      evidenceHierarchy: ['source', 'build', 'deployment', 'runtime', 'actualExecution'],
      proof: {
        githubMainSha: github.sha,
        vercelDeploymentSha: vercelCommitSha,
        releaseHealthSha,
        tripleProof,
        actualExecutionVerified: actualExecution.verified,
        cspInterpretation: 'CSP whitelist is a browser policy signal, not provider health or execution proof.',
      },
    },
    { status: releaseGate ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  )
}