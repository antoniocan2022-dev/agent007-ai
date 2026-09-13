/**
 * Persistent, cross-turn ledger of verified evidence claims.
 *
 * Deep-audit fix (P0, 2026-09-13): the audit's "claim ledger" item was investigated and confirmed
 * "Partial" in the most literal sense -- the EvidenceLedger/EvidenceSource/EvidenceClaim Prisma models
 * (prisma/schema.prisma) and the persistEvidenceLedger()/verifyEvidenceLedger() hashing machinery
 * (proof-ledger.ts) already have exactly the right shape (value + source + verification timestamp), but
 * nothing in the live request path (src/app/api/agent/route.ts and the
 * ceo-evidence-* files) ever wrote to or read from them. The only caller of persistEvidenceLedger was
 * ceo-presenter.ts's verifyMissionEvidence(), itself reachable only from ceoPresentToOwner(), which has
 * zero callers anywhere in src/ -- the table was permanently empty in production. This module is the
 * missing write/read wiring, deliberately scoped to SEC company-facts sources only (see
 * buildClaimLedgerEntries below) rather than general web search/page-read sources, because a
 * multi-ticker query (e.g. "analyze GEOS and MIND") pools search/page sources across companies with no
 * per-source ticker tag, so attributing an arbitrary search snippet's numbers to a specific ticker's
 * claim key would risk silently cross-attributing one company's figures to another's ledger entry. SEC
 * company-facts sources (ceo-evidence-executor.ts's fetchSecSource) are fetched one-per-ticker and
 * already unambiguous, so they're the only claims worth persisting as authoritative.
 */
import { db } from './db'
import { persistEvidenceLedger, type EvidenceClaimInput, type EvidenceSourceInput } from './proof-ledger'
import { sourceTierForUrl, type EvidenceSource } from './ceo-evidence-bundle'
import { CONTRADICTION_THRESHOLD, extractMetricValues, preferBetween, relativeDifference, type ContradictionRecord } from './ceo-contradiction-resolver'

/** All claims for a subject share this prefix so lookupRecentVerifiedClaims can filter by it without a dedicated column. */
export function claimKeyFor(subject: string, metric: string): string { return `${subject.trim().toUpperCase()}:${metric}` }

const CLAIM_TEXT_RE = /^[a-z_]+:\s*(-?[\d.]+)$/i
// Deliberately not natural language -- this module is the only writer of claims under this key prefix,
// so claimText is a small self-owned "metric: value" serialization (parsed back by the same regex below)
// rather than a schema migration adding a numeric column, since this sandbox has no live DB to validate
// a migration against. Any human-facing rendering of these claims should go through renderContradictions
// (ceo-contradiction-resolver.ts) or a future presentation layer, not claimText directly.
function formatClaimText(metric: string, value: number): string { return `${metric}: ${value}` }
function parseClaimText(claimText: string): number | null { const match = claimText.match(CLAIM_TEXT_RE); return match ? Number.parseFloat(match[1]) : null }

function confidenceForTier(tier: 1 | 2 | 3 | 4): number { return tier === 1 ? 0.95 : tier === 2 ? 0.85 : tier === 3 ? 0.75 : 0.55 }

/**
 * Pure, deterministic -- no I/O. Builds a persistEvidenceLedger()-shaped payload from a set of sources
 * already scoped to one subject (one ticker). When two-or-more sources disagree on the same metric within
 * this set, `contradictions` (already computed by detectContradictions over the same source set) decides
 * the winning value and the claim is recorded as 'PARTIAL' rather than 'VERIFIED' -- contested, not
 * confirmed. Returns null when no extractable metric exists anywhere in the sources (nothing worth
 * recording).
 */
export function buildClaimLedgerEntries(subject: string, sources: readonly EvidenceSource[], contradictions: readonly ContradictionRecord[]): { sources: EvidenceSourceInput[]; claims: EvidenceClaimInput[] } | null {
  const bySourceId = new Map(sources.map((source) => [source.id, source]))
  const contestedMetrics = new Set(contradictions.map((record) => record.metric))
  const preferredSourceIdByMetric = new Map(contradictions.map((record) => [record.metric, record.preferredSourceId]))

  const byMetric = new Map<string, Array<{ sourceId: string; value: number }>>()
  for (const source of sources) for (const { metric, value } of extractMetricValues(source)) { const list = byMetric.get(metric) ?? []; list.push({ sourceId: source.id, value }); byMetric.set(metric, list) }
  if (byMetric.size === 0) return null

  const winners: Array<{ metric: string; sourceId: string; value: number; contested: boolean }> = []
  for (const [metric, entries] of byMetric) {
    const preferredId = preferredSourceIdByMetric.get(metric)
    const preferred = preferredId ? entries.find((entry) => entry.sourceId === preferredId) : undefined
    const picked = preferred ?? [...entries].sort((a, b) => {
      const sourceA = bySourceId.get(a.sourceId)!, sourceB = bySourceId.get(b.sourceId)!
      const { winnerId } = preferBetween(
        { sourceId: a.sourceId, sourceTier: sourceA.sourceTier, retrievedAt: sourceA.retrievedAt, publishedAt: sourceA.publishedAt },
        { sourceId: b.sourceId, sourceTier: sourceB.sourceTier, retrievedAt: sourceB.retrievedAt, publishedAt: sourceB.publishedAt },
      )
      return winnerId === a.sourceId ? -1 : 1
    })[0]
    winners.push({ metric, sourceId: picked.sourceId, value: picked.value, contested: contestedMetrics.has(metric) })
  }

  const involvedSourceIds = [...new Set(winners.map((winner) => winner.sourceId))]
  const sourceIndexById = new Map(involvedSourceIds.map((id, index) => [id, index]))
  const sourceInputs: EvidenceSourceInput[] = involvedSourceIds.map((id) => { const source = bySourceId.get(id)!; return { provider: source.publisher, sourceUrl: source.url, retrievedAt: new Date(source.retrievedAt), rawEvidenceRef: source.id, rawEvidence: source.text } })
  const claimInputs: EvidenceClaimInput[] = winners.map((winner) => {
    const source = bySourceId.get(winner.sourceId)!
    return {
      claimKey: claimKeyFor(subject, winner.metric),
      claimText: formatClaimText(winner.metric, winner.value),
      classification: 'FACT',
      confidence: confidenceForTier(source.sourceTier),
      verificationStatus: winner.contested ? 'PARTIAL' : source.sourceTier <= 2 ? 'VERIFIED' : 'UNVERIFIED',
      sourceIndex: sourceIndexById.get(winner.sourceId),
      notes: winner.contested ? 'Value selected from a detected cross-source contradiction; see the contradiction record for the rejected alternative.' : undefined,
    }
  })
  return { sources: sourceInputs, claims: claimInputs }
}

/**
 * Persists this turn's verified/contested claims about `subject` so a later turn (any conversation) can
 * look them up via lookupRecentVerifiedClaims. Fails open -- a DB error never throws into the request
 * path that produced this turn's answer, since this write is forward-looking (for future turns) and must
 * not be able to break the current one. missionId is a deterministic per-subject ledger id (not tied to
 * any one conversation) so persistEvidenceLedger's existing version-chain machinery naturally accumulates
 * one evolving history of observations per ticker across every conversation that ever asks about it.
 */
export async function recordVerifiedClaims(input: { subject: string; sources: readonly EvidenceSource[]; contradictions: readonly ContradictionRecord[] }): Promise<{ recorded: boolean }> {
  const entries = buildClaimLedgerEntries(input.subject, input.sources, input.contradictions)
  if (!entries || !entries.claims.length) return { recorded: false }
  try {
    await persistEvidenceLedger({
      missionId: `equity-claims:${input.subject.trim().toUpperCase()}`,
      title: `${input.subject.trim().toUpperCase()} evidence claims`,
      idempotencyKey: `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      status: 'verified',
      sources: entries.sources,
      claims: entries.claims,
    })
    return { recorded: true }
  } catch { return { recorded: false } }
}

export interface PriorVerifiedClaim { metric: string; value: number; sourceUrl: string; retrievedAt: number; ledgerId: string }

/**
 * Reads back the most recent VERIFIED claim per metric for `subject` across every ledger version and
 * every conversation that ever recorded one (not scoped to the current mission/conversation -- that's
 * the whole point of a cross-turn ledger). Fails open to [] on any DB error, matching the established
 * fail-closed-to-empty pattern for self-inspection reads (proof-ledger.ts's getExecutionReceipt etc.):
 * a lookup that can't complete should read as "no prior claim found," never crash the turn it informs.
 */
export async function lookupRecentVerifiedClaims(subject: string, maxAgeMs: number, now = Date.now()): Promise<PriorVerifiedClaim[]> {
  const trimmed = subject.trim().toUpperCase()
  if (!trimmed) return []
  try {
    const rows = await db.evidenceClaim.findMany({
      where: { claimKey: { startsWith: `${trimmed}:` }, verificationStatus: 'VERIFIED' },
      include: { Source: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    const seenMetrics = new Set<string>()
    const results: PriorVerifiedClaim[] = []
    for (const row of rows) {
      const metric = row.claimKey.slice(trimmed.length + 1)
      if (seenMetrics.has(metric)) continue
      const retrievedAt = row.Source?.retrievedAt?.getTime() ?? row.createdAt.getTime()
      if (now - retrievedAt > maxAgeMs) continue
      const value = parseClaimText(row.claimText)
      if (value === null) continue
      seenMetrics.add(metric)
      results.push({ metric, value, sourceUrl: row.Source?.sourceUrl ?? '', retrievedAt, ledgerId: row.ledgerId })
    }
    return results
  } catch { return [] }
}

export const DEFAULT_CROSS_TURN_CLAIM_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * Pure, deterministic -- no I/O. Compares this turn's freshly extracted metric values for `subject`
 * against verified claims recorded in an EARLIER, separate turn (possibly a different conversation
 * entirely). This is the actual behavioral payoff of the ledger: without it, a fact that contradicts what
 * was told to the user three days ago in a different conversation would never be noticed, because
 * detectContradictions (ceo-contradiction-resolver.ts) only ever compares sources gathered within one
 * turn's single EvidenceBundle.
 */
export function crossTurnContradictions(subject: string, currentSources: readonly EvidenceSource[], priorClaims: readonly PriorVerifiedClaim[]): ContradictionRecord[] {
  if (!priorClaims.length) return []
  const currentByMetric = new Map<string, Array<{ sourceId: string; source: EvidenceSource; value: number }>>()
  for (const source of currentSources) for (const { metric, value } of extractMetricValues(source)) { const list = currentByMetric.get(metric) ?? []; list.push({ sourceId: source.id, source, value }); currentByMetric.set(metric, list) }
  const records: ContradictionRecord[] = []
  for (const prior of priorClaims) {
    for (const current of currentByMetric.get(prior.metric) ?? []) {
      if (relativeDifference(current.value, prior.value) < CONTRADICTION_THRESHOLD) continue
      const priorId = `ledger:${prior.ledgerId}`
      const priorTier = sourceTierForUrl(prior.sourceUrl)
      const { winnerId, reason } = preferBetween(
        { sourceId: current.sourceId, sourceTier: current.source.sourceTier, retrievedAt: current.source.retrievedAt, publishedAt: current.source.publishedAt },
        { sourceId: priorId, sourceTier: priorTier, retrievedAt: prior.retrievedAt },
      )
      records.push({
        metric: prior.metric,
        values: [
          { sourceId: current.sourceId, sourceUrl: current.source.url, value: current.value, sourceTier: current.source.sourceTier, retrievedAt: current.source.retrievedAt, publishedAt: current.source.publishedAt },
          { sourceId: priorId, sourceUrl: prior.sourceUrl, value: prior.value, sourceTier: priorTier, retrievedAt: prior.retrievedAt },
        ],
        preferredSourceId: winnerId,
        reason: `${reason} (cross-turn check: a claim verified in an earlier conversation, retrieved ${new Date(prior.retrievedAt).toISOString()}, reported a materially different figure for ${subject.trim().toUpperCase()}.)`,
      })
    }
  }
  return records
}
