/**
 * Continuous monitoring (watch-and-alert) -- part c of the External World Intelligence deferred
 * items. Everything in this codebase's external-world tools up to this point is query-time only:
 * the CEO has to be asked before it looks at anything. An EvidenceWatch is the owner (or the CEO on
 * the owner's behalf) registering a standing check; checkAllEvidenceWatches() is fired daily from
 * /api/schedules/tick alongside this codebase's other protected cron jobs, compares fresh data
 * against the threshold, and records a hit (+ best-effort push notification) when it's crossed.
 *
 * price_move_pct is the only watch type implemented -- see EvidenceWatch.watchType in
 * prisma/schema.prisma. It uses yahoo_finance's own live chart endpoint directly (free, no key) so
 * a watch works out of the box with no credential setup.
 */
import { db } from './db'
import { type ToolContext, type ToolResult } from './tools'

function ok(preview: string, result: string): ToolResult { return { ok: true, preview, result } }
function fail(result: string): ToolResult { return { ok: false, preview: result.slice(0, 140), result } }

async function getOperatorUserId(): Promise<string | null> {
  const u = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  return u?.id ?? null
}

export async function toolCreateEvidenceWatch(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const ticker = String(args?.ticker ?? '').trim().toUpperCase()
  if (!ticker) return fail('create_evidence_watch requires "ticker"')
  const thresholdValue = Number(args?.threshold_pct ?? args?.threshold ?? 5)
  if (!Number.isFinite(thresholdValue) || thresholdValue <= 0) return fail('create_evidence_watch requires a positive "threshold_pct"')
  const windowDays = Math.max(1, Math.min(30, Number.isFinite(Number(args?.window_days)) ? Number(args?.window_days) : 1))
  try {
    const userId = await getOperatorUserId()
    if (!userId) return fail('No operator user')
    const watch = await db.evidenceWatch.create({ data: { userId, ticker, watchType: 'price_move_pct', thresholdValue, windowDays } })
    return ok(`Watch created for ${ticker}`, `Watching ${ticker}: alert when price moves more than ${thresholdValue}% within ${windowDays} day(s). Watch id: ${watch.id}. Checked daily by the autonomous heartbeat (/api/schedules/tick).`)
  } catch (e: any) { return fail(`create_evidence_watch failed: ${e?.message ?? String(e)}`) }
}

export async function toolListEvidenceWatches(_args: any, _ctx: ToolContext): Promise<ToolResult> {
  try {
    const userId = await getOperatorUserId()
    if (!userId) return fail('No operator user')
    const watches = await db.evidenceWatch.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 })
    if (!watches.length) return ok('No evidence watches configured', 'No watches configured yet. Use create_evidence_watch to add one, e.g. {"ticker":"AAPL","threshold_pct":5,"window_days":1}.')
    const lines = watches.map((w) => `  [${w.id}] ${w.ticker}: ${w.watchType} > ${w.thresholdValue}% / ${w.windowDays}d — ${w.enabled ? 'enabled' : 'disabled'}${w.lastTriggeredAt ? `, last triggered ${w.lastTriggeredAt.toISOString()}` : ', never triggered'}`).join('\n')
    return ok(`${watches.length} evidence watch(es)`, `EVIDENCE WATCHES\n${'='.repeat(60)}\n\n${lines}`)
  } catch (e: any) { return fail(`list_evidence_watches failed: ${e?.message ?? String(e)}`) }
}

/** Pure, deterministic -- no I/O. Decides whether an observed % move crosses the watch's threshold. */
export function watchThresholdBreached(observedMovePct: number, thresholdPct: number): boolean {
  return Math.abs(observedMovePct) >= thresholdPct
}

/** Real network call. Fails to null (not an error) on any problem -- a watch that can't be checked this run just gets checked again next run. */
export async function fetchPriceMovePct(ticker: string, windowDays: number): Promise<number | null> {
  try {
    const rangeDays = Math.max(5, windowDays + 3)
    const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${rangeDays}d&interval=1d`, { signal: AbortSignal.timeout(10000) })
    if (!response.ok) return null
    const data = await response.json()
    const closes: Array<number | null> = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []
    const valid = closes.filter((c): c is number => typeof c === 'number')
    if (valid.length < 2) return null
    const latest = valid[valid.length - 1]
    const baseIndex = Math.max(0, valid.length - 1 - windowDays)
    const base = valid[baseIndex]
    if (!base) return null
    return ((latest - base) / base) * 100
  } catch { return null }
}

async function notifyWatchHit(ticker: string, thresholdValue: number, movePct: number): Promise<void> {
  const message = `Evidence watch: ${ticker} moved ${movePct >= 0 ? '+' : ''}${movePct.toFixed(2)}% (threshold ${thresholdValue}%)`
  try {
    const { toolNtfyNotify } = await import('./communication-tools')
    await toolNtfyNotify({ message, title: 'Evidence Watch Alert' })
  } catch { /* best-effort -- the hit is still recorded in EvidenceWatchHit even if no notification channel is reachable */ }
}

/** Cron entry point -- fired daily from /api/schedules/tick. Fails open: a bad run never throws past this function. */
export async function checkAllEvidenceWatches(): Promise<{ checked: number; triggered: number }> {
  let checked = 0
  let triggered = 0
  try {
    const watches = await db.evidenceWatch.findMany({ where: { enabled: true } })
    for (const watch of watches) {
      checked += 1
      const movePct = await fetchPriceMovePct(watch.ticker, watch.windowDays)
      await db.evidenceWatch.update({ where: { id: watch.id }, data: { lastCheckedAt: new Date() } }).catch(() => {})
      if (movePct === null) continue
      if (watchThresholdBreached(movePct, watch.thresholdValue)) {
        triggered += 1
        await db.evidenceWatchHit.create({ data: { watchId: watch.id, observedValue: movePct, detail: `${watch.ticker} moved ${movePct.toFixed(2)}% over ${watch.windowDays}d (threshold ${watch.thresholdValue}%)` } }).catch(() => {})
        await db.evidenceWatch.update({ where: { id: watch.id }, data: { lastTriggeredAt: new Date() } }).catch(() => {})
        await notifyWatchHit(watch.ticker, watch.thresholdValue, movePct)
      }
    }
  } catch { /* fails open -- a bad cron run never throws */ }
  return { checked, triggered }
}

export async function toolCheckEvidenceWatches(_args: any, _ctx: ToolContext): Promise<ToolResult> {
  const { checked, triggered } = await checkAllEvidenceWatches()
  return ok(`Checked ${checked} watch(es), ${triggered} triggered`, `Checked ${checked} enabled evidence watch(es); ${triggered} crossed their threshold this run. This normally runs automatically once a day via the autonomous heartbeat -- this is a manual, on-demand check of the same logic.`)
}
