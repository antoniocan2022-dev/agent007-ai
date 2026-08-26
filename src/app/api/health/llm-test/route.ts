import { NextResponse } from 'next/server'
import { probeAllConfiguredProviders } from '@/lib/provider-runtime-v2'
import { PROVIDER_RUNTIME_CONFIG } from '@/lib/provider-control-plane'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const startedAt = Date.now()
  const probes = await probeAllConfiguredProviders('reasoning')
  const successful = probes.filter((probe) => probe.success)
  const configured = probes.filter((probe) => probe.configured)
  return NextResponse.json({
    ok: successful.length > 0,
    overallStatus: successful.length === 0 ? 'failed' : successful.length === configured.length ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    providers: probes.map((probe) => ({
      provider: probe.provider,
      label: PROVIDER_RUNTIME_CONFIG[probe.provider].label,
      status: probe.success ? 'pass' : 'fail',
      configured: probe.configured,
      model: probe.model,
      responseTimeMs: probe.responseMs,
      detail: probe.error ?? (probe.success ? `OK via ${probe.model}` : 'Provider probe failed'),
      states: probe.states,
    })),
  })
}
