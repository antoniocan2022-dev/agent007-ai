/**
 * /api/tools/test — Tool Test Runner HTTP endpoint
 *
 * UPGRADE #197 (2026-08-01): Recreated. This file has been "lost" 3 times in
 * past commits (#176 created it, then it was deleted, da79891 claimed to
 * recreate it but the commit diff showed 0 source files touched). This is a
 * REAL file with a REAL implementation that wraps `toolTestRunner` from
 * src/lib/tool-testing-coordination.ts.
 *
 * Usage:
 *   GET  /api/tools/test                  → health check (returns registry stats)
 *   POST /api/tools/test  {tool, args}    → execute a tool by name with args
 *
 * Example:
 *   curl -X POST https://agent007-ai.vercel.app/api/tools/test \
 *     -H 'Content-Type: application/json' \
 *     -d '{"tool":"web_search","args":{"query":"hello world"}}'
 *
 * Response shape:
 *   { ok: boolean, preview: string, result: string, elapsed_ms: number }
 */
import { NextRequest, NextResponse } from 'next/server'
import { toolTestRunner } from '@/lib/tool-testing-coordination'

export const dynamic = 'force-dynamic'
export const maxDuration = 60  // matches vercel.json default for /api/**/route.ts

/**
 * GET /api/tools/test
 * Returns a quick health summary so curl probes can verify the endpoint exists.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const tool = url.searchParams.get('tool')
  const argsJson = url.searchParams.get('args')

  // If ?tool=web_search&args={"query":"..."} is provided, run the tool (GET convenience)
  if (tool) {
    let args: any = {}
    if (argsJson) {
      try { args = JSON.parse(argsJson) } catch { /* empty args on parse error */ }
    }
    return runTool(tool, args)
  }

  // Otherwise: return registry stats
  try {
    const { TOOL_REGISTRY } = await import('@/lib/tools')
    const total = Object.keys(TOOL_REGISTRY).length
    return NextResponse.json({
      ok: true,
      endpoint: '/api/tools/test',
      method: 'POST',
      usage: 'POST {tool: "<tool_name>", args: {...}}',
      tool_count: total,
      timestamp: new Date().toISOString(),
    })
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: e?.message ?? 'failed to load TOOL_REGISTRY',
      timestamp: new Date().toISOString(),
    }, { status: 500 })
  }
}

/**
 * POST /api/tools/test
 * Body: { tool: string, args?: object, timeout?: number }
 * Runs the tool via toolTestRunner and returns the result.
 */
export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body. Expected {tool, args?}' },
      { status: 400 }
    )
  }

  const { tool, args = {}, timeout } = body ?? {}
  if (!tool || typeof tool !== 'string') {
    return NextResponse.json(
      { ok: false, error: 'Missing required field: tool (string)' },
      { status: 400 }
    )
  }

  return runTool(tool, args, timeout)
}

/**
 * Shared runner — used by both GET (with ?tool=) and POST.
 */
async function runTool(tool: string, args: object, timeout?: number) {
  const start = Date.now()
  try {
    const runnerArgs: any = { tool, args }
    if (typeof timeout === 'number' && timeout > 0) runnerArgs.timeout = timeout

    const result = await toolTestRunner(runnerArgs, {
      attachments: [],
      language: 'en',
      conversationId: 'api-tools-test',
    })

    return NextResponse.json({
      ok: result.ok,
      preview: result.preview,
      result: result.result,
      elapsed_ms: Date.now() - start,
      tool,
      args,
      timestamp: new Date().toISOString(),
    })
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: e?.message ?? 'unknown error',
      elapsed_ms: Date.now() - start,
      tool,
      args,
      timestamp: new Date().toISOString(),
    }, { status: 500 })
  }
}
