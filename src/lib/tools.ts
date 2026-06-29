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

/* ----------------------------- Web search ----------------------------- */
export async function toolWebSearch(
  args: { query?: string; num?: number; recency_days?: number },
  _ctx: ToolContext
): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  if (!query) return badResult('Missing "query" argument for web_search')
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
    return okResult(preview, formatted)
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
  try {
    const zai = await getZai()
    const res: any = await zai.functions.invoke('page_reader', { url })
    const html = res?.data?.html ?? ''
    const title = res?.data?.title ?? url
    const text = stripHtml(html).slice(0, 6000)
    return okResult(
      `Read page: ${title}\n${text.slice(0, 400)}...`,
      `Page: ${title}\nURL: ${url}\n\n${text}`
    )
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
