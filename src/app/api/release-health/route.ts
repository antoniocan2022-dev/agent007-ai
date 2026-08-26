import { NextResponse } from 'next/server'
import { organizationGraphFingerprint } from '@/lib/organization-graph-fingerprint'

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

export async function GET() {
  const github = await readGitHubMainSha()
  const vercelCommitSha = process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null
  const releaseHealthSha = process.env.RELEASE_COMMIT_SHA?.trim() || vercelCommitSha
  const tripleProof = Boolean(github.sha && vercelCommitSha && releaseHealthSha && github.sha === vercelCommitSha && vercelCommitSha === releaseHealthSha)
  const environment = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown'

  return NextResponse.json(
    {
      ok: tripleProof,
      service: 'agent007',
      environment,
      releaseGate: tripleProof,
      releaseCommit: releaseHealthSha ?? 'unknown',
      organizationGraphFingerprint: organizationGraphFingerprint(),
      source: { system: 'github', mainSha: github.sha, verified: Boolean(github.sha), error: github.error ?? null },
      build: { system: 'vercel', commitSha: vercelCommitSha, verified: Boolean(vercelCommitSha) },
      deployment: { system: 'vercel-runtime', commitSha: vercelCommitSha, verified: Boolean(vercelCommitSha) },
      runtime: { system: 'release-health', commitSha: releaseHealthSha, verified: Boolean(releaseHealthSha) },
      actualExecution: { system: 'provider-canary', verified: false, endpoint: '/api/health/provider-canary' },
      evidenceHierarchy: ['source', 'build', 'deployment', 'runtime', 'actualExecution'],
      proof: {
        githubMainSha: github.sha,
        vercelDeploymentSha: vercelCommitSha,
        releaseHealthSha,
        tripleProof,
        cspInterpretation: 'CSP whitelist is a browser policy signal, not provider health or execution proof.',
      },
    },
    { status: tripleProof ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  )
}
