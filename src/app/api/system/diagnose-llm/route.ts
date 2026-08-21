import { NextResponse } from 'next/server'
import { runCanonicalLlm, getCanonicalProviderTelemetry } from '@/lib/canonical-llm-router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Live production probe for the complete canonical five-provider chain. */
export async function GET() {
  const telemetry = getCanonicalProviderTelemetry()
  const configured = telemetry.providers.filter((provider) => provider.configured)
  const activeChain = configured.map((provider) => provider.label)
  const diagnosis: any = {
    timestamp: new Date().toISOString(),
    provider: activeChain.length > 0 ? `Canonical governed chain: ${activeChain.join(' → ')}` : 'No canonical providers configured',
    providers: telemetry.providers.map((provider) => ({ provider: provider.provider, configured: provider.configured, status: provider.status, healthScore: provider.healthScore, circuitOpen: provider.circuitOpen, model: provider.model })),
    configuredCount: telemetry.configuredCount,
    healthyCount: telemetry.healthyCount,
    availableCount: telemetry.availableCount,
    testResult: null,
    error: null,
  }

  if (configured.length === 0) {
    diagnosis.overallStatus = '❌ FAILED'
    diagnosis.testResult = { success: false, status: 'NO_CONFIGURED_PROVIDER' }
    diagnosis.error = 'No canonical LLM provider is configured.'
    return NextResponse.json(diagnosis, { status: 503 })
  }

  try {
    const result = await runCanonicalLlm({
      executionClass: 'standard',
      taskType: 'operations',
      messages: [
        { role: 'system', content: 'You are a production health probe. Reply with exactly: OK' },
        { role: 'user', content: 'Say OK' },
      ],
      maxTokens: 16,
      timeoutMs: 10000,
      maxProviderAttempts: configured.length,
      thinking: false,
    })
    diagnosis.testResult = { success: true, provider: result.provider, model: result.model, response: result.content.slice(0, 20), attempts: result.attempts, responseMs: result.responseMs, executionClass: result.executionClass }
    diagnosis.overallStatus = '✅ WORKING'
    diagnosis.message = `Canonical AI runtime is working through ${result.provider} (${result.model}).`
    return NextResponse.json(diagnosis, { status: 200 })
  } catch (error: any) {
    const rawError = error?.message ?? String(error)
    diagnosis.testResult = { success: false, rawError: rawError.slice(0, 500) }
    diagnosis.error = rawError.slice(0, 500)
    diagnosis.overallStatus = '❌ FAILED'
    diagnosis.message = 'All currently eligible canonical providers failed the production health probe.'
    return NextResponse.json(diagnosis, { status: 503 })
  }
}
