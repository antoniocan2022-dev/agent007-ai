/**
 * Temporal timeline reconstruction -- part c of the External World Intelligence deferred items.
 *
 * Deliberately does NOT claim "causality reconstruction" in the literal sense the deferred item was
 * named: no heuristic run over a handful of dated events can honestly prove one event caused
 * another, and this codebase's whole ethos (see ceo-evidence-bundle.ts, ceo-claim-ledger.ts) is
 * never overclaiming what evidence supports. What this module actually does -- assemble a real,
 * timestamped, sourced event timeline per entity, then flag events that fall close together in time
 * -- is the honest, useful subset of that request: a "candidate temporal correlation," explicitly
 * labeled as calendar proximity, never asserted causation.
 */
import { type ToolContext, type ToolResult } from './tools'
import { lookupRecentVerifiedClaims, DEFAULT_CROSS_TURN_CLAIM_MAX_AGE_MS, type PriorVerifiedClaim } from './ceo-claim-ledger'

function ok(preview: string, result: string): ToolResult { return { ok: true, preview, result } }
function fail(result: string): ToolResult { return { ok: false, preview: result.slice(0, 140), result } }

export interface TimelineEvent { at: number; kind: string; label: string; detail: string; sourceUrl?: string }
export interface CorrelationWindow { earlier: TimelineEvent; later: TimelineEvent; gapDays: number }

/**
 * Pure, deterministic -- no I/O. Sorts events chronologically and flags any two CONSECUTIVE events
 * (in sorted order) within windowDays of each other as a candidate correlation. Consecutive-only is
 * deliberate: flagging every pair within the window would produce a combinatorial, noisy list on a
 * dense timeline; consecutive pairs are exactly the "what happened right before/after this" view a
 * human reviewing a timeline actually wants.
 */
export function buildTimeline(events: TimelineEvent[], windowDays = 14): { events: TimelineEvent[]; correlations: CorrelationWindow[] } {
  const sorted = [...events].sort((a, b) => a.at - b.at)
  const correlations: CorrelationWindow[] = []
  for (let i = 1; i < sorted.length; i += 1) {
    const gapDays = (sorted[i].at - sorted[i - 1].at) / 86400000
    if (gapDays <= windowDays) correlations.push({ earlier: sorted[i - 1], later: sorted[i], gapDays: Math.round(gapDays * 10) / 10 })
  }
  return { events: sorted, correlations }
}

function eventsFromVerifiedClaims(claims: PriorVerifiedClaim[]): TimelineEvent[] {
  return claims.map((c) => ({ at: c.retrievedAt, kind: 'sec_filing_metric', label: `${c.metric}: ${c.value}`, detail: 'Verified SEC company-facts figure (this codebase\'s persisted claim ledger)', sourceUrl: c.sourceUrl }))
}

// Best-effort, real network call -- reuses the same Polygon (Massive) reference endpoints as
// polygon_corporate_actions (ai-providers-integration.ts), but returns structured TimelineEvent[]
// directly rather than pre-formatted text, since that's what this module needs to merge into a
// sorted timeline. Silently returns [] (not an error) when POLYGON_API_KEY isn't configured or the
// call fails -- corporate-action enrichment is additive, never required for a timeline to be useful.
async function fetchPolygonCorporateActionEvents(ticker: string): Promise<TimelineEvent[]> {
  const key = process.env.POLYGON_API_KEY
  if (!key) return []
  try {
    const [splitsRes, dividendsRes] = await Promise.all([
      fetch(`https://api.polygon.io/v3/reference/splits?ticker=${encodeURIComponent(ticker)}&limit=20&apiKey=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(10000) }),
      fetch(`https://api.polygon.io/v3/reference/dividends?ticker=${encodeURIComponent(ticker)}&limit=20&apiKey=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(10000) }),
    ])
    const events: TimelineEvent[] = []
    if (splitsRes.ok) {
      const data = await splitsRes.json()
      for (const r of Array.isArray(data?.results) ? data.results : []) {
        const at = Date.parse(`${r.execution_date}T00:00:00Z`)
        if (Number.isFinite(at)) events.push({ at, kind: 'stock_split', label: `${r.split_from}-for-${r.split_to} stock split`, detail: 'Polygon (Massive) corporate action' })
      }
    }
    if (dividendsRes.ok) {
      const data = await dividendsRes.json()
      for (const r of Array.isArray(data?.results) ? data.results : []) {
        const at = Date.parse(`${r.ex_dividend_date}T00:00:00Z`)
        if (Number.isFinite(at)) events.push({ at, kind: 'dividend', label: `$${r.cash_amount} dividend (ex-date)`, detail: 'Polygon (Massive) corporate action' })
      }
    }
    return events
  } catch { return [] }
}

/** Fails open -- assembling a timeline never throws; a source that can't be reached just contributes zero events. */
export async function assembleEntityTimeline(ticker: string, windowDays = 14): Promise<{ ticker: string; events: TimelineEvent[]; correlations: CorrelationWindow[] }> {
  const trimmed = ticker.trim().toUpperCase()
  const [claims, corporateActions] = await Promise.all([
    lookupRecentVerifiedClaims(trimmed, DEFAULT_CROSS_TURN_CLAIM_MAX_AGE_MS * 90).catch(() => []),
    fetchPolygonCorporateActionEvents(trimmed),
  ])
  const events = [...eventsFromVerifiedClaims(claims), ...corporateActions]
  const { events: sorted, correlations } = buildTimeline(events, windowDays)
  return { ticker: trimmed, events: sorted, correlations }
}

export async function toolEvidenceTimeline(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const ticker = String(args?.ticker ?? '').trim()
  if (!ticker) return fail('evidence_timeline requires "ticker"')
  const windowDays = Math.max(1, Math.min(90, Number(args?.window_days ?? 14)))
  const { ticker: normalized, events, correlations } = await assembleEntityTimeline(ticker, windowDays)
  if (!events.length) {
    return ok(`No timeline events found for ${normalized}`, `No verified, timestamped evidence events are on record yet for ${normalized}. This draws from this codebase's own persisted claim ledger (SEC company-facts figures verified in past turns) plus Polygon (Massive) corporate actions when POLYGON_API_KEY is configured -- it fills in as more equity research turns are run for this ticker.`)
  }
  const eventLines = events.map((e, i) => `  [${i + 1}] ${new Date(e.at).toISOString().slice(0, 10)} — ${e.label}${e.sourceUrl ? `\n      URL: ${e.sourceUrl}` : ''}`).join('\n')
  const correlationLines = correlations.length
    ? correlations.map((c) => `  ${new Date(c.earlier.at).toISOString().slice(0, 10)} (${c.earlier.label}) -> ${new Date(c.later.at).toISOString().slice(0, 10)} (${c.later.label}), ${c.gapDays} day(s) apart`).join('\n')
    : '  (none within the window)'
  return ok(
    `Timeline: ${events.length} event(s), ${correlations.length} candidate correlation(s) for ${normalized}`,
    `EVIDENCE TIMELINE — ${normalized}\n${'='.repeat(60)}\n\nEVENTS (chronological):\n${eventLines}\n\nCANDIDATE TEMPORAL CORRELATIONS (within ${windowDays} day(s) of each other -- calendar proximity only, NOT asserted causation; verify any causal story against the actual source text before stating it as fact):\n${correlationLines}`,
  )
}
