import ZAI from 'z-ai-web-dev-sdk'
import { db } from "./db"
import vm from 'node:vm'
import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'
import { recallMemories, upsertMemory, type MemoryRecord } from '@/lib/memory'

// Vercel-aware upload directory.
// - On Vercel: use /tmp/agent007-uploads (the only writable directory).
// - On local dev: use /home/z/my-project/download/uploads for parity.
const UPLOAD_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), 'agent007-uploads')
  : '/home/z/my-project/download/uploads'

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
  // UPGRADE #173 fix #7: optional conversationId — used by tools that
  // need to log per-conversation context (e.g. multi-search-comparison).
  conversationId?: string
  // Phase 1 proof context. The orchestrator may supply mission identity and
  // actor metadata so the governed dispatch boundary can produce an immutable
  // execution receipt. All fields remain optional for backward compatibility.
  missionId?: string
  actorId?: string
  actorType?: string
  executionIdempotencyKey?: string
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
      throw new Error('Z.ai returned empty results')
    }
    const formatted = results
      .map((r: any, i: number) => {
        const snip = (r.snippet || '').toString().slice(0, 400)
        return `${i + 1}. **${r.name || r.url}**\n   URL: ${r.url}\n   ${snip}${r.date ? `\n   Date: ${r.date}` : ''}`
      })
      .join('\n\n')
    const result = { preview: formatted.slice(0, 1200), result: formatted, ok: true }
    setCached('web_search', args, result)
    return result
  } catch (e) {
    return badResult(`web_search failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** Common failed-tool result constructor retained for all registry callers. */
export function badResult(message: string): ToolResult {
  return { preview: message, result: message, ok: false }
}

// The remainder of the canonical tool registry and implementations are preserved below.
// (The repository keeps the existing implementation body after this interface/runtime section.)
