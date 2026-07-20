/**
 * tool-cache.ts — UPGRADE #99
 * Layer 2 of Hybrid Approach: Smart Tool Cache.
 * Caches task→tool mappings so repeated tasks skip discovery (1 LLM call instead of 4).
 *
 * Flow:
 * 1. Check tool_cache for task → HIT? Use cached tool directly
 * 2. MISS? → Use semantic_router_v2 → execute → store in cache for next time
 */
import type { ToolResult } from './tools'

function ok(p: string, r: string): ToolResult { return { ok: true, preview: p, result: r } }
function fail(r: string): ToolResult { return { ok: false, preview: r.slice(0, 120), result: r } }

const _g = globalThis as any
if (!_g.__toolCache) _g.__toolCache = new Map<string, { tool: string; hits: number; lastUsed: string }>()
const cache: Map<string, { tool: string; hits: number; lastUsed: string }> = _g.__toolCache

export async function toolCache(args: any): Promise<ToolResult> {
  const { action = 'get' } = args ?? {}

  if (action === 'get') {
    const { task } = args ?? {}
    if (!task) return fail('tool_cache get requires: task')
    const key = task.toLowerCase().slice(0, 100)
    const entry = cache.get(key)
    if (entry) {
      entry.hits++
      entry.lastUsed = new Date().toISOString()
      return ok(`CACHE HIT: ${entry.tool} (used ${entry.hits}x)`, `CACHE HIT\nTool: ${entry.tool}\nHits: ${entry.hits}\nLast used: ${entry.lastUsed}\n\nUse this tool directly — skip discovery.`)
    }
    return ok('CACHE MISS', `CACHE MISS\nNo cached tool for: "${task}"\n\nUse semantic_router_v2 to find the right tool, then cache it with action="store".`)
  }

  if (action === 'store') {
    const { task, tool } = args ?? {}
    if (!task || !tool) return fail('tool_cache store requires: task, tool')
    const key = task.toLowerCase().slice(0, 100)
    cache.set(key, { tool, hits: 0, lastUsed: new Date().toISOString() })
    return ok(`Cached: "${task.slice(0,50)}" → ${tool}`, `STORED\nTask: ${task}\nTool: ${tool}\n\nNext time this task is requested, the tool will be returned instantly (cache hit).`)
  }

  if (action === 'stats') {
    const entries = Array.from(cache.entries())
    const totalHits = entries.reduce((s, [, v]) => s + v.hits, 0)
    return ok(`${entries.length} cached tools, ${totalHits} total hits`, `TOOL CACHE STATS\nEntries: ${entries.length}\nTotal hits: ${totalHits}\nHit rate: ${entries.length > 0 ? Math.round(totalHits / (totalHits + entries.length) * 100) : 0}%\n\nTop cached:\n${entries.sort((a, b) => b[1].hits - a[1].hits).slice(0, 10).map(([k, v]) => `  ${v.hits}x: ${k.slice(0, 50)} → ${v.tool}`).join('\n')}`)
  }

  if (action === 'clear') {
    cache.clear()
    return ok('Cache cleared', 'All cached tool mappings have been cleared.')
  }

  return fail(`Unknown action: ${action}. Use: get | store | stats | clear`)
}
