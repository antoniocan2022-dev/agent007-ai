import { NextResponse } from 'next/server'
import { getCanonicalProviderTelemetry } from '@/lib/canonical-llm-router'
import { probeAllConfiguredProviders } from '@/lib/provider-runtime-v2'
import { PROVIDER_ORDER } from '@/lib/provider-control-plane'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const startedAt = Date.now()
  const probes = await probeAllConfiguredProviders('reasoning')
  const telemetry = getCanonicalProviderTelemetry()
  const successful = probes.filter((probe) => probe.success)
  const configuredCount = probes.filter((probe) => probe.configured).length
  const availableCount = successful.length
  const overallStatus = availableCount === 0 ? 'failed' : availableCount === configuredCount ? 'healthy' : 'degraded'

  return NextResponse.json({
    ok: availableCount > 0,
    overallStatus,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    providerOrder: PROVIDER_ORDER,
    providerCount: probes.length,
    configuredCount,
    workingCount: availableCount,
    failedCount: Math.max(0, configuredCount - availableCount),
    providers: probes.map((probe) => {
      const runtime = telemetry.providers.find((item) => item.provider === probe.provider)
      return {
        provider: probe.provider,
        configured: probe.configured,
        working: probe.success,
        model: probe.model,
        responseMs: probe.responseMs,
        error: probe.error ?? null,
        telemetryStatus: runtime?.status ?? 'unavailable',
        telemetryHealthScore: runtime?.healthScore ?? 0,
        states: probe.states,
        catalogSource: probe.catalogSource ?? null,
        catalogModelCount: probe.catalogModelCount ?? null,
        governedCandidates: probe.governedCandidates ?? [],
      }
    }),
  }, { status: availableCount > 0 ? 200 : 503 })
}
