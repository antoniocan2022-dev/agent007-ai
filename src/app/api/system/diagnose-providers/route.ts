import { NextResponse } from 'next/server'
import { getCanonicalProviderTelemetry } from '@/lib/canonical-llm-router'
import { probeAllConfiguredProviders } from '@/lib/provider-runtime-v2'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Production-safe provider verification endpoint.
 * It never returns API keys and probes each configured governed provider
 * independently, so one working fallback cannot hide another provider failure.
 */
export async function GET() {
  const startedAt = Date.now()
  const probes = await probeAllConfiguredProviders()
  const telemetry = getCanonicalProviderTelemetry()
  const successful = probes.filter((probe) => probe.success)
  const configured = probes.filter((probe) => probe.configured)

  return NextResponse.json({
    ok: successful.length === configured.length && configured.length > 0,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    providerCount: probes.length,
    configuredCount: configured.length,
    workingCount: successful.length,
    failedCount: configured.length - successful.length,
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
      }
    }),
  }, { status: configured.length > 0 && successful.length === configured.length ? 200 : 503 })
}
