import type { EvidenceBundle } from './ceo-evidence-bundle'
import type { ExternalEvidencePlan } from './ceo-evidence-planner'
import type { EvidenceTrace } from './ceo-evidence-trace'
import type { ResearchObjectiveIdentity } from './ceo-research-objective'

export interface CeoEvidenceCertificationReport {
  schemaVersion: 1
  certified: boolean
  checkedAt: number
  objective: Pick<ResearchObjectiveIdentity, 'id' | 'version' | 'domain' | 'evidenceProfile' | 'operation' | 'temporalScope' | 'tickers'>
  checks: {
    objectiveIdentityBound: boolean
    planIdentityBound: boolean
    traceIdentityBound: boolean
    externalEvidenceClass: boolean
    evidenceAcquired: boolean
    freshEvidencePresent: boolean
    entityCoverageSatisfied: boolean
  }
  metrics: {
    attemptedQueries: number
    successfulQueries: number
    pageReads: number
    sourceCount: number
    coveredEntities: string[]
    missingEntities: string[]
  }
  sourceHosts: string[]
  failureReasons: string[]
}

function hostsFromBundle(bundle: EvidenceBundle): string[] {
  return [...new Set(bundle.sources.map((source) => {
    try { return new URL(source.url).hostname } catch { return 'invalid-url' }
  }))].slice(0, 24)
}

export function certifyCeoEvidenceRun(input: {
  objective: ResearchObjectiveIdentity
  plan: ExternalEvidencePlan
  execution: {
    bundle: EvidenceBundle
    attemptedQueries: number
    successfulQueries: number
    pageReads: number
  }
  trace?: EvidenceTrace
}): CeoEvidenceCertificationReport {
  const { objective, plan, execution } = input
  const bundle = execution.bundle
  const coverage = bundle.entityCoverage ?? []
  const coveredEntities = coverage.filter((item) => item.sufficient).map((item) => item.entity)
  const missingEntities = objective.tickers.filter((ticker) => !coveredEntities.includes(ticker.toUpperCase()))
  const checkedAt = Date.now()
  const objectiveTickers = [...new Set(objective.tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))]
  const planTickers = [...new Set((plan.researchObjective?.tickers ?? []).map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))]
  const traceTickers = [...new Set((input.trace?.tickers ?? []).map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))]
  const sameEntitySet = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every((entity) => right.includes(entity))
  const objectiveIdentityBound = plan.researchObjective?.id === objective.id
    && plan.researchObjective.version === objective.version
    && plan.researchObjective.domain === objective.domain
    && plan.researchObjective.evidenceProfile === objective.evidenceProfile
    && plan.researchObjective.operation === objective.operation
    && plan.researchObjective.temporalScope === objective.temporalScope
  const planIdentityBound = Boolean(plan.researchObjective && sameEntitySet(planTickers, objectiveTickers))
  const traceIdentityBound = Boolean(input.trace && input.trace.objectiveId === objective.id && input.trace.objectiveVersion === objective.version && sameEntitySet(traceTickers, objectiveTickers))
  const externalEvidenceClass = plan.domain === 'public_equity' && plan.profile === 'public_equity' && plan.evidenceClass === 'external_web'
  const evidenceAcquired = execution.attemptedQueries > 0 && execution.successfulQueries > 0 && bundle.sources.length > 0
  const freshEvidencePresent = bundle.sources.some((source) => {
    const age = checkedAt - source.retrievedAt
    return age >= 0 && age <= bundle.freshness.maxAgeMs
  })
  const entityCoverageSatisfied = objective.tickers.every((ticker) => coverage.some((item) => item.entity === ticker.toUpperCase() && item.sufficient))
  const checks = { objectiveIdentityBound, planIdentityBound, traceIdentityBound, externalEvidenceClass, evidenceAcquired, freshEvidencePresent, entityCoverageSatisfied }
  const failureReasons = Object.entries(checks).filter(([, value]) => !value).map(([key]) => key)
  return {
    schemaVersion: 1,
    certified: Object.values(checks).every(Boolean),
    checkedAt,
    objective: {
      id: objective.id,
      version: objective.version,
      domain: objective.domain,
      evidenceProfile: objective.evidenceProfile,
      operation: objective.operation,
      temporalScope: objective.temporalScope,
      tickers: objective.tickers,
    },
    checks,
    metrics: {
      attemptedQueries: execution.attemptedQueries,
      successfulQueries: execution.successfulQueries,
      pageReads: execution.pageReads,
      sourceCount: bundle.sources.length,
      coveredEntities,
      missingEntities,
    },
    sourceHosts: hostsFromBundle(bundle),
    failureReasons,
  }
}
