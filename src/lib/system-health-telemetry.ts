import { db } from './db'
import { RATE_LIMIT_INFO } from './agent'
import { getSystemManifest, type SystemManifest } from './system-manifest'

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
  release: SystemManifest
  checks: HealthCheck[]
}

async function timedCheck(component: string, fn: () => Promise<Record<string, unknown>>): Promise<HealthCheck> {
  const started = Date.now()
  try {
    const details = await fn()
    return { component, status: 'healthy', checkedAt: new Date().toISOString(), latencyMs: Date.now() - started, details }
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
  const release = getSystemManifest()
  const checks = await Promise.all([
    timedCheck('database', async () => {
      await db.$queryRaw`SELECT 1`
      return { reachable: true }
    }),
    timedCheck('llm-rate-limit', async () => ({
      retryingNow: RATE_LIMIT_INFO.retryingNow,
      last429At: RATE_LIMIT_INFO.last429At,
      state: RATE_LIMIT_INFO.retryingNow ? 'degraded' : 'healthy',
    })),
    timedCheck('proof-infrastructure', async () => ({
      executionReceipts: release.proof.executionReceipts,
      evidenceLedger: release.proof.evidenceLedger,
      verificationOfficer: release.proof.verificationOfficer,
    })),
    timedCheck('governance', async () => ({
      truthfulExecutionContract: release.governance.truthfulExecutionContract,
      ownerApprovalForProtectedActions: release.governance.ownerApprovalForProtectedActions,
    })),
  ])

  const failed = checks.some((check) => check.status === 'failed')
  const degraded = checks.some((check) => check.details.state === 'degraded')

  return {
    generatedAt: new Date().toISOString(),
    overall: failed ? 'failed' : degraded ? 'degraded' : 'healthy',
    release,
    checks,
  }
}
