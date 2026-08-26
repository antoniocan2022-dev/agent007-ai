import { probeAllConfiguredProviders } from '@/lib/provider-runtime-v2'
import { PROVIDER_ORDER, PROVIDER_RUNTIME_CONFIG } from '@/lib/provider-control-plane'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const probes = await probeAllConfiguredProviders('reasoning')
  const configured = probes.filter((probe) => probe.configured)
  const healthy = probes.filter((probe) => probe.success)
  return Response.json({
    ok: healthy.length > 0,
    timestamp: new Date().toISOString(),
    region: process.env.VERCEL_REGION || 'unknown',
    runtime: process.env.VERCEL || process.env.NOW ? 'vercel-serverless' : 'local',
    providerOrder: PROVIDER_ORDER,
    activeChain: configured.map((probe) => probe.provider),
    providers: probes.map((probe) => ({
      id: probe.provider,
      name: PROVIDER_RUNTIME_CONFIG[probe.provider].label,
      envVar: PROVIDER_RUNTIME_CONFIG[probe.provider].apiKeyEnv,
      configured: probe.configured,
      model: probe.model || PROVIDER_RUNTIME_CONFIG[probe.provider].defaultModel,
      working: probe.success,
      responseTimeMs: probe.responseMs,
      error: probe.error ?? null,
      states: probe.states,
    })),
    summary: {
      totalProviders: probes.length,
      configuredCount: configured.length,
      workingCount: healthy.length,
      degraded: healthy.length > 0 && healthy.length < configured.length,
      willAnythingWork: healthy.length > 0,
    },
  })
}
