/**
 * Cross-source contradiction detection for acquired evidence.
 *
 * Deep-audit fix (P0, 2026-09-13): confirmed by direct investigation that `contradictionSourceIds`
 * (ceo-evidence-bundle.ts's EvidenceClaimCandidate) was a fully-wired but entirely dead field -- a
 * self-consistent read/write pair (assessEvidenceClaim) that nothing in the live evidence-acquisition ->
 * gate -> response pipeline ever called with real contradiction data. No code anywhere detected that two
 * sources disagreed on the same fact. This module is that missing detector: it extracts numeric metric
 * values per source (revenue, market cap, cash, EPS, stock price...) and flags genuine disagreements
 * (a meaningful relative difference, not rounding/measurement noise) between sources reporting the same
 * metric, with a source-tier/recency-based preference so the response can say which figure is currently
 * better supported and why -- the exact resolution shape the audit itself proposed ("Source A says X,
 * Source B says Y -- X is currently better supported").
 */
import type { EvidenceSource } from './ceo-evidence-bundle'

export interface ContradictionValue { sourceId: string; sourceUrl: string; value: number; sourceTier: 1 | 2 | 3 | 4; retrievedAt: number; publishedAt?: number }
export interface ContradictionRecord { metric: string; values: [ContradictionValue, ContradictionValue]; preferredSourceId: string; reason: string }

interface MetricPattern { metric: string; re: RegExp }
// Deliberately tolerant of natural-language phrasing ("revenue was $50 million", "Revenue: 123456789")
// since acquired sources range from SEC's own structured company-facts lines (ceo-evidence-executor.ts's
// FACT_CANDIDATES format) to free-form web-search/page-reader text -- up to 40 chars of filler is
// allowed between the metric word and its number so both shapes match the same pattern.
const METRIC_PATTERNS: readonly MetricPattern[] = Object.freeze([
  { metric: 'revenue', re: /\brevenue\b[^.\n]{0,40}?\$?(-?[\d,]+(?:\.\d+)?)\s*(million|billion|thousand|m\b|b\b|k\b)?/i },
  { metric: 'market_cap', re: /\bmarket\s*cap(?:italization)?\b[^.\n]{0,40}?\$?(-?[\d,]+(?:\.\d+)?)\s*(million|billion|thousand|m\b|b\b|k\b|t\b)?/i },
  { metric: 'net_income', re: /\bnet\s*income\b[^.\n]{0,40}?\$?\(?(-?[\d,]+(?:\.\d+)?)\)?\s*(million|billion|thousand|m\b|b\b|k\b)?/i },
  { metric: 'cash', re: /\bcash(?:\s+and\s+cash\s+equivalents)?\b[^.\n]{0,40}?\$?(-?[\d,]+(?:\.\d+)?)\s*(million|billion|thousand|m\b|b\b|k\b)?/i },
  { metric: 'eps', re: /\beps\b[^.\n]{0,40}?\$?(-?[\d.]+)\b/i },
  { metric: 'stock_price', re: /\b(?:stock|share)\s*price\b[^.\n]{0,40}?\$?(-?[\d,]+(?:\.\d+)?)\b/i },
])

function unitScale(unit?: string): number {
  const normalized = (unit ?? '').toLowerCase()
  if (normalized === 'b' || normalized === 'billion') return 1e9
  if (normalized === 'm' || normalized === 'million') return 1e6
  if (normalized === 'k' || normalized === 'thousand') return 1e3
  if (normalized === 't') return 1e12
  return 1
}

function extractMetricValues(source: EvidenceSource): Array<{ metric: string; value: number }> {
  const results: Array<{ metric: string; value: number }> = []
  for (const { metric, re } of METRIC_PATTERNS) {
    const match = source.text.match(re)
    if (!match) continue
    const raw = Number.parseFloat(match[1].replace(/,/g, ''))
    if (!Number.isFinite(raw)) continue
    results.push({ metric, value: raw * unitScale(match[2]) })
  }
  return results
}

function relativeDifference(a: number, b: number): number {
  const denominator = Math.max(Math.abs(a), Math.abs(b), 1)
  return Math.abs(a - b) / denominator
}

// A >15% relative gap on the identical metric is treated as a genuine disagreement worth flagging, not
// ordinary rounding/measurement-period noise (e.g. a mid-quarter estimate vs. a filed actual).
const CONTRADICTION_THRESHOLD = 0.15

function toContradictionValue(sourceId: string, source: EvidenceSource, value: number): ContradictionValue {
  return { sourceId, sourceUrl: source.url, value, sourceTier: source.sourceTier, retrievedAt: source.retrievedAt, publishedAt: source.publishedAt }
}

function preferBetween(a: { sourceId: string; source: EvidenceSource }, b: { sourceId: string; source: EvidenceSource }): { winner: typeof a; reason: string } {
  if (a.source.sourceTier !== b.source.sourceTier) { const winner = a.source.sourceTier < b.source.sourceTier ? a : b; return { winner, reason: `${winner.sourceId} is a higher-tier source (tier ${winner.source.sourceTier} vs. tier ${(winner === a ? b : a).source.sourceTier}).` } }
  const aTime = a.source.publishedAt ?? a.source.retrievedAt, bTime = b.source.publishedAt ?? b.source.retrievedAt
  const winner = aTime >= bTime ? a : b
  return { winner, reason: `${winner.sourceId} is the more recently ${winner.source.publishedAt ? 'published' : 'retrieved'} of the two (same source tier).` }
}

/** Pure, deterministic -- no I/O. Called once per evidence bundle (ceo-evidence-bundle.ts's buildEvidenceBundle). */
export function detectContradictions(sources: readonly EvidenceSource[]): ContradictionRecord[] {
  const byMetric = new Map<string, Array<{ sourceId: string; value: number; source: EvidenceSource }>>()
  for (const source of sources) for (const { metric, value } of extractMetricValues(source)) { const list = byMetric.get(metric) ?? []; list.push({ sourceId: source.id, value, source }); byMetric.set(metric, list) }
  const contradictions: ContradictionRecord[] = []
  for (const [metric, entries] of byMetric) {
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const a = entries[i], b = entries[j]
        if (relativeDifference(a.value, b.value) < CONTRADICTION_THRESHOLD) continue
        const { winner, reason } = preferBetween(a, b)
        contradictions.push({ metric, values: [toContradictionValue(a.sourceId, a.source, a.value), toContradictionValue(b.sourceId, b.source, b.value)], preferredSourceId: winner.sourceId, reason })
      }
    }
  }
  return contradictions
}

export function renderContradictions(contradictions: readonly ContradictionRecord[]): string {
  if (!contradictions.length) return ''
  const lines = contradictions.map((record) => { const [first, second] = record.values; return `- ${record.metric}: [${first.sourceId}] reports ${first.value.toLocaleString()} vs. [${second.sourceId}] reports ${second.value.toLocaleString()}. ${record.reason} Prefer [${record.preferredSourceId}] unless the difference is explainable by measurement period or methodology.` })
  return `CONTRADICTIONS DETECTED between sources (do not silently pick one or average them -- disclose the disagreement):\n${lines.join('\n')}`
}
