import { timingSafeEqual, randomUUID } from 'node:crypto'
import { buildExternalEvidencePlan } from '@/lib/ceo-evidence-planner'
import { executeExternalEvidencePlan } from '@/lib/ceo-evidence-executor'
import { startEvidenceTrace, addEvidenceTraceEvent, completeEvidenceTrace } from '@/lib/ceo-evidence-trace'
import { certifyCeoEvidenceRun } from '@/lib/ceo-evidence-certification'
import type { ResearchObjectiveIdentity } from '@/lib/ceo-research-objective'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export const maxDuration = 60

function tokenMatches(received: string | null, expected: string): boolean {
  if (!received) return false
  const left = Buffer.from(received)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

function buildCertificationObjective(tickers: string[]): ResearchObjectiveIdentity {
  const id = `live-cert-${randomUUID()}`
  const normalized = [...new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter((ticker) => /^[A-Z]{1,5}$/.test(ticker)))].slice(0, 4)
  return {
    id,
    version: 1,
    status: 'active',
    lifecycleState: 'ESTABLISHED',
    domain: 'public_equity',
    evidenceProfile: 'public_equity',
    operation: 'research',
    temporalScope: 'current',
    objectiveAnchor: `Live external evidence certification for ${normalized.join(', ')}`,
    currentObjective: `Live external evidence certification for ${normalized.join(', ')}`,
    tickers: normalized,
    issuers: [],
  }
}

export async function GET(request: Request) {
  const expected = process.env.AGENT007_EVIDENCE_CERTIFICATION_TOKEN?.trim()
  if (!expected) return Response.json({ ok: false, error: 'Certification endpoint is disabled.' }, { status: 404 })
  if (!tokenMatches(request.headers.get('x-agent007-cert-token'), expected)) return Response.json({ ok: false, error: 'Unauthorized.' }, { status: 401 })

  const url = new URL(request.url)
  const rawTickers = (url.searchParams.get('tickers') ?? 'GEOS,MIND').split(',').map((value) => value.trim().toUpperCase()).filter((value) => /^[A-Z]{1,5}$/.test(value)).slice(0, 4)
  const tickers = [...new Set(rawTickers)]
  if (!tickers.length) return Response.json({ ok: false, error: 'Provide at least one valid ticker.' }, { status: 400 })

  const objective = buildCertificationObjective(tickers)
  const trace = startEvidenceTrace({
    objective: objective.currentObjective,
    profile: objective.evidenceProfile,
    requestId: objective.id,
    objectiveId: objective.id,
    objectiveVersion: objective.version,
    tickers: objective.tickers,
  })
  addEvidenceTraceEvent(trace, 'planned', { objectiveId: objective.id, objectiveVersion: objective.version, tickers: objective.tickers })

  try {
    const plan = buildExternalEvidencePlan({
      objective: objective.currentObjective,
      evidenceClass: 'external_web',
      domain: 'public_equity',
      operation: 'research',
      temporalScope: 'current',
      evidenceProfile: 'public_equity',
      researchObjective: objective,
    })
    addEvidenceTraceEvent(trace, 'search_started', { queryCount: plan.queries.length, maxSearchQueries: plan.maxSearchQueries })
    const execution = await executeExternalEvidencePlan(plan, request.signal)
    const finalState = execution.bundle.sufficient ? 'FULL' : execution.bundle.sources.length ? 'PARTIAL' : 'ABSTAIN'
    addEvidenceTraceEvent(trace, 'gate_evaluated', {
      objectiveId: objective.id,
      objectiveVersion: objective.version,
      attemptedQueries: execution.attemptedQueries,
      successfulQueries: execution.successfulQueries,
      sourceCount: execution.bundle.sources.length,
      entityCoverage: execution.bundle.entityCoverage,
      bundleSufficient: execution.bundle.sufficient,
    })
    const completedTrace = completeEvidenceTrace(trace, finalState)
    const report = certifyCeoEvidenceRun({ objective, plan, execution, trace: completedTrace })
    return Response.json({
      ok: report.certified,
      certification: report,
      trace: {
        traceId: completedTrace.traceId,
        objectiveId: completedTrace.objectiveId,
        objectiveVersion: completedTrace.objectiveVersion,
        tickers: completedTrace.tickers,
        finalState: completedTrace.finalState,
        eventCount: completedTrace.events.length,
      },
      releaseCommit: process.env.RELEASE_COMMIT_SHA?.trim() || process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null,
    }, { status: report.certified ? 200 : 503, headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    addEvidenceTraceEvent(trace, 'abstained', { error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300) })
    const completedTrace = completeEvidenceTrace(trace, 'ABSTAIN')
    return Response.json({
      ok: false,
      error: 'External evidence certification failed.',
      detail: process.env.NODE_ENV === 'production' ? undefined : error instanceof Error ? error.message : String(error),
      trace: { traceId: completedTrace.traceId, objectiveId: completedTrace.objectiveId, objectiveVersion: completedTrace.objectiveVersion, tickers: completedTrace.tickers, finalState: completedTrace.finalState },
      releaseCommit: process.env.RELEASE_COMMIT_SHA?.trim() || process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null,
    }, { status: 503, headers: { 'cache-control': 'no-store' } })
  }
}
