import { db } from './db'
import { getLiveSystemManifest } from './system-manifest'
import { getCanonicalProviderTelemetry } from './canonical-llm-router'

export type HealthStatus = 'healthy' | 'degraded' | 'failed'

export type HealthCheck = {
  component: string
  status: HealthStatus
  checkedAt: string
  latencyMs: number
  details: Record<string, unknown>
}

export type SystemHealthReport = {
  generatedAt: string
  overall: HealthStatus
  release: Awaited<ReturnType<typeof getLiveSystemManifest>>
  checks: HealthCheck[]
}

async function timedCheck(component: string, fn: () => Promise<Record<string, unknown>>): Promise<HealthCheck> {
  const started = Date.now()
  try {
    const details = await fn()
    const status = details.state === 'failed' ? 'failed' : details.state === 'degraded' ? 'degraded' : 'healthy'
    return { component, status, checkedAt: new Date().toISOString(), latencyMs: Date.now() - started, details }
  } catch (error) {
    return {
      component,
      status: 'failed',
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      details: { error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300) },
    }
  }
}

export async function getLiveSystemHealth(): Promise<SystemHealthReport> {
  const release = await getLiveSystemManifest()
  const providerTelemetry = getCanonicalProviderTelemetry()
  const checks = await Promise.all([
    timedCheck('database', async () => {
      await db.$queryRaw`SELECT 1`
      return { reachable: true, state: 'healthy' }
    }),
    timedCheck('providers', async () => {
      if (providerTelemetry.configuredCount === 0) return { state: 'failed', configured: 0, healthy: 0, providers: providerTelemetry.providers }
      if (providerTelemetry.healthyCount === 0) return { state: 'degraded', ...providerTelemetry }
      return { state: providerTelemetry.healthyCount < providerTelemetry.configuredCount ? 'degraded' : 'healthy', ...providerTelemetry }
    }),
    timedCheck('proof-infrastructure', async () => ({
      state: 'healthy',
      executionReceipts: release.proof.executionReceipts,
      evidenceLedger: release.proof.evidenceLedger,
      verificationOfficer: release.proof.verificationOfficer,
    })),
    timedCheck('governance', async () => ({
      state: 'healthy',
      truthfulExecutionContract: release.governance.truthfulExecutionContract,
      ownerApprovalForProtectedActions: release.governance.ownerApprovalForProtectedActions,
    })),
    timedCheck('manifest', async () => ({
      state: 'healthy',
      manifestVersion: release.manifestVersion,
      releaseCommit: release.releaseCommit,
      effectiveSpecialists: release.organization.specialistCount,
      configuredProviders: release.capabilities.configuredProviderCount,
      healthyProviders: release.capabilities.healthyProviderCount,
    })),
  ])

  const failed = checks.some((check) => check.status === 'failed')
  const degraded = checks.some((check) => check.status === 'degraded')

  return {
    generatedAt: new Date().toISOString(),
    overall: failed ? 'failed' : degraded ? 'degraded' : 'healthy',
    release,
    checks,
  }
}
