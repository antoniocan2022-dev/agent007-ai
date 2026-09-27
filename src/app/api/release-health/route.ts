import { NextRequest, NextResponse } from 'next/server'
import { runReleaseHealthCheck } from '@/lib/release-health-check'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Deep-audit fix: the full evidence chain (source->build->deployment->runtime->actualExecution->
// behavioralProbes->releaseAttestation) now lives in release-health-check.ts's runReleaseHealthCheck,
// shared with the CEO's own chat-callable toolVerifyReleaseHealth (agent007-meta.ts) -- this route is
// a thin HTTP wrapper over it, not a second copy of the same logic.
export async function GET(req: NextRequest) {
  const result = await runReleaseHealthCheck(req.headers.get('x-agent007-request-id'))

  console.info('[agent007-release-attestation]', JSON.stringify({ requestId: result.requestId, deploymentId: result.deploymentId, executedCommitSha: result.releaseAttestation.executedCommitSha, environment: result.environment, fingerprint: result.releaseAttestation.fingerprint, tripleProof: result.proof.tripleProof, actualExecutionVerified: result.actualExecution.verified, behavioralProbesVerified: result.behavioralProbes.verified }))

  return NextResponse.json(result, {
    status: result.releaseGate ? 200 : 503,
    headers: {
      'cache-control': 'no-store',
      'x-agent007-request-id': result.requestId,
      'x-agent007-release-commit': result.releaseCommit,
      'x-agent007-release-attestation': result.releaseAttestation.fingerprint,
    },
  })
}