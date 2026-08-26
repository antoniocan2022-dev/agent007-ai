import { NextResponse } from 'next/server'
import { PROVIDER_ORDER } from '@/lib/provider-control-plane'
import { isCircuitOpen } from '@/lib/provider-intelligence'
import { probeProvider, type ProviderRuntimeProbeResult } from '@/lib/provider-runtime-v2'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

const ACCEPTABLE_LATENCY_MS = 5000

export async function GET() {
  const checkedAt = new Date().toISOString()
  const attempted: Array<Pick<ProviderRuntimeProbeResult, 'provider' | 'configured' | 'success' | 'model' | 'responseMs' | 'error'>> = []

  for (const provider of PROVIDER_ORDER) {
    if (isCircuitOpen(provider)) {
      attempted.push({ provider, configured: true, success: false, model: null, responseMs: null, error: 'circuit breaker open' })
      continue
    }
    const result = await probeProvider(provider, { taskType: 'reasoning', verification: 'standard', timeoutMs: 10000, maxTokens: 128 })
    attempted.push({ provider, configured: result.configured, success: result.success, model: result.model, responseMs: result.responseMs, error: result.error })
    if (result.success && result.model && result.responseMs !== null && result.responseMs <= ACCEPTABLE_LATENCY_MS) {
      return NextResponse.json({
        ok: true,
        canary: 'ceo-reasoning',
        degraded: false,
        provider: result.provider,
        model: result.model,
        nonEmptyResponse: true,
        executionValidated: true,
        acceptableLatency: true,
        responseMs: result.responseMs,
        checkedAt,
        releaseCommit: process.env.RELEASE_COMMIT_SHA?.trim() || process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null,
        attempted,
      }, { status: 200, headers: { 'cache-control': 'no-store' } })
    }
  }

  return NextResponse.json({
    ok: false,
    canary: 'ceo-reasoning',
    degraded: true,
    executionValidated: false,
    nonEmptyResponse: false,
    acceptableLatency: false,
    checkedAt,
    releaseCommit: process.env.RELEASE_COMMIT_SHA?.trim() || process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null,
    attempted,
    error: 'No canonical reasoning provider produced an acceptable validated response.',
  }, { status: 503, headers: { 'cache-control': 'no-store' } })
}
