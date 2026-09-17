/**
 * Financial Evidence Graph -- part c of the External World Intelligence deferred items.
 *
 * A minimal, real graph over the same relational store used everywhere else in this codebase
 * (nodes + adjacency edges), not a separate graph database. The only signal this module ever
 * records is genuine co-occurrence: two entities (tickers) that actually appeared together in the
 * same evidence bundle's relatedEntities (ceo-evidence-bundle.ts) -- companies the CEO actually
 * researched or compared together in one turn. It never infers or asserts a stronger relationship
 * (e.g. "competitor of", "supplier of") than that -- that would be fabricating a business
 * relationship this codebase has no real evidence for.
 */
import { db } from './db'
import { type ToolContext, type ToolResult } from './tools'
import type { EvidenceBundle } from './ceo-evidence-bundle'

function ok(preview: string, result: string): ToolResult { return { ok: true, preview, result } }
function fail(result: string): ToolResult { return { ok: false, preview: result.slice(0, 140), result } }

export interface GraphEdgeCandidate { fromKey: string; toKey: string; relationship: string; sourceIds: string[] }

/**
 * Pure, deterministic -- no I/O. From a bundle's sources' relatedEntities, finds every distinct
 * entity-key pair that co-occurred in at least one source (appeared together in the same source's
 * relatedEntities array). Order-independent: [AAPL, MSFT] and [MSFT, AAPL] collapse to one pair.
 */
export function coOccurringEntityPairs(bundle: Pick<EvidenceBundle, 'sources'>): GraphEdgeCandidate[] {
  const pairs = new Map<string, GraphEdgeCandidate>()
  for (const source of bundle.sources) {
    const entities = [...new Set((source.relatedEntities ?? []).map((e) => e.trim().toUpperCase()).filter(Boolean))]
    for (let i = 0; i < entities.length; i += 1) for (let j = i + 1; j < entities.length; j += 1) {
      const [a, b] = [entities[i], entities[j]].sort()
      const key = `${a}::${b}`
      const existing = pairs.get(key)
      if (existing) { if (!existing.sourceIds.includes(source.id)) existing.sourceIds.push(source.id) }
      else pairs.set(key, { fromKey: a, toKey: b, relationship: 'co_researched', sourceIds: [source.id] })
    }
  }
  return [...pairs.values()]
}

/**
 * Records this turn's co-occurring entity pairs into the graph. Fails open -- a DB error never
 * throws into the request path that produced this turn's evidence, matching the established
 * ceo-claim-ledger.ts convention for this codebase's other forward-looking (future-turn) writes.
 */
export async function recordEvidenceGraphFromBundle(bundle: Pick<EvidenceBundle, 'sources'>): Promise<{ recorded: number }> {
  const pairs = coOccurringEntityPairs(bundle)
  if (!pairs.length) return { recorded: 0 }
  let recorded = 0
  try {
    for (const pair of pairs) {
      const [from, to] = await Promise.all([
        db.evidenceEntityNode.upsert({ where: { entityType_key: { entityType: 'company', key: pair.fromKey } }, update: {}, create: { entityType: 'company', key: pair.fromKey, name: pair.fromKey } }),
        db.evidenceEntityNode.upsert({ where: { entityType_key: { entityType: 'company', key: pair.toKey } }, update: {}, create: { entityType: 'company', key: pair.toKey, name: pair.toKey } }),
      ])
      const existing = await db.evidenceEntityEdge.findUnique({ where: { fromNodeId_toNodeId_relationship: { fromNodeId: from.id, toNodeId: to.id, relationship: pair.relationship } } })
      if (existing) {
        const mergedSourceIds = [...new Set([...existing.sourceIds.split(',').filter(Boolean), ...pair.sourceIds])].slice(0, 50)
        await db.evidenceEntityEdge.update({ where: { id: existing.id }, data: { occurrences: existing.occurrences + 1, confidence: Math.min(0.95, existing.confidence + 0.05), sourceIds: mergedSourceIds.join(','), observedAt: new Date() } })
      } else {
        await db.evidenceEntityEdge.create({ data: { fromNodeId: from.id, toNodeId: to.id, relationship: pair.relationship, confidence: 0.5, occurrences: 1, sourceIds: pair.sourceIds.slice(0, 50).join(',') } })
      }
      recorded += 1
    }
  } catch { /* fails open -- graph recording never breaks the turn that produced this evidence */ }
  return { recorded }
}

export interface EntityNeighbor { key: string; name: string; relationship: string; confidence: number; occurrences: number; sourceIds: string[] }

/** Fails closed to { found: false, neighbors: [] } on any DB error -- a lookup that can't complete reads as "nothing on record," never crashes the turn it informs. */
export async function getEntityNeighborhood(key: string): Promise<{ found: boolean; neighbors: EntityNeighbor[] }> {
  const trimmed = key.trim().toUpperCase()
  if (!trimmed) return { found: false, neighbors: [] }
  try {
    const node = await db.evidenceEntityNode.findUnique({ where: { entityType_key: { entityType: 'company', key: trimmed } } })
    if (!node) return { found: false, neighbors: [] }
    const [outgoing, incoming] = await Promise.all([
      db.evidenceEntityEdge.findMany({ where: { fromNodeId: node.id } }),
      db.evidenceEntityEdge.findMany({ where: { toNodeId: node.id } }),
    ])
    const otherIds = [...new Set([...outgoing.map((e) => e.toNodeId), ...incoming.map((e) => e.fromNodeId)])]
    const otherNodes = otherIds.length ? await db.evidenceEntityNode.findMany({ where: { id: { in: otherIds } } }) : []
    const nodeById = new Map(otherNodes.map((n) => [n.id, n]))
    const neighbors: EntityNeighbor[] = [
      ...outgoing.map((e) => ({ key: nodeById.get(e.toNodeId)?.key ?? '?', name: nodeById.get(e.toNodeId)?.name ?? '?', relationship: e.relationship, confidence: e.confidence, occurrences: e.occurrences, sourceIds: e.sourceIds.split(',').filter(Boolean) })),
      ...incoming.map((e) => ({ key: nodeById.get(e.fromNodeId)?.key ?? '?', name: nodeById.get(e.fromNodeId)?.name ?? '?', relationship: e.relationship, confidence: e.confidence, occurrences: e.occurrences, sourceIds: e.sourceIds.split(',').filter(Boolean) })),
    ].sort((a, b) => b.occurrences - a.occurrences)
    return { found: true, neighbors }
  } catch { return { found: false, neighbors: [] } }
}

export async function toolEvidenceGraphQuery(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const key = String(args?.ticker ?? args?.key ?? '').trim()
  if (!key) return fail('evidence_graph_query requires "ticker"')
  const { found, neighbors } = await getEntityNeighborhood(key)
  const normalized = key.trim().toUpperCase()
  if (!found) return ok(`No evidence graph entry for ${normalized}`, `${normalized} has not co-occurred with any other entity in evidence gathered so far. This graph only records companies genuinely researched/compared together in the same turn -- it grows as more multi-ticker research is run.`)
  if (!neighbors.length) return ok(`${normalized} has no recorded connections`, `${normalized} is on record but has no co-occurrence edges yet.`)
  const lines = neighbors.map((n) => `  ${n.key} (${n.name}) — ${n.relationship}, confidence ${n.confidence.toFixed(2)}, seen together ${n.occurrences} time(s)`).join('\n')
  return ok(`${neighbors.length} connection(s) for ${normalized}`, `FINANCIAL EVIDENCE GRAPH — ${normalized}\n${'='.repeat(60)}\n\nThis records only genuine co-occurrence in past evidence gathering, not an asserted business relationship (competitor/supplier/etc.) -- verify with fresh search before stating one.\n\nCONNECTIONS:\n${lines}`)
}
