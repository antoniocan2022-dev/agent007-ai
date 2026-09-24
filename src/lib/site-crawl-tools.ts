/**
 * site-crawl-tools.ts — whole-site crawling and URL discovery.
 *
 * Closes the "site-intelligence / whole-site crawling" gap: jina_reader (free-search-tools.ts)
 * and page_reader read exactly one URL each. Firecrawl and Spider.cloud discover and read many
 * pages under a domain in one call -- mapping a site's structure, or crawling it end to end.
 */
import { type ToolContext, type ToolResult } from './tools'

function ok(preview: string, result: string): ToolResult { return { ok: true, preview, result } }
function fail(result: string): ToolResult { return { ok: false, preview: result.slice(0, 140), result } }

// Firecrawl works "keyless" (no FIRECRAWL_API_KEY) for scrape at a shared, rate-limited free tier
// (1,000 credits/month, per Firecrawl's own "Keyless" launch) -- the request is made either way,
// with an Authorization header attached only when a key is configured. map and crawl are not part
// of the keyless tier and fail honestly, naming the missing key, when one isn't set.
function firecrawlHeaders(): Record<string, string> {
  const key = process.env.FIRECRAWL_API_KEY
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (key) headers.Authorization = `Bearer ${key}`
  return headers
}

export async function toolFirecrawlScrape(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const url = String(args?.url ?? '').trim()
  if (!url) return fail('firecrawl_scrape requires "url"')
  const formats = Array.isArray(args?.formats) && args.formats.length ? args.formats : ['markdown']
  try {
    const response = await fetch('https://api.firecrawl.dev/v2/scrape', { method: 'POST', headers: firecrawlHeaders(), body: JSON.stringify({ url, formats }), signal: AbortSignal.timeout(30000) })
    if (!response.ok) return fail(`Firecrawl Scrape: HTTP ${response.status}${response.status === 401 || response.status === 429 ? ' (keyless rate limit likely exceeded -- set FIRECRAWL_API_KEY for higher limits)' : ''}`)
    const data = await response.json()
    const doc = data?.data ?? data
    const markdown = doc?.markdown ?? ''
    if (!markdown && !doc?.html) return fail(`Firecrawl Scrape: no content returned for ${url}`)
    const title = doc?.metadata?.title ?? url
    return ok(`Firecrawl: scraped ${url}`, `FIRECRAWL SCRAPE — ${title}\nURL: ${url}\n${'='.repeat(60)}\n\n${String(markdown || doc?.html || '').slice(0, 12000)}`)
  } catch (e: any) { return fail(`Firecrawl Scrape: ${e?.message ?? String(e)}`) }
}

export async function toolFirecrawlMap(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const key = process.env.FIRECRAWL_API_KEY
  if (!key) return fail('firecrawl_map requires FIRECRAWL_API_KEY (map is not available in keyless mode). Get a key at https://www.firecrawl.dev')
  const url = String(args?.url ?? '').trim()
  if (!url) return fail('firecrawl_map requires "url"')
  const search = String(args?.search ?? '').trim()
  try {
    const body: Record<string, unknown> = { url }
    if (search) body.search = search
    const response = await fetch('https://api.firecrawl.dev/v2/map', { method: 'POST', headers: firecrawlHeaders(), body: JSON.stringify(body), signal: AbortSignal.timeout(30000) })
    if (!response.ok) return fail(`Firecrawl Map: HTTP ${response.status}`)
    const data = await response.json()
    const links: string[] = Array.isArray(data?.links) ? data.links.map((l: any) => typeof l === 'string' ? l : l?.url).filter(Boolean) : []
    if (!links.length) return ok(`Firecrawl Map: no URLs discovered for ${url}`, JSON.stringify(data).slice(0, 2000))
    const shown = links.slice(0, 200)
    return ok(`Firecrawl Map: ${links.length} URL(s) discovered under ${url}`, `FIRECRAWL SITE MAP — ${url}\n${'='.repeat(60)}\n\nDiscovered ${links.length} URL(s)${links.length > shown.length ? ` (showing first ${shown.length})` : ''}:\n${shown.map((l) => `  URL: ${l}`).join('\n')}`)
  } catch (e: any) { return fail(`Firecrawl Map: ${e?.message ?? String(e)}`) }
}

// intervalMs is a parameter (not a hardcoded constant) purely so tests can poll a mocked endpoint
// on a short interval instead of waiting out the real 2.5s production cadence -- production callers
// never pass it, so this changes nothing about real crawl behavior.
//
// Round-2 deep-audit fixes: (1) a non-positive budgetMs used to skip the loop body entirely (the
// `while` condition was false before any fetch ran) yet still fell through to the "still running"
// return -- reporting a status it never actually checked. Restructured so at least one real check
// always happens, however small the budget. (2) a single transient HTTP error mid-poll used to
// `return fail(...)` immediately, killing the whole check even though up to ~8 more attempts might
// remain in budget -- now retries within budget and only reports a hard failure if EVERY attempt
// failed (never got one real response to report on).
export async function pollFirecrawlJob(jobId: string, key: string, budgetMs: number, intervalMs = 2500): Promise<ToolResult> {
  const deadline = Date.now() + budgetMs
  let last: any = null
  let lastError: string | undefined
  for (;;) {
    try {
      const response = await fetch(`https://api.firecrawl.dev/v2/crawl/${encodeURIComponent(jobId)}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000) })
      if (response.ok) { last = await response.json(); lastError = undefined; if (last?.status === 'completed' || last?.status === 'failed') break }
      else { lastError = `HTTP ${response.status}` }
    } catch (e: any) { lastError = e?.message ?? String(e) }
    if (Date.now() >= deadline) break
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  if (!last) return fail(`Firecrawl Crawl: could not check job ${jobId} — ${lastError ?? 'no response'}`)
  const status = last?.status ?? 'unknown'
  const pages = Array.isArray(last?.data) ? last.data : []
  if (status === 'completed') {
    const shown = pages.slice(0, 20)
    const body = shown.map((p: any, i: number) => `  [${i + 1}] ${p?.metadata?.title ?? p?.metadata?.sourceURL ?? '(untitled)'}\n      URL: ${p?.metadata?.sourceURL ?? '(unknown)'}\n      ${String(p?.markdown ?? '').slice(0, 400).replace(/\n+/g, ' ')}`).join('\n\n')
    return ok(`Firecrawl Crawl: completed, ${pages.length} page(s)`, `FIRECRAWL CRAWL — job ${jobId} (completed)\n${'='.repeat(60)}\n\nPAGES (${shown.length} of ${pages.length}):\n${body}`)
  }
  if (status === 'failed') return fail(`Firecrawl Crawl: job ${jobId} failed — ${JSON.stringify(last).slice(0, 500)}`)
  // Fresh-audit design note: crawl is asynchronous server-side and can run well past any one tool
  // call's latency budget. Rather than block indefinitely or fabricate "done", this polls for a
  // bounded window and hands back the real job id so the caller can check again -- honest about an
  // in-progress state instead of pretending synchronous completion.
  return ok(`Firecrawl Crawl: still running (job ${jobId})`, `Crawl job ${jobId} is still running (${last?.completed ?? 0}/${last?.total ?? '?'} pages so far). Call firecrawl_crawl again with job_id="${jobId}" to check progress or fetch results once complete.`)
}

export async function toolFirecrawlCrawl(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const key = process.env.FIRECRAWL_API_KEY
  if (!key) return fail('firecrawl_crawl requires FIRECRAWL_API_KEY (crawl is not available in keyless mode). Get a key at https://www.firecrawl.dev')
  const jobId = String(args?.job_id ?? '').trim()
  try {
    if (jobId) return await pollFirecrawlJob(jobId, key, 20000)
    const url = String(args?.url ?? '').trim()
    if (!url) return fail('firecrawl_crawl requires "url" (or "job_id" to check a previously started crawl)')
    const rawLimit = Number(args?.limit ?? 50)
    const limit = Math.min(500, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 50))
    const response = await fetch('https://api.firecrawl.dev/v2/crawl', { method: 'POST', headers: firecrawlHeaders(), body: JSON.stringify({ url, limit, scrapeOptions: { formats: ['markdown'] } }), signal: AbortSignal.timeout(15000) })
    if (!response.ok) return fail(`Firecrawl Crawl: HTTP ${response.status}`)
    const started = await response.json()
    const newJobId = started?.id
    if (!newJobId) return fail(`Firecrawl Crawl: no job id returned — ${JSON.stringify(started).slice(0, 500)}`)
    return await pollFirecrawlJob(newJobId, key, 20000)
  } catch (e: any) { return fail(`Firecrawl Crawl: ${e?.message ?? String(e)}`) }
}

// Spider.cloud: credential-gated, specializes in anti-bot-resistant scraping/crawling -- a fallback
// for sites (paywalled news, aggressive bot protection) where Firecrawl or a direct fetch gets blocked.
// Production audit fix (2026-09-24): the live Vercel production env has this key set as
// SPIDERCLOUD_API_KEY (matching the product's own "Spider.cloud" name), not SPIDER_API_KEY as this
// codebase's convention documents -- confirmed by directly diffing the live Vercel project env list
// against every process.env read in this file. Without this fallback both Spider.cloud tools always
// returned "needs key" in production despite the key being genuinely configured (same drift class as
// the NewsAPI/Alpha Vantage/ROIC.ai fixes in ai-providers-integration.ts).
function spiderHeaders(): Record<string, string> | null {
  const key = process.env.SPIDER_API_KEY || process.env.SPIDERCLOUD_API_KEY
  if (!key) return null
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
}

export async function toolSpiderScrape(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const headers = spiderHeaders()
  if (!headers) return fail('spider_scrape requires SPIDER_API_KEY. Get a key at https://spider.cloud')
  const url = String(args?.url ?? '').trim()
  if (!url) return fail('spider_scrape requires "url"')
  try {
    const response = await fetch('https://api.spider.cloud/scrape', { method: 'POST', headers, body: JSON.stringify({ url, return_format: 'markdown' }), signal: AbortSignal.timeout(30000) })
    if (!response.ok) return fail(`Spider Scrape: HTTP ${response.status}`)
    const data = await response.json()
    const doc = Array.isArray(data) ? data[0] : data
    const content = doc?.content ?? doc?.markdown ?? ''
    if (!content) return fail(`Spider Scrape: no content returned for ${url}`)
    return ok(`Spider: scraped ${url}`, `SPIDER SCRAPE — ${doc?.title ?? url}\nURL: ${url}\n${'='.repeat(60)}\n\n${String(content).slice(0, 12000)}`)
  } catch (e: any) { return fail(`Spider Scrape: ${e?.message ?? String(e)}`) }
}

export async function toolSpiderCrawl(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const headers = spiderHeaders()
  if (!headers) return fail('spider_crawl requires SPIDER_API_KEY. Get a key at https://spider.cloud')
  const url = String(args?.url ?? '').trim()
  if (!url) return fail('spider_crawl requires "url"')
  const rawLimit = Number(args?.limit ?? 20)
  const limit = Math.min(200, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 20))
  try {
    const response = await fetch('https://api.spider.cloud/crawl', { method: 'POST', headers, body: JSON.stringify({ url, limit, return_format: 'markdown' }), signal: AbortSignal.timeout(45000) })
    if (!response.ok) return fail(`Spider Crawl: HTTP ${response.status}`)
    const data = await response.json()
    const pages = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : []
    if (!pages.length) return ok(`Spider Crawl: no pages returned for ${url}`, JSON.stringify(data).slice(0, 2000))
    const shown = pages.slice(0, 20)
    const body = shown.map((p: any, i: number) => `  [${i + 1}] ${p?.title ?? p?.url ?? '(untitled)'}\n      URL: ${p?.url ?? '(unknown)'}\n      ${String(p?.content ?? p?.markdown ?? '').slice(0, 400).replace(/\n+/g, ' ')}`).join('\n\n')
    return ok(`Spider Crawl: ${pages.length} page(s) from ${url}`, `SPIDER CRAWL — ${url}\n${'='.repeat(60)}\n\nPAGES (${shown.length} of ${pages.length}):\n${body}`)
  } catch (e: any) { return fail(`Spider Crawl: ${e?.message ?? String(e)}`) }
}
