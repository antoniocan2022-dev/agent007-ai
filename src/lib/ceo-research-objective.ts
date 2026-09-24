import { db } from './db'
import type { EvidenceDomain, EvidenceOperation, EvidenceProfile, TemporalScope, PreRouteDecision } from './ceo-cognitive-contract'

export const RESEARCH_OBJECTIVE_LIFECYCLES = ['ESTABLISHED', 'REFINED', 'CONTINUED', 'CORRECTED', 'RESOLVED', 'SUPERSEDED', 'ABANDONED'] as const
export type ResearchObjectiveLifecycleState = (typeof RESEARCH_OBJECTIVE_LIFECYCLES)[number]
export type ResearchObjectiveStatus = 'active' | 'resolved' | 'superseded' | 'abandoned'

export interface ResearchObjectiveIdentity {
  id: string
  version: number
  status: ResearchObjectiveStatus
  lifecycleState: ResearchObjectiveLifecycleState
  domain: EvidenceDomain
  evidenceProfile: EvidenceProfile
  operation: EvidenceOperation
  temporalScope: TemporalScope
  objectiveAnchor: string
  currentObjective: string
  tickers: string[]
  issuers: string[]
}

export interface ResearchObjectiveCandidate {
  domain: EvidenceDomain
  evidenceProfile: EvidenceProfile
  operation: EvidenceOperation
  temporalScope: TemporalScope
  objectiveAnchor: string
  currentObjective: string
  tickers: string[]
  issuers?: string[]
}

function normalize(value: string): string { return value.replace(/[ \t]+/g, ' ').replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{3,}/g, '\n\n').trim() }
function unique(values: readonly string[], max = 8): string[] { return [...new Set(values.map((value) => normalize(value).toUpperCase()).filter(Boolean))].slice(0, max) }
function safeJsonArray(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 16) : []
  } catch { return [] }
}
function lifecycle(value: string): ResearchObjectiveLifecycleState {
  return (RESEARCH_OBJECTIVE_LIFECYCLES as readonly string[]).includes(value) ? value as ResearchObjectiveLifecycleState : 'ESTABLISHED'
}
function status(value: string): ResearchObjectiveStatus {
  return value === 'resolved' || value === 'superseded' || value === 'abandoned' ? value : 'active'
}
function rowToIdentity(row: {
  id: string
  version: number
  status: string
  lifecycleState: string
  domain: string
  evidenceProfile: string
  operation: string
  temporalScope: string
  objectiveAnchor: string
  currentObjective: string
  tickersJson: string
  issuersJson: string
}): ResearchObjectiveIdentity | null {
  if (row.domain !== 'public_equity' || row.evidenceProfile !== 'public_equity') return null
  const tickers = safeJsonArray(row.tickersJson)
  if (!tickers.length) return null
  return {
    id: row.id,
    version: Math.max(1, row.version),
    status: status(row.status),
    lifecycleState: lifecycle(row.lifecycleState),
    domain: row.domain as EvidenceDomain,
    evidenceProfile: row.evidenceProfile as EvidenceProfile,
    operation: row.operation as EvidenceOperation,
    temporalScope: row.temporalScope as TemporalScope,
    objectiveAnchor: normalize(row.objectiveAnchor),
    currentObjective: normalize(row.currentObjective),
    tickers: unique(tickers),
    issuers: unique(safeJsonArray(row.issuersJson), 16),
  }
}

export function extractResearchObjectiveTickers(text: string): string[] {
  return unique([...new Set(text.match(/\b[A-Z]{2,5}\b/g) ?? [])].filter((ticker) => !/^(?:AI|API|CEO|CFO|CTO|CIO|CMO|COO|SEC|NASDAQ|NYSE|USD|ETF|EPS|PPE|KPI|RCA|UI|UX|SQL|HTTP|HTTPS)$/i.test(ticker)))
}

export function shouldContinueResearchObjective(message: string, objective?: ResearchObjectiveIdentity | null): boolean {
  if (!objective || objective.status !== 'active' || objective.domain !== 'public_equity') return false
  const text = normalize(message)
  if (!text) return false
  if (/\b(?:new\s+topic|different\s+topic|move\s+on\s+to|forget\s+(?:that|this)|switch\s+to)\b/i.test(text)) return false
  if (/\b(?:github|vercel|deployment|deploy|code|database|invoice|meeting|weather|recipe|vacation)\b/i.test(text) && !/\b(?:stock|shares?|equity|ticker|earnings|financials?|valuation|price|dividend|eps|filing|invest)\b/i.test(text)) return false
  if (/\b(?:continue|go\s+ahead|proceed|carry\s+on|keep\s+going|same\s+(?:thing|issue|topic|companies?)|those\s+compan(?:y|ies)|these\s+compan(?:y|ies)|the\s+(?:same|current)\s+(?:companies?|stocks?|thread|topic))\b/i.test(text)) return true
  if (/\b(?:it|they|them|this|that|these|those)\b/i.test(text) && /\b(?:general\s+context|context|background|overview|information|details?|update|updates|news|research|analysis|earnings|financials?|valuation|price|risks?)\b/i.test(text)) return true
  const currentTickers = new Set(extractResearchObjectiveTickers(text))
  if ([...currentTickers].some((ticker) => objective.tickers.includes(ticker))) return true
  const objectiveTokens = new Set(objective.objectiveAnchor.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 5))
  const currentTokens = new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 5))
  let overlap = 0
  for (const token of objectiveTokens) if (currentTokens.has(token)) overlap += 1
  return overlap >= 2
}

export function researchObjectiveFromPreRoute(preRoute: PreRouteDecision, fallbackObjective: string): ResearchObjectiveCandidate | null {
  const contract = preRoute.executionContract
  if (contract.domain !== 'public_equity' || contract.evidenceProfile !== 'public_equity') return null
  const objective = normalize(preRoute.routingObjective || fallbackObjective)
  const tickers = unique([
    ...((contract.researchObjective?.tickers ?? []).map((ticker) => ticker)),
    ...extractResearchObjectiveTickers(objective),
  ])
  if (!tickers.length) return null
  return {
    domain: 'public_equity',
    evidenceProfile: 'public_equity',
    operation: contract.operation,
    temporalScope: contract.temporalScope,
    objectiveAnchor: normalize(contract.researchObjective?.objectiveAnchor || objective).slice(0, 4000),
    currentObjective: normalize(contract.researchObjective?.currentObjective || fallbackObjective).slice(0, 8000),
    tickers,
    issuers: contract.researchObjective?.issuers ?? [],
  }
}

export async function loadActiveResearchObjective(input: { conversationId: string; userId: string }): Promise<ResearchObjectiveIdentity | null> {
  try {
    const row = await db.ceoResearchObjective.findFirst({
      where: { conversationId: input.conversationId, userId: input.userId, status: 'active' },
      orderBy: { updatedAt: 'desc' },
    })
    return row ? rowToIdentity(row) : null
  } catch (error) {
    console.warn('[ceo-research-objective] active objective load failed:', error instanceof Error ? error.message.slice(0, 180) : String(error))
    return null
  }
}

export async function ensureResearchObjective(input: {
  conversationId: string
  userId: string
  turnSequence?: number
  candidate: ResearchObjectiveCandidate
  continuation: boolean
  lifecycleState: ResearchObjectiveLifecycleState
  reason: string
}): Promise<ResearchObjectiveIdentity | null> {
  if (input.candidate.domain !== 'public_equity' || input.candidate.evidenceProfile !== 'public_equity') return null
  const now = new Date()
  try {
    const row = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.conversationId}))`
      const active = await tx.ceoResearchObjective.findFirst({
        where: { conversationId: input.conversationId, userId: input.userId, status: 'active' },
        orderBy: { updatedAt: 'desc' },
      })

      const candidateTickers = unique(input.candidate.tickers)
      if (active && input.continuation) {
        const shouldVersion = input.lifecycleState === 'CORRECTED' || input.lifecycleState === 'REFINED'
        const nextVersion = shouldVersion ? active.version + 1 : active.version
        const updated = await tx.ceoResearchObjective.update({
          where: { id: active.id },
          data: {
            version: nextVersion,
            lifecycleState: input.lifecycleState,
            domain: 'public_equity',
            evidenceProfile: 'public_equity',
            operation: input.candidate.operation,
            temporalScope: input.candidate.temporalScope,
            currentObjective: shouldVersion ? normalize(input.candidate.currentObjective).slice(0, 8000) || active.currentObjective : active.currentObjective,
            tickersJson: JSON.stringify(candidateTickers.length ? candidateTickers : safeJsonArray(active.tickersJson)),
            issuersJson: JSON.stringify(unique([ ...safeJsonArray(active.issuersJson), ...(input.candidate.issuers ?? []) ], 16)),
            lastTurnSequence: input.turnSequence,
            updatedAt: now,
          },
        })
        await tx.ceoResearchObjectiveEvent.create({
          data: {
            objectiveId: updated.id,
            conversationId: input.conversationId,
            fromVersion: active.version,
            toVersion: nextVersion,
            lifecycleState: input.lifecycleState,
            eventType: input.lifecycleState === 'CONTINUED' ? 'CONTINUED' : input.lifecycleState,
            reason: normalize(input.reason).slice(0, 500),
            snapshotJson: JSON.stringify({ objectiveAnchor: updated.objectiveAnchor, currentObjective: updated.currentObjective, tickers: candidateTickers }),
          },
        })
        return updated
      }

      if (active) {
        await tx.ceoResearchObjective.update({
          where: { id: active.id },
          data: { status: 'superseded', lifecycleState: 'SUPERSEDED', resolvedAt: now, updatedAt: now },
        })
        await tx.ceoResearchObjectiveEvent.create({
          data: {
            objectiveId: active.id,
            conversationId: input.conversationId,
            fromVersion: active.version,
            toVersion: active.version,
            lifecycleState: 'SUPERSEDED',
            eventType: 'SUPERSEDED',
            reason: normalize(input.reason).slice(0, 500),
            snapshotJson: JSON.stringify({ objectiveAnchor: active.objectiveAnchor, currentObjective: active.currentObjective, tickers: safeJsonArray(active.tickersJson) }),
          },
        })
      }

      const created = await tx.ceoResearchObjective.create({
        data: {
          conversationId: input.conversationId,
          userId: input.userId,
          version: 1,
          status: 'active',
          lifecycleState: input.lifecycleState === 'SUPERSEDED' ? 'ESTABLISHED' : input.lifecycleState,
          domain: 'public_equity',
          evidenceProfile: 'public_equity',
          operation: input.candidate.operation,
          temporalScope: input.candidate.temporalScope,
          objectiveAnchor: normalize(input.candidate.objectiveAnchor).slice(0, 4000),
          currentObjective: normalize(input.candidate.currentObjective).slice(0, 8000) || normalize(input.candidate.objectiveAnchor).slice(0, 8000),
          tickersJson: JSON.stringify(candidateTickers),
          issuersJson: JSON.stringify(unique(input.candidate.issuers ?? [], 16)),
          lastTurnSequence: input.turnSequence,
        },
      })
      await tx.ceoResearchObjectiveEvent.create({
        data: {
          objectiveId: created.id,
          conversationId: input.conversationId,
          fromVersion: null,
          toVersion: 1,
          lifecycleState: input.lifecycleState === 'SUPERSEDED' ? 'ESTABLISHED' : input.lifecycleState,
          eventType: 'ESTABLISHED',
          reason: normalize(input.reason).slice(0, 500),
          snapshotJson: JSON.stringify({ objectiveAnchor: created.objectiveAnchor, currentObjective: created.currentObjective, tickers: candidateTickers }),
        },
      })
      return created
    })
    return rowToIdentity(row)
  } catch (error) {
    console.warn('[ceo-research-objective] objective write failed:', error instanceof Error ? error.message.slice(0, 180) : String(error))
    return await loadActiveResearchObjective({ conversationId: input.conversationId, userId: input.userId })
  }
}
