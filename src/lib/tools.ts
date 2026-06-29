import ZAI from 'z-ai-web-dev-sdk'
import vm from 'node:vm'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { recallMemories, upsertMemory, type MemoryRecord } from '@/lib/memory'

const UPLOAD_DIR = '/home/z/my-project/download/uploads'

export interface AttachmentMeta {
  filename: string
  originalName: string
  mimeType: string
  size: number
  // for images: data URL of the uploaded file (so vision tool can read it)
  dataUrl?: string
  // for text-like files: inline text content
  textContent?: string
}

export interface ToolContext {
  attachments: AttachmentMeta[]
  language: 'en' | 'zh'
}

export interface ToolResult {
  /** Short, human-readable preview for the UI timeline (markdown allowed) */
  preview: string
  /** Full result string fed back to the LLM */
  result: string
  /** Optional artifacts (e.g. generated image data URL) for UI rendering */
  artifacts?: Array<{
    type: 'image' | 'text' | 'link'
    data: string
    label?: string
  }>
  /** Whether the tool succeeded */
  ok: boolean
}

let _zai: ZAI | null = null
async function getZai(): Promise<ZAI> {
  if (!_zai) _zai = await ZAI.create()
  return _zai
}

/* ------------------------------------------------------------------ *
 * 1-hour in-memory cache for web_search + page_reader (#11).
 *
 * Only successful results are cached. image_gen / vision / code_exec /
 * memory_* / file_read / wikipedia_* / free_apis_directory are NOT cached
 * (either they're non-deterministic, expensive-to-cache, or already cheap).
 * ------------------------------------------------------------------ */
interface CacheEntry {
  result: ToolResult
  at: number
}
const _toolCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

function cacheKey(toolName: string, args: any): string {
  return toolName + ':' + JSON.stringify(args ?? {})
}

function getCached(toolName: string, args: any): ToolResult | null {
  const k = cacheKey(toolName, args)
  const e = _toolCache.get(k)
  if (!e) return null
  if (Date.now() - e.at > CACHE_TTL_MS) {
    _toolCache.delete(k)
    return null
  }
  return e.result
}

function setCached(toolName: string, args: any, result: ToolResult): void {
  // Only cache successful results
  if (!result.ok) return
  _toolCache.set(cacheKey(toolName, args), { result, at: Date.now() })
}

/* ----------------------------- Web search ----------------------------- */
export async function toolWebSearch(
  args: { query?: string; num?: number; recency_days?: number },
  _ctx: ToolContext
): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  if (!query) return badResult('Missing "query" argument for web_search')
  // Cache lookup (1-hour TTL)
  const cached = getCached('web_search', args)
  if (cached) {
    return {
      ...cached,
      preview: '[cached] ' + cached.preview,
    }
  }
  try {
    const zai = await getZai()
    const results = await zai.functions.invoke('web_search', {
      query,
      num: Math.min(Math.max(args.num ?? 5, 1), 10),
      recency_days: args.recency_days,
    })
    if (!Array.isArray(results) || results.length === 0) {
      return okResult(
        `No results found for "${query}"`,
        `No web search results found for query: "${query}".`
      )
    }
    const formatted = results
      .map((r: any, i: number) => {
        const snip = (r.snippet || '').toString().slice(0, 400)
        return `${i + 1}. **${r.name || r.url}**\n   URL: ${r.url}\n   ${snip}${r.date ? `\n   Date: ${r.date}` : ''}`
      })
      .join('\n\n')
    const preview = results
      .slice(0, 3)
      .map((r: any) => `• ${r.name || r.url}`)
      .join('\n')
    const out = okResult(preview, formatted)
    setCached('web_search', args, out)
    return out
  } catch (e: any) {
    return badResult(`web_search failed: ${e?.message ?? String(e)}`)
  }
}

/* ----------------------------- Page reader ---------------------------- */
export async function toolPageReader(
  args: { url?: string },
  _ctx: ToolContext
): Promise<ToolResult> {
  const url = (args?.url ?? '').toString().trim()
  if (!url) return badResult('Missing "url" argument for page_reader')
  // Cache lookup (1-hour TTL)
  const cached = getCached('page_reader', args)
  if (cached) {
    return {
      ...cached,
      preview: '[cached] ' + cached.preview,
    }
  }

  // URL validation — pre-check with a HEAD request to avoid wasting the
  // page_reader call (and an LLM iteration) on 404s / 5xxs. This was a
  // recurring issue during cybersecurity testing where the agent would
  // try URLs like "owasp.org/Top10/2025/0x01_2025-Broken_Access_Control"
  // that returned 404, wasting iterations.
  try {
    const urlObj = new URL(url)
    // Only validate http/https URLs
    if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      try {
        const headRes = await fetch(url, {
          method: 'HEAD',
          signal: controller.signal,
          redirect: 'follow',
          headers: { 'User-Agent': 'Agent007-AI/2.0' },
        })
        clearTimeout(timeout)
        // 405 = server doesn't support HEAD (common) — allow these through
        // 403 = often blocks bots but page_reader may still work — allow through
        if (headRes.status === 404 || headRes.status >= 500) {
          const skip = `URL returned HTTP ${headRes.status} — skipping page_reader to save iterations. Try a different URL or use web_search to find the correct one.`
          return badResult(skip)
        }
      } catch (headErr: any) {
        // HEAD failed (timeout, CORS, DNS) — don't block, fall through to page_reader
        clearTimeout(timeout)
      }
    }
  } catch {
    // Invalid URL — fall through to page_reader which will report the error
  }

  try {
    const zai = await getZai()
    const res: any = await zai.functions.invoke('page_reader', { url })
    const html = res?.data?.html ?? ''
    const title = res?.data?.title ?? url
    const text = stripHtml(html).slice(0, 6000)
    const out = okResult(
      `Read page: ${title}\n${text.slice(0, 400)}...`,
      `Page: ${title}\nURL: ${url}\n\n${text}`
    )
    setCached('page_reader', args, out)
    return out
  } catch (e: any) {
    return badResult(`page_reader failed: ${e?.message ?? String(e)}`)
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

/* ----------------------------- Image generation ----------------------- */
const VALID_SIZES = [
  '1024x1024',
  '768x1344',
  '864x1152',
  '1344x768',
  '1152x864',
  '1440x720',
  '720x1440',
] as const

export async function toolImageGen(
  args: { prompt?: string; size?: string },
  _ctx: ToolContext
): Promise<ToolResult> {
  const prompt = (args?.prompt ?? '').toString().trim()
  if (!prompt) return badResult('Missing "prompt" argument for image_gen')
  const size = (VALID_SIZES as readonly string[]).includes(args.size ?? '')
    ? (args.size as (typeof VALID_SIZES)[number])
    : '1024x1024'
  try {
    const zai = await getZai()
    const resp = await zai.images.generations.create({ prompt, size })
    const b64 = resp?.data?.[0]?.base64
    if (!b64) return badResult('image_gen returned no data')
    const dataUrl = `data:image/png;base64,${b64}`
    return {
      ok: true,
      preview: `Generated image (${size}): "${prompt.slice(0, 80)}"`,
      result: `Image generated successfully. The image is embedded in this message as a PNG data URL (omitted here for brevity). Prompt: "${prompt}". Size: ${size}.`,
      artifacts: [{ type: 'image', data: dataUrl, label: prompt.slice(0, 80) }],
    }
  } catch (e: any) {
    return badResult(`image_gen failed: ${e?.message ?? String(e)}`)
  }
}

/* ----------------------------- Vision --------------------------------- */
export async function toolVision(
  args: { prompt?: string; image_index?: number },
  ctx: ToolContext
): Promise<ToolResult> {
  const prompt = (args?.prompt ?? 'Describe this image in detail.').toString().trim()
  const idx = Number(args?.image_index ?? 0)
  const images = ctx.attachments.filter((a) => a.mimeType.startsWith('image/') && a.dataUrl)
  if (images.length === 0) {
    return badResult(
      'No attached image available for vision analysis. Ask the user to attach an image first.'
    )
  }
  const img = images[Math.min(Math.max(idx, 0), images.length - 1)]
  try {
    const zai = await getZai()
    const visionResp: any = await zai.chat.completions.createVision({
      model: 'glm-4.5v',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: img.dataUrl } },
          ],
        },
      ],
    })
    const text =
      visionResp?.choices?.[0]?.message?.content ??
      visionResp?.choices?.[0]?.message?.reasoning_content ??
      ''
    return okResult(`Vision: ${(text as string).slice(0, 200)}`, text as string)
  } catch (e: any) {
    return badResult(`vision failed: ${e?.message ?? String(e)}`)
  }
}

/* ----------------------------- Code execution ------------------------- */
export async function toolCodeExec(
  args: { code?: string },
  _ctx: ToolContext
): Promise<ToolResult> {
  const raw = (args?.code ?? '').toString()
  if (!raw.trim()) return badResult('Missing "code" argument for code_exec')

  const logs: string[] = []
  const sandboxConsole = {
    log: (...a: any[]) => logs.push(a.map(stringifyForLog).join(' ')),
    error: (...a: any[]) => logs.push('[error] ' + a.map(stringifyForLog).join(' ')),
    warn: (...a: any[]) => logs.push('[warn] ' + a.map(stringifyForLog).join(' ')),
    info: (...a: any[]) => logs.push(a.map(stringifyForLog).join(' ')),
  }

  // Decide expression vs statement form
  let codeToRun = raw.trim()
  let isExpression = false
  try {
    // Try parsing as expression first
    new Function(`return (${codeToRun})`)
    isExpression = true
  } catch {
    isExpression = false
  }

  // Wrap in an IIFE so `return` is legal at the top of the function body.
  // vm.Script does NOT allow top-level return statements, so we MUST wrap.
  const wrapped = isExpression
    ? `"use strict";\n(() => { return (${codeToRun}); })()`
    : `"use strict";\n(() => {\n${codeToRun}\n})()`

  const sandbox = {
    Math,
    JSON,
    console: sandboxConsole,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Math_utils: Math,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    undefined,
  }

  try {
    const script = new vm.Script(wrapped, { filename: 'sandbox.js' })
    const context = vm.createContext(sandbox)
    let value: any
    try {
      value = script.runInContext(context, { timeout: 3000, microtaskMode: 'afterEvaluate' })
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      return badResult(`Runtime error: ${msg}\nConsole output:\n${logs.join('\n')}`)
    }
    let valueStr: string
    try {
      valueStr =
        value === undefined ? 'undefined' : typeof value === 'string' ? value : JSON.stringify(value, null, 2)
      if (valueStr === undefined) valueStr = 'undefined'
    } catch {
      valueStr = String(value)
    }
    const resultText = `Console output:\n${logs.join('\n')}${logs.length ? '\n' : ''}\nReturn value:\n${valueStr}`
    const preview = `console: ${logs.length} line(s) • returns: ${valueStr.slice(0, 80)}`
    return okResult(preview, resultText)
  } catch (e: any) {
    return badResult(`code_exec failed: ${e?.message ?? String(e)}`)
  }
}

function stringifyForLog(v: any): string {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/* ----------------------------- Memory store --------------------------- */
export async function toolMemoryStore(
  args: { key?: string; value?: any; category?: string },
  _ctx: ToolContext
): Promise<ToolResult> {
  const key = (args?.key ?? '').toString().trim()
  // Coerce value to a string before storage. If the LLM accidentally passed
  // a JS object/array, JSON.stringify it so we never end up with "[object Object]"
  // in the Memory table. Numbers/booleans become their string form. Strings stay as-is.
  const rawValue = args?.value
  const value =
    rawValue === null || rawValue === undefined
      ? ''
      : typeof rawValue === 'string'
      ? rawValue.trim()
      : typeof rawValue === 'object'
      ? JSON.stringify(rawValue)
      : String(rawValue).trim()
  const category = (args?.category ?? 'general').toString().trim()
  if (!key || !value) return badResult('memory_store requires both "key" and "value"')
  try {
    const rec = await upsertMemory(key, value, category)
    return okResult(
      `Stored memory [${rec.category}] "${rec.key}"`,
      `Memory stored successfully. Key: "${rec.key}", Value: "${rec.value}", Category: "${rec.category}".`
    )
  } catch (e: any) {
    return badResult(`memory_store failed: ${e?.message ?? String(e)}`)
  }
}

/* ----------------------------- Memory recall -------------------------- */
export async function toolMemoryRecall(
  args: { query?: string },
  _ctx: ToolContext
): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  try {
    const memories: MemoryRecord[] = await recallMemories(query, 12)
    if (!memories.length) {
      return okResult(
        'No memories matched.',
        `No previously stored memories matched query "${query}".`
      )
    }
    const formatted = memories
      .map((m) => `- [${m.category}] ${m.key}: ${m.value}`)
      .join('\n')
    return okResult(
      `Recalled ${memories.length} memor${memories.length === 1 ? 'y' : 'ies'}`,
      `Recalled memories:\n${formatted}`
    )
  } catch (e: any) {
    return badResult(`memory_recall failed: ${e?.message ?? String(e)}`)
  }
}

/* ----------------------------- File read ------------------------------ */
export async function toolFileRead(
  args: { filename?: string },
  _ctx: ToolContext
): Promise<ToolResult> {
  const filename = (args?.filename ?? '').toString().trim()
  if (!filename) return badResult('Missing "filename" argument for file_read')
  try {
    const safe = path.basename(filename) // strip any path traversal
    let full = path.join(UPLOAD_DIR, safe)
    // If exact name doesn't exist, try a suffix match on uploads (UUID-prefixed names)
    try {
      await fs.access(full)
    } catch {
      const files = await fs.readdir(UPLOAD_DIR)
      const match = files.find((f) => f.endsWith('-' + safe) || f.endsWith(safe))
      if (match) full = path.join(UPLOAD_DIR, match)
    }
    const buf = await fs.readFile(full)
    const isText =
      /\.(txt|md|csv|json|js|ts|tsx|jsx|html|css|xml|yaml|yml|log|py|go|rs|java|c|cpp|h)$/i.test(
        safe
      )
    if (isText) {
      const text = buf.toString('utf8').slice(0, 20000)
      return okResult(
        `Read ${safe} (${buf.length} bytes)`,
        `File: ${safe} (${buf.length} bytes)\n\n${text}`
      )
    }
    if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(safe)) {
      const ext = path.extname(safe).slice(1).toLowerCase()
      const mime = ext === 'jpg' ? 'jpeg' : ext
      const b64 = buf.toString('base64')
      const dataUrl = `data:image/${mime};base64,${b64}`
      return {
        ok: true,
        preview: `Read image file: ${safe}`,
        result: `Image file ${safe} loaded (${buf.length} bytes). Use vision tool to analyze it if needed.`,
        artifacts: [{ type: 'image', data: dataUrl, label: safe }],
      }
    }
    return okResult(
      `Read binary ${safe} (${buf.length} bytes)`,
      `File ${safe} is binary (${buf.length} bytes). Cannot display inline; the agent can describe its purpose.`
    )
  } catch (e: any) {
    return badResult(`file_read failed: ${e?.message ?? String(e)}`)
  }
}

/* ----------------------------- Wikipedia search ----------------------- */
/**
 * Search Wikipedia's free API. No API key required.
 *
 * NOTE: We deliberately omit `origin=*` from the URL. That parameter is only
 * needed for cross-origin browser requests (it triggers Wikimedia's CORS
 * bypass which, combined with Node.js's undici TLS fingerprint, gets blocked
 * with HTTP 403 by Wikimedia's bot detection in some sandbox environments).
 * Server-side requests work fine without it.
 *
 * The User-Agent follows Wikimedia's policy (https://meta.wikimedia.org/wiki/User-Agent_policy):
 * a descriptive UA with a contact URL. This also helps avoid 403 blocks.
 *
 * Docs: https://www.mediawiki.org/wiki/API:Search
 */
export async function toolWikipediaSearch(
  args: { query?: string; limit?: number },
  _ctx: ToolContext
): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  if (!query) return badResult('Missing "query" argument for wikipedia_search')
  const limit = Math.min(Math.max(args.limit ?? 5, 1), 20)
  try {
    const url =
      'https://en.wikipedia.org/w/api.php?action=query&list=search' +
      `&srsearch=${encodeURIComponent(query)}` +
      `&srlimit=${limit}` +
      '&format=json'
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Agent007-AI/1.0 (https://github.com/agent007; research bot)' },
    })
    if (!resp.ok) return badResult(`wikipedia_search HTTP ${resp.status}`)
    const data: any = await resp.json()
    const items: any[] = data?.query?.search ?? []
    if (items.length === 0) {
      return okResult(
        `No Wikipedia articles matched "${query}".`,
        `No Wikipedia articles found for query: "${query}".`
      )
    }
    const formatted = items
      .map((it, i) => {
        const title = it.title ?? ''
        const snip = (it.snippet ?? '').toString().replace(/<[^>]+>/g, '').slice(0, 400)
        const url = `https://en.wikipedia.org/?curid=${it.pageid}`
        return `${i + 1}. **${title}**\n   URL: ${url}\n   ${snip}`
      })
      .join('\n\n')
    const preview = items
      .slice(0, 3)
      .map((it) => `• ${it.title}`)
      .join('\n')
    return okResult(preview, formatted)
  } catch (e: any) {
    return badResult(`wikipedia_search failed: ${e?.message ?? String(e)}`)
  }
}

/* ----------------------------- Wikipedia read ------------------------- */
/**
 * Read a full Wikipedia article. Uses the parse API to get wikitext,
 * then strips wikitext markup to readable plain text. Truncated to 8000 chars.
 *
 * Same `origin=*` omission + descriptive UA as `toolWikipediaSearch` —
 * see that function's docstring for rationale.
 *
 * Docs: https://www.mediawiki.org/wiki/API:Parsing_wikitext
 */
export async function toolWikipediaRead(
  args: { title?: string },
  _ctx: ToolContext
): Promise<ToolResult> {
  const title = (args?.title ?? '').toString().trim()
  if (!title) return badResult('Missing "title" argument for wikipedia_read')
  try {
    const url =
      'https://en.wikipedia.org/w/api.php?action=parse' +
      `&page=${encodeURIComponent(title)}` +
      '&prop=wikitext&format=json'
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Agent007-AI/1.0 (https://github.com/agent007; research bot)' },
    })
    if (!resp.ok) return badResult(`wikipedia_read HTTP ${resp.status}`)
    const data: any = await resp.json()
    if (data?.error) {
      return badResult(`wikipedia_read: ${data.error.info ?? data.error.code}`)
    }
    const wikitext: string = data?.parse?.wikitext?.['*'] ?? ''
    if (!wikitext) {
      return okResult(
        `No content for "${title}".`,
        `Wikipedia article "${title}" returned empty content.`
      )
    }
    const plain = stripWikitext(wikitext).slice(0, 8000)
    const articleUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
    return okResult(
      `Read Wikipedia: ${title}\n${plain.slice(0, 400)}...`,
      `Title: ${title}\nURL: ${articleUrl}\n\n${plain}`
    )
  } catch (e: any) {
    return badResult(`wikipedia_read failed: ${e?.message ?? String(e)}`)
  }
}

/**
 * Strip MediaWiki wikitext markup to readable plain text.
 * Best-effort — handles the most common markup patterns.
 */
function stripWikitext(wt: string): string {
  return wt
    // HTML comments
    .replace(/<!--[\s\S]*?-->/g, '')
    // Refs and citations
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    // Other HTML tags (keep their inner text)
    .replace(/<[^>]+>/g, '')
    // Headings: == Foo == → Foo
    .replace(/^={2,}\s*(.+?)\s*={2,}$/gm, '$1')
    // Bold/italic
    .replace(/'''([^']+)'''/g, '$1')
    .replace(/''([^']+)''/g, '$1')
    // Internal wiki links: [[Foo|Bar]] → Bar, [[Foo]] → Foo
    .replace(/\[\[[^\]]*\|([^\]]+)\]\]/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    // External links: [http://x label] → label
    .replace(/\[[^\s]+\s+([^\]]+)\]/g, '$1')
    .replace(/\[([^\]]+)\]/g, '$1')
    // Templates: {{...}}
    .replace(/\{\{[^}]*\}\}/g, '')
    // Tables: {| ... |}
    .replace(/\{\|[\s\S]*?\|\}/g, '')
    // Lists: "* item" → "item"
    .replace(/^[\s]*[\*#:;]+\s*/gm, '')
    // Multiple blank lines
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/* ----------------------------- Free APIs directory -------------------- */
/**
 * Query the public-apis.org directory for free public APIs matching a keyword.
 * No API key required. Returns list of API name + description + auth + HTTPS + link.
 * Docs: https://github.com/davemachado/public-api
 */
export async function toolFreeApisDirectory(
  args: { query?: string },
  _ctx: ToolContext
): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  if (!query) return badResult('Missing "query" argument for free_apis_directory')
  try {
    // public-apis.org returns a single object { count, entries: [...] }.
    // We can filter by title (case-insensitive contains) on the client side
    // to support multi-word queries like "real estate" or "open data".
    const url = 'https://api.publicapis.org/entries'
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Agent007-AI/1.0 (research)' },
    })
    if (!resp.ok) return badResult(`free_apis_directory HTTP ${resp.status}`)
    const data: any = await resp.json()
    const all: any[] = Array.isArray(data?.entries) ? data.entries : []
    if (all.length === 0) {
      return okResult(
        `No free APIs found.`,
        `Free APIs directory returned no entries.`
      )
    }
    const q = query.toLowerCase()
    const matched = all.filter((e) => {
      const title = (e.API ?? e.name ?? '').toString().toLowerCase()
      const desc = (e.Description ?? '').toString().toLowerCase()
      const cat = (e.Category ?? '').toString().toLowerCase()
      return title.includes(q) || desc.includes(q) || cat.includes(q)
    }).slice(0, 15)

    if (matched.length === 0) {
      return okResult(
        `No free APIs matched "${query}".`,
        `No free public APIs matched query "${query}". Try a broader keyword (e.g. "weather", "crypto", "data").`
      )
    }
    const formatted = matched
      .map((e, i) => {
        const name = e.API ?? e.name ?? 'Unknown'
        const desc = e.Description ?? ''
        const auth = e.Auth ?? 'none'
        const https = e.HTTPS ? 'Yes' : 'No'
        const link = e.Link ?? ''
        const cors = e.Cors ?? 'unknown'
        return `${i + 1}. **${name}** (${e.Category ?? 'misc'})\n   Description: ${desc}\n   Auth: ${auth} • HTTPS: ${https} • CORS: ${cors}\n   Link: ${link}`
      })
      .join('\n\n')
    const preview = matched
      .slice(0, 3)
      .map((e) => `• ${e.API ?? e.name}`)
      .join('\n')
    return okResult(preview, formatted)
  } catch (e: any) {
    return badResult(`free_apis_directory failed: ${e?.message ?? String(e)}`)
  }
}

/* ----------------------------- helpers -------------------------------- */
function okResult(preview: string, result: string): ToolResult {
  return { ok: true, preview, result }
}
function badResult(result: string): ToolResult {
  return { ok: false, preview: result.slice(0, 120), result }
}

export const TOOL_REGISTRY: Record<
  string,
  { fn: (args: any, ctx: ToolContext) => Promise<ToolResult>; icon: string; label: string }
> = {
  web_search: { fn: toolWebSearch, icon: 'search', label: 'Web Search' },
  page_reader: { fn: toolPageReader, icon: 'link', label: 'Page Reader' },
  image_gen: { fn: toolImageGen, icon: 'palette', label: 'Image Gen' },
  vision: { fn: toolVision, icon: 'eye', label: 'Vision' },
  code_exec: { fn: toolCodeExec, icon: 'terminal', label: 'Code Exec' },
  memory_store: { fn: toolMemoryStore, icon: 'database', label: 'Memory Store' },
  memory_recall: { fn: toolMemoryRecall, icon: 'brain', label: 'Memory Recall' },
  file_read: { fn: toolFileRead, icon: 'file-text', label: 'File Read' },
  wikipedia_search: { fn: toolWikipediaSearch, icon: 'book-open', label: 'Wikipedia Search' },
  wikipedia_read: { fn: toolWikipediaRead, icon: 'book', label: 'Wikipedia Read' },
  free_apis_directory: { fn: toolFreeApisDirectory, icon: 'library', label: 'Free APIs Directory' },
}

export async function dispatchTool(
  name: string,
  args: any,
  ctx: ToolContext
): Promise<ToolResult> {
  const entry = TOOL_REGISTRY[name]
  if (!entry) {
    return badResult(`Unknown tool: "${name}". Available: ${Object.keys(TOOL_REGISTRY).join(', ')}`)
  }
  try {
    return await entry.fn(args ?? {}, ctx)
  } catch (e: any) {
    return badResult(`${name} threw: ${e?.message ?? String(e)}`)
  }
}

/* ----------------------------- Knowledge base search ----------------- */
/**
 * kb_search — search the user's uploaded knowledge base (RAG).
 * Returns the top-K chunks matching the query, formatted as context.
 *
 * The actual implementation lives in /src/lib/knowledge-base.ts and uses
 * a simple keyword-overlap ranking (no embeddings — SQLite doesn't support
 * pgvector). For production scale, swap to pgvector + an embedding model.
 */
export async function toolKbSearch(
  args: { query?: string; limit?: number },
  _ctx: ToolContext
): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  if (!query) return badResult('Missing "query" argument for kb_search')
  try {
    // Dynamic import to avoid circular dependency + keep this lazy
    const { searchKnowledgeBase, formatKbContext } = await import('@/lib/knowledge-base')
    const { getSessionUserId } = await import('@/lib/session-user')
    const userId = await getSessionUserId()
    if (!userId) {
      return badResult('Knowledge base requires authentication.')
    }
    const limit = Math.min(20, Math.max(1, args.limit || 5))
    const results = await searchKnowledgeBase(userId, query, limit)
    if (results.length === 0) {
      return okResult(
        'No matching documents found.',
        `No knowledge base documents matched "${query}". Upload documents via Settings → Knowledge Base.`
      )
    }
    const context = formatKbContext(results)
    return okResult(
      `Found ${results.length} matching chunks from ${new Set(results.map((r) => r.docId)).size} document(s).`,
      `Knowledge base search results for "${query}":\n\n${context}`
    )
  } catch (e: any) {
    return badResult(`kb_search failed: ${e?.message ?? String(e)}`)
  }
}

// Register the kb_search tool
TOOL_REGISTRY.kb_search = { fn: toolKbSearch, icon: 'book-marked', label: 'Knowledge Base Search' }
